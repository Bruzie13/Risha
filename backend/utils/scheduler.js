const pool = require('../config/database');
const Notification = require('../models/Notification');
const notifier = require('../services/notifier');
const { sendLowStockAlert, sendBackupEmail } = require('./mailer');

const CHECK_INTERVAL = 60 * 60 * 1000;
const BACKUP_INTERVAL = 24 * 60 * 60 * 1000;
// Just under the forecast cache's own 5-minute TTL, so it is refreshed before
// it can expire under a reader rather than after.
const FORECAST_WARM_INTERVAL = 4 * 60 * 1000;
let intervalHandle = null;
let backupHandle = null;
let forecastHandle = null;

function start() {
    console.log('[Scheduler] Started (every 60 min; backups daily)');
    runAllChecks();
    intervalHandle = setInterval(runAllChecks, CHECK_INTERVAL);
    // first backup shortly after boot, then daily
    setTimeout(runBackup, 2 * 60 * 1000);
    backupHandle = setInterval(runBackup, BACKUP_INTERVAL);
    /* Fit the forecast model once shortly after boot, so the first person to
       open Analytics reads a cache instead of waiting on Python.

       This used to be off: the fit ran through execFileSync, which held the
       event loop for its whole duration, so the server could not answer the
       platform's health check and was killed and restarted in a loop. The fit
       is now asynchronous (see mlForecast.warmMLCacheAsync), so it no longer
       stops the server answering. FORECAST_WARM=0 turns it off.

       The 4-minute refresh stays opt-in (FORECAST_WARM=1): an expired cache
       is already served stale while it rebuilds, and refitting round the
       clock would eat most of a small shared instance's CPU. */
    if (process.env.FORECAST_WARM !== '0') {
        setTimeout(warmForecasts, 15000);
    }
    if (process.env.FORECAST_WARM === '1') {
        console.log('[Scheduler] Forecast refresh every 4 min ENABLED');
        forecastHandle = setInterval(warmForecasts, FORECAST_WARM_INTERVAL);
    }
}

function warmForecasts() {
    try {
        const predictions = require('../routes/predictions');
        if (typeof predictions.warmAllPredictions === 'function') predictions.warmAllPredictions();
    } catch (e) {
        console.error('[Scheduler] Forecast warm error:', e.message);
    }
}

