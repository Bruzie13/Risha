/* The shop's side of working with suppliers: the board of orders in motion,
   notes on an order, marking an order paid, and deciding on prices a supplier
   has proposed. */
const pool = require('../config/database');
const logAudit = require('../services/audit');
const { dueDate } = require('../utils/supply');

const DAY = col => `DATE_FORMAT(CONVERT_TZ(${col},'+00:00','+08:00'), '%Y-%m-%d')`;
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function fail(res, where, e) {
    console.error(`[Supply] ${where} failed:`, e.message);
    res.status(500).json({ success: false, message: 'That could not be completed. Please try again.' });
}

/* Everything that still needs someone's attention: offers to answer, orders
   on their way, and delivered orders not yet paid. One request, so the page
   never shows two halves that disagree. */
exports.getBoard = async (req, res) => {
    try {
        const [orders] = await pool.query(
            `SELECT po.id, po.po_number, po.status, po.total_amount, po.notes,
                    DATE_FORMAT(po.order_date, '%Y-%m-%d') AS order_date,
                    DATE_FORMAT(po.expected_delivery_date, '%Y-%m-%d') AS expected_delivery_date,
                    DATE_FORMAT(po.promised_date, '%Y-%m-%d') AS promised_date,
                    po.promise_note, po.delivery_ref, po.proposed_by_supplier,
                    ${DAY('po.received_at')} AS received_day,
                    s.id AS supplier_id, s.name AS supplier_name, s.is_active AS supplier_active,
                    s.phone AS supplier_phone, s.payment_terms,
                    (SELECT COUNT(*) FROM users u WHERE u.supplier_id = s.id AND u.role = 'supplier' AND u.is_active = TRUE) AS supplier_logins,
                    (SELECT COUNT(*) FROM po_messages m WHERE m.po_id = po.id) AS message_count
             FROM purchase_orders po
             LEFT JOIN suppliers s ON s.id = po.supplier_id
             WHERE po.status IN ('proposed', 'pending', 'confirmed', 'shipped')
                OR (po.status = 'received' AND po.paid_at IS NULL
                    -- only orders received since payment tracking was switched on
                    AND ${DAY('po.received_at')} >= (SELECT setting_value FROM app_settings WHERE setting_key = 'payment_tracking_since'))
             ORDER BY FIELD(po.status, 'proposed', 'shipped', 'confirmed', 'pending', 'received'),
                      COALESCE(po.promised_date, po.expected_delivery_date) IS NULL,
                      COALESCE(po.promised_date, po.expected_delivery_date), po.id DESC
             LIMIT 300`);
        if (orders.length) {
            const [items] = await pool.query(
                `SELECT pi.po_id, p.name, pi.quantity, pi.confirmed_quantity
                 FROM po_items pi JOIN products p ON p.id = pi.product_id WHERE pi.po_id IN (?)`, [orders.map(o => o.id)]);
            const byOrder = new Map(orders.map(o => [o.id, (o.items = [])]));
            items.forEach(i => byOrder.get(i.po_id)?.push({ name: i.name, quantity: i.quantity, confirmed_quantity: i.confirmed_quantity }));
        }
        orders.forEach(o => {
            o.proposed_by_supplier = !!o.proposed_by_supplier;
            o.supplier_has_login = Number(o.supplier_logins) > 0;
            delete o.supplier_logins;
            o.payment_due = o.status === 'received' ? dueDate(o.received_day, o.payment_terms) : null;
        });
        const [prices] = await pool.query(
            `SELECT pp.id, pp.current_price, pp.proposed_price, pp.note,
                    UNIX_TIMESTAMP(pp.created_at) * 1000 AS created_at,
                    p.name AS product_name, p.sku, p.cost_price AS live_price, p.unit_price AS selling_price,
                    s.name AS supplier_name
             FROM price_proposals pp
             JOIN products p ON p.id = pp.product_id
             JOIN suppliers s ON s.id = pp.supplier_id
             WHERE pp.status = 'pending' ORDER BY pp.created_at LIMIT 100`);
        res.json({ success: true, data: { orders, price_proposals: prices } });
    } catch (e) { fail(res, 'board', e); }
};

