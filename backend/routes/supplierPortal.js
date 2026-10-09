/* Supplier portal — what a supplier's own login can see and do.

   Every query here is filtered by the supplier the account is tied to, read
   from the database on each request. Nothing takes a supplier id from the
   browser, and an order or product that belongs to someone else answers
   exactly like one that does not exist, so ids cannot be probed.

   This replaced live GPS tracking of deliveries. That depended on a driver
   opening a link and sharing their phone's location; here the supplier simply
   tells the shop what it needs to know — when the order will arrive, what is
   actually on it, and the paperwork number to check it against. */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const PurchaseOrder = require('../models/PurchaseOrder');
const Notification = require('../models/Notification');
const logAudit = require('../services/audit');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { dueDate, promiseProblem, confirmLines, proposalLines, priceProblem, scorecard } = require('../utils/supply');

const DAY = col => `DATE_FORMAT(CONVERT_TZ(${col},'+00:00','+08:00'), '%Y-%m-%d')`;
const PAYMENTS_SINCE = "(SELECT setting_value FROM app_settings WHERE setting_key = 'payment_tracking_since')";
const shopToday = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const notFound = res => bad(res, 'Order not found', 404);
function fail(res, where, e) {
    console.error(`[SupplierPortal] ${where} failed:`, e.message);
    res.status(500).json({ success: false, message: 'That could not be completed. Please try again.' });
}

/** Tell the shop something happened. The wording is ours, never the supplier's. */
function tellShop(title, message, poId, userId) {
    Notification.create({ title, message, type: 'info', related_id: poId || null, related_type: 'purchase_order', user_id: userId })
        .catch(e => console.error('Notif error:', e.message));
}

/** Resolve which supplier this account belongs to, or refuse. */
async function requireSupplier(req, res, next) {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.email, s.phone, s.address, s.city, s.contact_person, s.payment_terms
             FROM users u JOIN suppliers s ON s.id = u.supplier_id
             WHERE u.id = ? AND s.is_active = TRUE`, [req.user.id]);
        if (!rows.length) return bad(res, 'This account is not linked to a supplier yet. Ask the shop to link it.', 403);
        req.supplier = rows[0];
        next();
    } catch (e) { fail(res, 'lookup', e); }
}

/** One of this supplier's orders, or null — never someone else's. */
async function ownOrder(req) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const order = await PurchaseOrder.findById(id);
    return order && Number(order.supplier_id) === Number(req.supplier.id) ? order : null;
}

router.use(authenticateToken, authorizeRole('supplier'), requireSupplier);

/* ---------- Details ---------- */

router.get('/me', (req, res) => res.json({ success: true, data: req.supplier }));

// A supplier may correct how to reach them. The company name, the address
// orders are emailed to and the payment terms stay with the shop: changing
// those changes who gets paid and where orders go.
router.put('/me', async (req, res) => {
    try {
        const next = {
            contact_person: text(req.body?.contact_person, 255),
            phone: text(req.body?.phone, 20),
            address: text(req.body?.address, 500),
            city: text(req.body?.city, 100)
        };
        if (next.phone && !/^[0-9+()\-\s]{5,20}$/.test(next.phone)) return bad(res, 'Enter a phone number using digits, spaces and + ( ) - only.');
        await pool.query('UPDATE suppliers SET contact_person = ?, phone = ?, address = ?, city = ? WHERE id = ?',
            [next.contact_person || null, next.phone || null, next.address || null, next.city || null, req.supplier.id]);
        logAudit(req.user.id, 'update', 'suppliers', req.supplier.id,
            { contact_person: req.supplier.contact_person, phone: req.supplier.phone, address: req.supplier.address, city: req.supplier.city }, next, req.ip);
        res.json({ success: true, message: 'Your details were updated.' });
    } catch (e) { fail(res, 'update details', e); }
});

/* ---------- Products and prices ---------- */

router.get('/products', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT p.id, p.name, p.sku, p.brand, c.name AS category,
                    p.stock_quantity, p.reorder_level, p.cost_price,
                    pp.proposed_price AS pending_price
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN price_proposals pp ON pp.product_id = p.id AND pp.supplier_id = p.supplier_id AND pp.status = 'pending'
             WHERE p.supplier_id = ? AND p.is_active = TRUE
             ORDER BY p.name`, [req.supplier.id]);
        res.json({ success: true, data: rows });
    } catch (e) { fail(res, 'products', e); }
});