async function runBackup() {
    try {
        // avoid double-backup within 20h across restarts
        const conn = await pool.getConnection();
        const [last] = await conn.execute(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'last_backup_at'");
        const lastAt = last.length ? Date.parse(last[0].setting_value) : 0;
        if (lastAt && Date.now() - lastAt < 20 * 60 * 60 * 1000) { conn.release(); return; }
        conn.release();

        const { buildBackup } = require('../server');
        const b = await buildBackup();
        const ok = await sendBackupEmail(b.zip, b);
        if (ok) {
            const c2 = await pool.getConnection();
            await c2.execute(
                `INSERT INTO app_settings (setting_key, setting_value) VALUES ('last_backup_at', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [new Date().toISOString()]);
            c2.release();
        }
    } catch (e) {
        console.error('[Backup] scheduled backup error:', e.message);
    }
}

function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    if (backupHandle) clearInterval(backupHandle);
    if (forecastHandle) clearInterval(forecastHandle);
    console.log('[Scheduler] Stopped');
}

async function runAllChecks() {
    await checkLowStock();
    await checkExpiringProducts();
    await checkOverstock();
    await cleanOldNotifications();
    await checkPaymentsDue();
    try { await require('../controllers/trashController').emptyOld(); }
    catch (e) { console.error('[Scheduler] Trash clean-up error:', e.message); }
}

/* A delivery the shop has not paid yet: one notice when it is due within
   three days, and one when it is overdue (UAT, 31 Oct). */
async function checkPaymentsDue() {
    try {
        const { dueDate } = require('./supply');
        const [orders] = await pool.query(
            `SELECT po.id, po.po_number, po.total_amount, s.name AS supplier, s.payment_terms,
                    DATE_FORMAT(CONVERT_TZ(po.received_at,'+00:00','+08:00'), '%Y-%m-%d') AS received_day
             FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
             WHERE po.status = 'received' AND po.paid_at IS NULL
               AND DATE_FORMAT(CONVERT_TZ(po.received_at,'+00:00','+08:00'), '%Y-%m-%d') >=
                   (SELECT setting_value FROM app_settings WHERE setting_key = 'payment_tracking_since')`);
        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        const soon = new Date(Date.now() + 8 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);
        const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        for (const o of orders) {
            const due = dueDate(o.received_day, o.payment_terms);
            if (!due || due > soon) continue;
            const over = due < today;
            const title = over ? `Payment overdue: ${o.po_number}` : `Payment due soon: ${o.po_number}`;
            const [had] = await pool.query('SELECT id FROM notifications WHERE related_type = ? AND related_id = ? AND title = ? LIMIT 1', ['purchase_order', o.id, title]);
            if (had.length) continue;
            await Notification.create({
                title, type: 'info', related_type: 'purchase_order', related_id: o.id,
                message: `${peso(o.total_amount)} to ${o.supplier} ${over ? 'was' : 'is'} due on ${due}. Mark it paid under Suppliers, Orders, once it is paid.`
            });
        }
    } catch (err) {
        console.error('[Scheduler] Payments due check error:', err.message);
    }
}

async function checkLowStock() {
    try {
        const conn = await pool.getConnection();
        const [products] = await conn.execute(
            `SELECT p.id, p.name, p.sku, p.stock_quantity, p.reorder_level, p.unit_price, p.supplier_id,
                    s.name as supplier_name, s.email as supplier_email
             FROM products p
             LEFT JOIN suppliers s ON p.supplier_id = s.id AND s.is_active = TRUE
             WHERE p.is_active = TRUE AND p.stock_quantity <= p.reorder_level
             ORDER BY p.stock_quantity ASC`
        );
        conn.release();

        if (products.length === 0) return;

        for (const p of products) {
            // Don't repeat the same alert every sweep/page-visit: at most one
            // notification per product per REALERT_HOURS.
            if (p.stock_quantity <= 0) {
                if (!(await notificationExistsForProduct(p.id, '%Out of Stock%'))) {
                    await notifier.notifyStockout(p).catch(() => {});
                }
            } else if (!(await notificationExistsForProduct(p.id, 'Low Stock%'))) {
                await notifier.notifyLowStock(p).catch(() => {});
            }
        }

        const grouped = {};
        for (const p of products) {
            if (!p.supplier_email) continue;
            if (!grouped[p.supplier_id]) {
                grouped[p.supplier_id] = { name: p.supplier_name, email: p.supplier_email, items: [] };
            }
            grouped[p.supplier_id].items.push(p);
        }

        for (const [sid, group] of Object.entries(grouped)) {
            if (!group.email) continue;
            // don't nag: at most one low-stock email per supplier per 24h
            const cdConn = await pool.getConnection();
            const [recent] = await cdConn.execute(
                `SELECT id FROM email_logs
                 WHERE supplier_id = ? AND email_type = 'low_stock'
                   AND status IN ('sent', 'pending')
                   AND created_at > NOW() - INTERVAL 24 HOUR
                 LIMIT 1`, [sid]);
            cdConn.release();
            if (recent.length) continue;
            const sent = await sendLowStockAlert(sid, group.email, group.name, group.items);
            if (sent) {
                await Notification.create({
                    title: `Low-Stock Email Sent to ${group.name}`,
                    message: `Auto-emailed ${group.name} about ${group.items.length} low-stock product(s)`,
                    type: 'low_stock',
                    related_type: 'supplier', related_id: Number(sid),
                    // what the email listed, shown when the notice is opened
                    details: {
                        rows: [['Emailed to', `${group.name} (${group.email})`], ['Products in the email', String(group.items.length)]],
                        items: group.items.map(p => `${p.name} (${p.sku}): ${Number(p.stock_quantity)} left, reorder level ${Number(p.reorder_level)}`)
                    }
                });
            }
        }
    } catch (err) {
        console.error('[Scheduler] Low stock check error:', err.message);
    }
}

async function checkExpiringProducts() {
    try {
        const conn = await pool.getConnection();
        const [products] = await conn.execute(
            `SELECT p.id, p.name, p.sku, p.stock_quantity, p.expiration_date
             FROM products p
             WHERE p.is_active = TRUE
             AND p.expiration_date IS NOT NULL
             AND p.expiration_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             AND p.stock_quantity > 0`
        );
        conn.release();

        for (const p of products) {
            const daysLeft = Math.ceil((new Date(p.expiration_date) - new Date()) / (1000 * 60 * 60 * 24));
            const type = daysLeft <= 7 ? 'expiration' : 'info';
            // '%Expir%' — the title is 'Product Expiring Soon', so a prefix
            // pattern never matched and these re-alerted on every sweep
            const exists = await notificationExistsForProduct(p.id, '%Expir%');
            if (!exists) {
                await notifier.notifyExpiringSoon(p, daysLeft).catch(() => {});
            }
        }
    } catch (err) {
        console.error('[Scheduler] Expiration check error:', err.message);
    }
}

async function checkOverstock() {
    try {
        const conn = await pool.getConnection();
        const [products] = await conn.execute(
            `SELECT id, name, sku, stock_quantity, max_stock_level
             FROM products
             WHERE is_active = TRUE
             AND max_stock_level IS NOT NULL
             AND stock_quantity > max_stock_level`
        );
        conn.release();

        for (const p of products) {
            const exists = await notificationExistsForProduct(p.id, 'Overstock%');
            if (!exists) {
                await notifier.notifyOverstock(p).catch(() => {});
            }
        }
    } catch (err) {
        console.error('[Scheduler] Overstock check error:', err.message);
    }
}

async function cleanOldNotifications() {
    try {
        const deleted = await Notification.deleteOld(30);
        if (deleted > 0) {
            console.log(`[Scheduler] Cleaned ${deleted} old notification(s)`);
        }
    } catch (err) {
        console.error('[Scheduler] Cleanup error:', err.message);
    }
}

// How long before the same product alert may repeat (low stock / stockout /
// expiring / overstock). Raise to re-alert less often.
const REALERT_HOURS = 48;

async function notificationExistsForProduct(productId, titlePattern) {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id FROM notifications
             WHERE product_id = ?
             AND title LIKE ?
             AND created_at > DATE_SUB(NOW(), INTERVAL ${REALERT_HOURS} HOUR)`,
            [productId, titlePattern]
        );
        conn.release();
        return rows.length > 0;
    } catch {
        return false;
    }
}

module.exports = { start, stop, checkLowStock, checkExpiringProducts, checkOverstock };
