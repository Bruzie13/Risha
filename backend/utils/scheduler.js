const pool = require('../config/database');
const Notification = require('../models/Notification');
const { sendLowStockAlert } = require('./mailer');

const CHECK_INTERVAL = 60 * 60 * 1000;
let intervalHandle = null;

function start() {
    console.log('[Scheduler] Low-stock email checker started (every 60 min)');
    checkAndAlert();
    intervalHandle = setInterval(checkAndAlert, CHECK_INTERVAL);
}

function stop() {
    if (intervalHandle) clearInterval(intervalHandle);
}

async function checkAndAlert() {
    try {
        const conn = await pool.getConnection();
        const [products] = await conn.execute(
            `SELECT p.id, p.name, p.sku, p.stock_quantity, p.reorder_level, p.unit_price, p.supplier_id,
                    s.name as supplier_name, s.email as supplier_email
             FROM products p
              JOIN suppliers s ON p.supplier_id = s.id AND s.is_active = TRUE
             WHERE p.is_active = TRUE AND p.stock_quantity <= p.reorder_level
             ORDER BY s.id`
        );
        conn.release();

        if (products.length === 0) return;

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
            const sent = await sendLowStockAlert(group.email, group.name, group.items);
            if (sent) {
                await Notification.create({
                    title: `Low-Stock Alert Sent to ${group.name}`,
                    message: `Auto-emailed ${group.name} about ${group.items.length} low-stock product(s)`,
                    type: 'low_stock'
                });
            }
        }
    } catch (err) {
        console.error('[Scheduler] Error:', err.message);
    }
}

module.exports = { start, stop };