// Propose a new price for one product. Nothing changes until the shop agrees.
router.post('/products/:id/price', async (req, res) => {
    try {
        const productId = Number(req.params.id);
        const problem = priceProblem(req.body?.price);
        if (problem) return bad(res, problem);
        const price = Math.round(Number(req.body.price) * 100) / 100;
        const [own] = await pool.query(
            'SELECT id, name, cost_price FROM products WHERE id = ? AND supplier_id = ? AND is_active = TRUE', [productId, req.supplier.id]);
        if (!own.length) return bad(res, 'Product not found', 404);
        if (Number(own[0].cost_price) === price) return bad(res, 'That is already the current price.');
        // one open proposal per product: a new one replaces the old
        await pool.query("DELETE FROM price_proposals WHERE product_id = ? AND supplier_id = ? AND status = 'pending'", [productId, req.supplier.id]);
        await pool.query(
            `INSERT INTO price_proposals (supplier_id, product_id, current_price, proposed_price, note, proposed_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.supplier.id, productId, own[0].cost_price, price, text(req.body?.note, 300) || null, req.user.id]);
        logAudit(req.user.id, 'create', 'price_proposals', productId, { price: own[0].cost_price }, { price }, req.ip);
        tellShop('Price change proposed', `${req.supplier.name} proposed a new price for a product. Review it on the Suppliers page.`, null, req.user.id);
        res.json({ success: true, message: 'Sent to the shop for approval. The current price stays until they agree.' });
    } catch (e) { fail(res, 'propose price', e); }
});

/* ---------- Orders ---------- */

router.get('/orders', async (req, res) => {
    try {
        const [orders] = await pool.query(
            `SELECT po.id, po.po_number, po.status, po.total_amount, po.notes,
                    DATE_FORMAT(po.order_date, '%Y-%m-%d') AS order_date,
                    DATE_FORMAT(po.expected_delivery_date, '%Y-%m-%d') AS expected_delivery_date,
                    DATE_FORMAT(po.promised_date, '%Y-%m-%d') AS promised_date,
                    po.promise_note, po.delivery_ref, po.proposed_by_supplier,
                    ${DAY('po.received_at')} AS received_day,
                    po.paid_at IS NOT NULL AS paid,
                    -- payment is only tracked for orders received since it was switched on
                    (po.status = 'received' AND ${DAY('po.received_at')} >= ${PAYMENTS_SINCE}) AS payment_tracked,
                    (SELECT COUNT(*) FROM po_messages m WHERE m.po_id = po.id) AS message_count
             FROM purchase_orders po
             WHERE po.supplier_id = ?
             ORDER BY po.created_at DESC LIMIT 200`, [req.supplier.id]);
        if (orders.length) {
            const [items] = await pool.query(
                `SELECT pi.id, pi.po_id, p.name, p.sku, pi.quantity, pi.confirmed_quantity, pi.unit_price
                 FROM po_items pi JOIN products p ON p.id = pi.product_id
                 WHERE pi.po_id IN (?)`, [orders.map(o => o.id)]);
            const byOrder = new Map(orders.map(o => [o.id, (o.items = [])]));
            items.forEach(i => byOrder.get(i.po_id)?.push({
                id: i.id, name: i.name, sku: i.sku, quantity: i.quantity,
                confirmed_quantity: i.confirmed_quantity, unit_price: i.unit_price
            }));
        }
        orders.forEach(o => {
            o.paid = !!o.paid;
            o.proposed_by_supplier = !!o.proposed_by_supplier;
            o.payment_tracked = !!o.payment_tracked;
            o.payment_due = o.payment_tracked && !o.paid ? dueDate(o.received_day, req.supplier.payment_terms) : null;
        });
        res.json({ success: true, data: orders });
    } catch (e) { fail(res, 'orders', e); }
});

// Accept an order: say when it will arrive and how much of each line is coming.
router.post('/orders/:id/confirm', async (req, res) => {
    try {
        const order = await ownOrder(req);
        if (!order) return notFound(res);
        if (order.status !== 'pending') return bad(res, 'Only an order waiting for confirmation can be confirmed.');
        const day = String(req.body?.promised_date || '');
        const dateProblem = promiseProblem(day, shopToday());
        if (dateProblem) return bad(res, dateProblem);

        const items = await PurchaseOrder.getPOItems(order.id);
        const result = confirmLines(items, req.body?.items);
        if (result.error) return bad(res, result.error);

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            // only while it is still pending — two clicks cannot confirm twice
            const [moved] = await conn.execute(
                `UPDATE purchase_orders
                 SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, NOW()),
                     promised_date = ?, total_amount = ?
                 WHERE id = ? AND status = 'pending'`, [day, result.total, order.id]);
            if (!moved.affectedRows) { await conn.rollback(); return bad(res, 'That order was already updated. Reload the page.'); }
            for (const line of result.lines) {
                await conn.execute('UPDATE po_items SET confirmed_quantity = ? WHERE id = ? AND po_id = ?', [line.confirmed, line.id, order.id]);
            }
            await conn.commit();
        } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

        logAudit(req.user.id, 'update', 'purchase_orders', order.id,
            { po_number: order.po_number, status: 'pending' },
            { po_number: order.po_number, status: 'confirmed', promised_date: day, short_lines: result.short, total: result.total }, req.ip);
        tellShop('Order confirmed by supplier',
            `${order.po_number}: ${req.supplier.name} will deliver on ${day}` + (result.short ? `, with ${result.short} line(s) short of what was ordered.` : ', in full.'),
            order.id, req.user.id);
        res.json({ success: true, message: 'Order confirmed.' });
    } catch (e) { fail(res, 'confirm', e); }
});

// The date has moved. Say the new one and why.
router.put('/orders/:id/promise', async (req, res) => {
    try {
        const order = await ownOrder(req);
        if (!order) return notFound(res);
        if (!['confirmed', 'shipped'].includes(order.status)) return bad(res, 'The delivery date can only be changed on an order that is confirmed or on its way.');
        const day = String(req.body?.promised_date || '');
        const dateProblem = promiseProblem(day, shopToday());
        if (dateProblem) return bad(res, dateProblem);
        const note = text(req.body?.note, 300);
        if (note.length < 3) return bad(res, 'Say briefly why the date changed.');
        await pool.query('UPDATE purchase_orders SET promised_date = ?, promise_note = ? WHERE id = ? AND supplier_id = ?',
            [day, note, order.id, req.supplier.id]);
        logAudit(req.user.id, 'update', 'purchase_orders', order.id, { po_number: order.po_number }, { promised_date: day }, req.ip);
        tellShop('Delivery date changed', `${order.po_number}: ${req.supplier.name} now expects to deliver on ${day}.`, order.id, req.user.id);
        res.json({ success: true, message: 'Delivery date updated.' });
    } catch (e) { fail(res, 'promise', e); }
});

// It has left. The receipt number lets the shop match the delivery to paper.
router.post('/orders/:id/ship', async (req, res) => {
    try {
        const order = await ownOrder(req);
        if (!order) return notFound(res);
        if (order.status !== 'confirmed') return bad(res, 'Only a confirmed order can be marked as shipped.');
        const ref = text(req.body?.delivery_ref, 80);
        if (ref && !/^[A-Za-z0-9 ./#_-]+$/.test(ref)) return bad(res, 'The receipt number can use letters, numbers, spaces and . / # _ - only.');
        const [moved] = await pool.query(
            `UPDATE purchase_orders SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()), delivery_ref = ?
             WHERE id = ? AND status = 'confirmed'`, [ref || null, order.id]);
        if (!moved.affectedRows) return bad(res, 'That order was already updated. Reload the page.');
        logAudit(req.user.id, 'update', 'purchase_orders', order.id,
            { po_number: order.po_number, status: 'confirmed' }, { po_number: order.po_number, status: 'shipped', delivery_ref: ref || null }, req.ip);
        tellShop('Order shipped', `${order.po_number}: ${req.supplier.name} has shipped this order.`, order.id, req.user.id);
        res.json({ success: true, message: 'Order marked as shipped.' });
    } catch (e) { fail(res, 'ship', e); }
});

/* ---------- Notes on an order ---------- */

router.get('/orders/:id/messages', async (req, res) => {
    try {
        const order = await ownOrder(req);
        if (!order) return notFound(res);
        const [rows] = await pool.query(
            `SELECT m.id, m.body, m.from_supplier, UNIX_TIMESTAMP(m.created_at) * 1000 AS created_at,
                    CASE WHEN m.from_supplier = 1 THEN u.full_name ELSE 'Risha Pet Supplies' END AS author
             FROM po_messages m LEFT JOIN users u ON u.id = m.user_id
             WHERE m.po_id = ? ORDER BY m.created_at, m.id LIMIT 200`, [order.id]);
        res.json({ success: true, data: rows.map(r => ({ ...r, from_supplier: !!r.from_supplier })) });
    } catch (e) { fail(res, 'messages', e); }
});

router.post('/orders/:id/messages', async (req, res) => {
    try {
        const order = await ownOrder(req);
        if (!order) return notFound(res);
        const body = text(req.body?.body, 1000);
        if (!body) return bad(res, 'Write a note first.');
        await pool.query('INSERT INTO po_messages (po_id, user_id, from_supplier, body) VALUES (?, ?, 1, ?)', [order.id, req.user.id, body]);
        tellShop('Note from supplier', `${order.po_number}: ${req.supplier.name} left a note on this order.`, order.id, req.user.id);
        res.json({ success: true });
    } catch (e) { fail(res, 'post message', e); }
});

/* ---------- Offer an order ---------- */

// The supplier can see what is running low at the shop, so let them offer to
// fill it. It becomes a real order only if the shop accepts.
router.post('/offers', async (req, res) => {
    try {
        const [mine] = await pool.query(
            'SELECT id, cost_price FROM products WHERE supplier_id = ? AND is_active = TRUE', [req.supplier.id]);
        const result = proposalLines(req.body?.items, new Map(mine.map(p => [Number(p.id), p.cost_price])));
        if (result.error) return bad(res, result.error);
        const day = String(req.body?.promised_date || '');
        const dateProblem = promiseProblem(day, shopToday());
        if (dateProblem) return bad(res, dateProblem);
        const [open] = await pool.query(
            "SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id = ? AND status = 'proposed'", [req.supplier.id]);
        if (Number(open[0].c) >= 5) return bad(res, 'You already have 5 offers waiting for the shop. Wait for an answer before sending more.');

        const order = await PurchaseOrder.create({
            supplier_id: req.supplier.id,
            order_date: shopToday(),
            expected_delivery_date: day,
            total_amount: result.total,
            status: 'proposed',
            notes: text(req.body?.note, 300) || null,
            created_by: req.user.id,
            items: result.lines
        });
        await pool.query('UPDATE purchase_orders SET proposed_by_supplier = 1, promised_date = ? WHERE id = ?', [day, order.id]);
        logAudit(req.user.id, 'create', 'purchase_orders', order.id, null,
            { po_number: order.po_number, proposed_by_supplier: true, total: result.total, lines: result.lines.length }, req.ip);
        tellShop('Order offered by supplier', `${req.supplier.name} offered an order (${order.po_number}). Accept or decline it on the Suppliers page.`, order.id, req.user.id);
        res.status(201).json({ success: true, message: 'Offer sent. It becomes an order if the shop accepts it.' });
    } catch (e) { fail(res, 'offer', e); }
});

/* ---------- Scorecard ---------- */

router.get('/scorecard', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ${DAY('po.created_at')} AS ordered_day,
                    ${DAY('po.received_at')} AS received_day,
                    DATE_FORMAT(COALESCE(po.promised_date, po.expected_delivery_date), '%Y-%m-%d') AS target_day,
                    (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id = po.id
                       AND pi.confirmed_quantity IS NOT NULL AND pi.confirmed_quantity < pi.quantity) AS short_lines
             FROM purchase_orders po
             WHERE po.supplier_id = ? AND po.status = 'received'
               AND po.received_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)`, [req.supplier.id]);
        res.json({ success: true, data: scorecard(rows) });
    } catch (e) { fail(res, 'scorecard', e); }
});

module.exports = router;