exports.setPayment = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const paid = req.body?.paid !== false;
        if (!Number.isInteger(id)) return res.status(404).json({ success: false, message: 'Order not found' });
        const [rows] = await pool.query('SELECT po_number, status, paid_at FROM purchase_orders WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Order not found' });
        // Paying for goods that have not arrived is a different decision from
        // ticking a box; keep this to orders actually received.
        if (rows[0].status !== 'received') return res.status(400).json({ success: false, message: 'Only a received order can be marked paid.' });
        await pool.query('UPDATE purchase_orders SET paid_at = ? WHERE id = ?', [paid ? new Date() : null, id]);
        logAudit(req.user.id, 'update', 'purchase_orders', id,
            { po_number: rows[0].po_number, paid: !!rows[0].paid_at }, { po_number: rows[0].po_number, paid }, req.ip);
        res.json({ success: true, message: paid ? 'Marked as paid.' : 'Marked as unpaid.' });
    } catch (e) { fail(res, 'payment', e); }
};

exports.getMessages = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(404).json({ success: false, message: 'Order not found' });
        const [rows] = await pool.query(
            `SELECT m.id, m.body, m.from_supplier, UNIX_TIMESTAMP(m.created_at) * 1000 AS created_at, u.full_name AS author
             FROM po_messages m LEFT JOIN users u ON u.id = m.user_id
             WHERE m.po_id = ? ORDER BY m.created_at, m.id LIMIT 200`, [id]);
        res.json({ success: true, data: rows.map(r => ({ ...r, from_supplier: !!r.from_supplier })) });
    } catch (e) { fail(res, 'messages', e); }
};

exports.postMessage = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const body = clean(req.body?.body, 1000);
        if (!body) return res.status(400).json({ success: false, message: 'Write a note first.' });
        const [rows] = Number.isInteger(id) ? await pool.query('SELECT id FROM purchase_orders WHERE id = ?', [id]) : [[]];
        if (!rows.length) return res.status(404).json({ success: false, message: 'Order not found' });
        await pool.query('INSERT INTO po_messages (po_id, user_id, from_supplier, body) VALUES (?, ?, 0, ?)', [id, req.user.id, body]);
        res.json({ success: true });
    } catch (e) { fail(res, 'post message', e); }
};

// Accepting a proposed price is what changes the cost in inventory.
exports.decidePrice = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const id = Number(req.params.id);
        const approve = req.body?.approve === true;
        await conn.beginTransaction();
        const [rows] = Number.isInteger(id)
            ? await conn.execute("SELECT * FROM price_proposals WHERE id = ? AND status = 'pending' FOR UPDATE", [id])
            : [[]];
        if (!rows.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'That proposal is no longer waiting.' }); }
        const p = rows[0];
        await conn.execute('UPDATE price_proposals SET status = ?, decided_by = ?, decided_at = NOW() WHERE id = ?',
            [approve ? 'approved' : 'rejected', req.user.id, id]);
        if (approve) {
            // only for a product that supplier still supplies
            await conn.execute('UPDATE products SET cost_price = ? WHERE id = ? AND supplier_id = ?', [p.proposed_price, p.product_id, p.supplier_id]);
        }
        await conn.commit();
        logAudit(req.user.id, 'update', 'price_proposals', id,
            { product_id: p.product_id, price: p.current_price }, { approved: approve, price: p.proposed_price }, req.ip);
        res.json({ success: true, message: approve ? 'Price updated in inventory.' : 'Proposal declined. The price is unchanged.' });
    } catch (e) {
        await conn.rollback();
        fail(res, 'decide price', e);
    } finally { conn.release(); }
};
