const pool = require('../config/database');
const Notification = require('../models/Notification');
const notifier = require('../services/notifier');
const { sendLowStockAlert } = require('./mailer');

const CHECK_INTERVAL = 60 * 60 * 1000;
let intervalHandle = null;

function start() {
    console.log('[Scheduler] Started (every 60 min)');
    runAllChecks();
    intervalHandle = setInterval(runAllChecks, CHECK_INTERVAL);
}

function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
    console.log('[Scheduler] Stopped');
}

async function runAllChecks() {
    await checkLowStock();
    await checkExpiringProducts();
    await checkOverstock();
    await cleanOldNotifications();
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
            if (p.stock_quantity <= 0) {
                await notifier.notifyStockout(p).catch(() => {});
            } else {
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
            const sent = await sendLowStockAlert(sid, group.email, group.name, group.items);
            if (sent) {
                await Notification.create({
                    title: `Low-Stock Email Sent to ${group.name}`,
                    message: `Auto-emailed ${group.name} about ${group.items.length} low-stock product(s)`,
                    type: 'low_stock'
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
            const exists = await notificationExistsForProduct(p.id, `Expir%`);
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

async function notificationExistsForProduct(productId, titlePattern) {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT id FROM notifications
             WHERE product_id = ?
             AND title LIKE ?
             AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
            [productId, titlePattern]
        );
        conn.release();
        return rows.length > 0;
    } catch {
        return false;
    }
}

module.exports = { start, stop, checkLowStock, checkExpiringProducts, checkOverstock };
