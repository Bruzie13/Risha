/* The shop's side of working with suppliers: the board of orders in motion,
   notes on an order, marking an order paid, and deciding on prices a supplier
   has proposed. */
const { noteProblem, RECENT_NOTES_SQL } = require('../utils/notes');
const pool = require('../config/database');
const logAudit = require('../services/audit');
const { dueDate, declineReasonProblem, paymentProblem, PAYMENT_METHODS } = require('../utils/supply');

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
                    po.promise_note, po.delivery_ref, po.proposed_by_supplier, po.priority,
                    ${DAY('po.received_at')} AS received_day,
                    s.id AS supplier_id, s.name AS supplier_name, s.is_active AS supplier_active,
                    s.phone AS supplier_phone, s.payment_terms, s.email AS supplier_email,
                    s.contact_person AS supplier_contact, s.status AS supplier_status,
                    (SELECT COUNT(*) FROM users u WHERE u.supplier_id = s.id AND u.role = 'supplier' AND u.is_active = TRUE) AS supplier_logins,
                    (SELECT COUNT(*) FROM po_messages m WHERE m.po_id = po.id) AS message_count
             FROM purchase_orders po
             LEFT JOIN suppliers s ON s.id = po.supplier_id
             WHERE po.status IN ('proposed', 'pending', 'confirmed', 'shipped')
                OR (po.status = 'received' AND po.paid_at IS NULL
                    -- only orders received since payment tracking was switched on
                    AND ${DAY('po.received_at')} >= (SELECT setting_value FROM app_settings WHERE setting_key = 'payment_tracking_since'))
             ORDER BY FIELD(po.status, 'proposed', 'shipped', 'confirmed', 'pending', 'received'), po.priority DESC,
                      COALESCE(po.promised_date, po.expected_delivery_date) IS NULL,
                      COALESCE(po.promised_date, po.expected_delivery_date), po.id DESC
             LIMIT 300`);
        if (orders.length) {
            const [items] = await pool.query(
                `SELECT pi.po_id, p.name, pi.quantity, pi.confirmed_quantity, DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expires
                 FROM po_items pi JOIN products p ON p.id = pi.product_id WHERE pi.po_id IN (?)`, [orders.map(o => o.id)]);
            const byOrder = new Map(orders.map(o => [o.id, (o.items = [])]));
            items.forEach(i => byOrder.get(i.po_id)?.push({ name: i.name, quantity: i.quantity, confirmed_quantity: i.confirmed_quantity, expires: i.expires }));
        }
        orders.forEach(o => {
            o.proposed_by_supplier = !!o.proposed_by_supplier;
            o.supplier_has_login = Number(o.supplier_logins) > 0;
            delete o.supplier_logins;
            o.payment_due = o.status === 'received' ? dueDate(o.received_day, o.payment_terms) : null;
        });
        // the latest payments, each with its receipt
        const [paid] = await pool.query(
            `SELECT po.id, po.po_number, po.total_amount, UNIX_TIMESTAMP(po.paid_at) * 1000 AS paid_at, po.paid_method, s.name AS supplier_name
             FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
             WHERE po.paid_at IS NOT NULL ORDER BY po.paid_at DESC LIMIT 20`);
        paid.forEach(p => { p.method = PAYMENT_METHODS[p.paid_method] || 'Not recorded'; delete p.paid_method; });
        const [prices] = await pool.query(
            `SELECT pp.id, pp.current_price, pp.proposed_price, pp.note,
                    UNIX_TIMESTAMP(pp.created_at) * 1000 AS created_at,
                    p.id AS product_id, p.name AS product_name, p.sku, p.cost_price AS live_price, p.unit_price AS selling_price,
                    s.id AS supplier_id, s.name AS supplier_name
             FROM price_proposals pp
             JOIN products p ON p.id = pp.product_id
             JOIN suppliers s ON s.id = pp.supplier_id
             WHERE pp.status = 'pending' ORDER BY pp.created_at LIMIT 100`);
        // offers that were cancelled in the last 30 days, by the supplier or
        // declined by the shop (UAT part 4, A10)
        const [cancelled] = await pool.query(
            `SELECT po.id, po.po_number, po.total_amount, po.cancel_note, po.cancelled_by_supplier,
                    DATE_FORMAT(po.order_date, '%Y-%m-%d') AS order_date,
                    ${DAY('COALESCE(po.cancelled_at, po.updated_at)')} AS cancelled_day,
                    s.id AS supplier_id, s.name AS supplier_name,
                    (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id = po.id) AS line_count
             FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
             WHERE po.status = 'cancelled' AND po.proposed_by_supplier = 1
               AND COALESCE(po.cancelled_at, po.updated_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             ORDER BY COALESCE(po.cancelled_at, po.updated_at) DESC LIMIT 50`);
        cancelled.forEach(c => { c.cancelled_by_supplier = !!c.cancelled_by_supplier; });
        const [[newCount]] = await pool.query("SELECT COUNT(*) AS n FROM product_offers WHERE status = 'pending'");
        res.json({ success: true, data: { orders, price_proposals: prices, paid, cancelled_offers: cancelled, new_products_waiting: Number(newCount.n) } });
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
        const method = String(req.body?.method || '');
        const ref = String(req.body?.reference || '').trim();
        if (paid) {
            const problem = paymentProblem(method, ref);
            if (problem) return res.status(400).json({ success: false, message: problem });
        }
        await pool.query('UPDATE purchase_orders SET paid_at = ?, paid_method = ?, paid_ref = ?, paid_by = ? WHERE id = ?',
            paid ? [new Date(), method, ref || null, req.user.id, id] : [null, null, null, null, id]);
        logAudit(req.user.id, 'update', 'purchase_orders', id,
            { po_number: rows[0].po_number, paid: !!rows[0].paid_at },
            { po_number: rows[0].po_number, paid, ...(paid ? { method: PAYMENT_METHODS[method], reference: ref || undefined } : {}) }, req.ip);
        res.json({ success: true, message: paid ? 'Marked as paid.' : 'Marked as unpaid.', data: paid ? await paymentReceipt(id) : null });
    } catch (e) { fail(res, 'payment', e); }
};

/* A payment's receipt: what was paid, to whom, how and when. The same for
   the shop and for the supplier. */
async function paymentReceipt(id, supplierId) {
    const [[o]] = await pool.query(
        `SELECT po.id, po.po_number, po.total_amount, po.paid_at, po.paid_method, po.paid_ref,
                DATE_FORMAT(CONVERT_TZ(po.received_at,'+00:00','+08:00'), '%Y-%m-%d') AS received_day,
                s.id AS supplier_id, s.name AS supplier, s.email AS supplier_email, u.full_name AS recorded_by
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN users u ON u.id = po.paid_by
         WHERE po.id = ? AND po.paid_at IS NOT NULL`, [id]);
    if (!o || (supplierId && Number(o.supplier_id) !== Number(supplierId))) return null;
    const [items] = await pool.query(
        `SELECT p.name, COALESCE(pi.confirmed_quantity, pi.quantity) AS quantity, pi.unit_price
         FROM po_items pi JOIN products p ON p.id = pi.product_id WHERE pi.po_id = ? ORDER BY pi.id`, [id]);
    const paidAt = new Date(o.paid_at);
    const stamp = paidAt.toLocaleString('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '');
    return {
        receipt_no: `PAY-${stamp}-${String(o.id).padStart(4, '0')}`,
        po_number: o.po_number, supplier: o.supplier, supplier_email: o.supplier_email,
        amount: Number(o.total_amount), method: PAYMENT_METHODS[o.paid_method] || 'Not recorded', reference: o.paid_ref || null,
        paid_at: paidAt.getTime(), received_day: o.received_day, recorded_by: o.recorded_by || null,
        items: items.map(i => ({ name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }))
    };
}
exports._paymentReceipt = paymentReceipt;

/* Every order has its own receipt too (UAT, 1 Nov: "lahat ng transaction
   dapat may receipt"): what was ordered from whom, where it is, the dates
   along the way and, once paid, the payment's receipt number. */
const ORDER_STAGE = {
    proposed: 'Offer, waiting for the shop', pending: 'Waiting for the supplier to confirm', confirmed: 'Confirmed',
    shipped: 'Shipped', received: 'Received', cancelled: 'Cancelled'
};
async function orderReceipt(id, supplierId) {
    const [[o]] = await pool.query(
        `SELECT po.id, po.po_number, po.status, po.total_amount, po.delivery_ref, po.created_at,
                DATE_FORMAT(COALESCE(po.promised_date, po.expected_delivery_date), '%Y-%m-%d') AS delivery_day,
                po.confirmed_at, po.shipped_at, po.received_at, po.paid_at, po.paid_method, po.paid_ref,
                s.id AS supplier_id, s.name AS supplier, s.email AS supplier_email, s.payment_terms,
                u.full_name AS ordered_by
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN users u ON u.id = po.created_by
         WHERE po.id = ?`, [id]);
    if (!o || (supplierId && Number(o.supplier_id) !== Number(supplierId))) return null;
    const [items] = await pool.query(
        `SELECT p.name, pi.quantity, pi.confirmed_quantity, pi.unit_price
         FROM po_items pi JOIN products p ON p.id = pi.product_id WHERE pi.po_id = ? ORDER BY pi.id`, [id]);
    const ms = d => (d ? new Date(d).getTime() : null);
    const pay = o.paid_at ? await paymentReceipt(id, supplierId) : null;
    return {
        po_number: o.po_number, status: o.status, stage: ORDER_STAGE[o.status] || o.status,
        supplier: o.supplier, supplier_email: o.supplier_email, payment_terms: o.payment_terms || null,
        ordered_by: o.ordered_by || null, ordered_at: ms(o.created_at), delivery_day: o.delivery_day,
        confirmed_at: ms(o.confirmed_at), shipped_at: ms(o.shipped_at), delivery_ref: o.delivery_ref || null,
        received_at: ms(o.received_at),
        payment: pay ? { receipt_no: pay.receipt_no, paid_at: pay.paid_at, method: pay.method } : null,
        total: Number(o.total_amount),
        items: items.map(i => ({
            name: i.name, ordered: Number(i.quantity), unit_price: Number(i.unit_price),
            sending: i.confirmed_quantity == null ? Number(i.quantity) : Number(i.confirmed_quantity)
        }))
    };
}
exports._orderReceipt = orderReceipt;

exports.getOrderReceipt = async (req, res) => {
    try {
        const r = await orderReceipt(Number(req.params.id));
        if (!r) return res.status(404).json({ success: false, message: 'That order was not found.' });
        res.json({ success: true, data: r });
    } catch (e) { fail(res, 'orderReceipt', e); }
};

exports.getReceipt = async (req, res) => {
    try {
        const r = await paymentReceipt(Number(req.params.id));
        if (!r) return res.status(404).json({ success: false, message: 'That order has no payment recorded.' });
        res.json({ success: true, data: r });
    } catch (e) { fail(res, 'receipt', e); }
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
        const [recent] = await pool.query(RECENT_NOTES_SQL, [id, req.user.id]);
        const tooSoon = noteProblem(body, recent);
        if (tooSoon) return res.status(429).json({ success: false, message: tooSoon });
        await pool.query('INSERT INTO po_messages (po_id, user_id, from_supplier, body) VALUES (?, ?, 0, ?)', [id, req.user.id, body]);
        res.json({ success: true });
    } catch (e) { fail(res, 'post message', e); }
};

// Accepting a proposed price is what changes the cost in inventory.
// Declining needs a reason, which the supplier sees on their portal.
exports.decidePrice = async (req, res) => {
    const id = Number(req.params.id);
    const approve = req.body?.approve === true;
    const reason = approve ? null : declineReasonProblem(req.body?.reason);
    if (reason) return res.status(400).json({ success: false, message: reason });
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = Number.isInteger(id)
            ? await conn.execute("SELECT * FROM price_proposals WHERE id = ? AND status = 'pending' FOR UPDATE", [id])
            : [[]];
        if (!rows.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'That proposal is no longer waiting.' }); }
        const p = rows[0];
        const declineReason = approve ? null : String(req.body.reason).trim();
        await conn.execute('UPDATE price_proposals SET status = ?, decided_by = ?, decided_at = NOW(), decline_reason = ? WHERE id = ?',
            [approve ? 'approved' : 'rejected', req.user.id, declineReason, id]);
        if (approve) {
            // only for a product that supplier still supplies
            await conn.execute('UPDATE products SET cost_price = ? WHERE id = ? AND supplier_id = ?', [p.proposed_price, p.product_id, p.supplier_id]);
        }
        await conn.commit();
        logAudit(req.user.id, 'update', 'price_proposals', id,
            { product_id: p.product_id, price: p.current_price }, { approved: approve, price: p.proposed_price, ...(approve ? {} : { reason: declineReason }) }, req.ip);
        res.json({ success: true, message: approve ? 'Price updated in inventory.' : 'Proposal declined. The price is unchanged.' });
    } catch (e) {
        await conn.rollback();
        fail(res, 'decide price', e);
    } finally { conn.release(); }
};

/* One price change, opened (UAT part 4, A11): the product, what the shop pays
   and sells it for now, the margin before and after, the stock and sales
   behind it, who proposed it and the last decisions on this product. */
exports.getPriceDetails = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const [rows] = Number.isInteger(id) ? await pool.query(
            `SELECT pp.id, pp.status, pp.current_price, pp.proposed_price, pp.note, pp.decline_reason,
                    UNIX_TIMESTAMP(pp.created_at) * 1000 AS created_at, UNIX_TIMESTAMP(pp.decided_at) * 1000 AS decided_at,
                    p.id AS product_id, p.name AS product_name, p.sku, p.brand, p.cost_price AS live_price,
                    p.unit_price AS selling_price, p.stock_quantity, p.reorder_level, c.name AS category,
                    s.id AS supplier_id, s.name AS supplier_name, s.contact_person, s.phone, s.email,
                    u.full_name AS proposed_by, d.full_name AS decided_by
             FROM price_proposals pp
             JOIN products p ON p.id = pp.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             JOIN suppliers s ON s.id = pp.supplier_id
             LEFT JOIN users u ON u.id = pp.proposed_by
             LEFT JOIN users d ON d.id = pp.decided_by
             WHERE pp.id = ?`, [id]) : [[]];
        if (!rows.length) return res.status(404).json({ success: false, message: 'That price change was not found.' });
        const r = rows[0];
        const [[sold]] = await pool.query(
            `SELECT COALESCE(SUM(si.quantity), 0) AS units FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
             WHERE si.product_id = ? AND sa.payment_status = 'completed' AND sa.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, [r.product_id]);
        const [history] = await pool.query(
            `SELECT pp.status, pp.current_price, pp.proposed_price, pp.decline_reason,
                    UNIX_TIMESTAMP(COALESCE(pp.decided_at, pp.created_at)) * 1000 AS at
             FROM price_proposals pp WHERE pp.product_id = ? AND pp.id <> ? AND pp.status <> 'pending'
             ORDER BY COALESCE(pp.decided_at, pp.created_at) DESC LIMIT 5`, [r.product_id, id]);
        r.sold_30d = Number(sold.units);
        r.history = history;
        res.json({ success: true, data: r });
    } catch (e) { fail(res, 'price details', e); }
};

/* ---------- New products offered by suppliers (UAT part 4) ---------- */

const NEW_PRODUCT_COLS = `o.id, o.name, o.brand, o.category, o.species, o.unit_type, o.cost_price, o.description,
    o.status, o.decline_reason, o.product_id,
    UNIX_TIMESTAMP(o.created_at) * 1000 AS created_at, UNIX_TIMESTAMP(o.decided_at) * 1000 AS decided_at,
    s.id AS supplier_id, s.name AS supplier_name, s.contact_person, s.phone AS supplier_phone, s.email AS supplier_email,
    u.full_name AS proposed_by, d.full_name AS decided_by`;
const NEW_PRODUCT_FROM = `FROM product_offers o JOIN suppliers s ON s.id = o.supplier_id
    LEFT JOIN users u ON u.id = o.proposed_by LEFT JOIN users d ON d.id = o.decided_by`;

// Waiting ones first, then the last 30 days of answers. Pictures are left out
// of the list (they can be large) and sent with one offer.
exports.getNewProducts = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ${NEW_PRODUCT_COLS}, o.image_url IS NOT NULL AS has_image ${NEW_PRODUCT_FROM}
             WHERE o.status = 'pending' OR COALESCE(o.decided_at, o.created_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             ORDER BY o.status = 'pending' DESC, o.created_at DESC LIMIT 100`);
        rows.forEach(r => { r.has_image = !!r.has_image; });
        res.json({ success: true, data: rows });
    } catch (e) { fail(res, 'new products', e); }
};

exports.getNewProduct = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const [rows] = Number.isInteger(id) ? await pool.query(
            `SELECT ${NEW_PRODUCT_COLS}, o.image_url ${NEW_PRODUCT_FROM} WHERE o.id = ?`, [id]) : [[]];
        if (!rows.length) return res.status(404).json({ success: false, message: 'That offer was not found.' });
        res.json({ success: true, data: rows[0] });
    } catch (e) { fail(res, 'new product', e); }
};

exports.declineNewProduct = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const problem = declineReasonProblem(req.body?.reason);
        if (problem) return res.status(400).json({ success: false, message: problem.replace('this price', 'this product') });
        const reason = String(req.body.reason).trim();
        const [moved] = Number.isInteger(id) ? await pool.query(
            "UPDATE product_offers SET status = 'declined', decline_reason = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'",
            [reason, req.user.id, id]) : [{ affectedRows: 0 }];
        if (!moved.affectedRows) return res.status(404).json({ success: false, message: 'That offer is no longer waiting.' });
        logAudit(req.user.id, 'update', 'product_offers', id, { status: 'pending' }, { status: 'declined', reason }, req.ip);
        res.json({ success: true, message: 'Declined. The supplier sees your reason on their page.' });
    } catch (e) { fail(res, 'decline new product', e); }
};

// Called by the Inventory page once the product has been saved from the offer.
exports.newProductAdded = async (req, res) => {
    try {
        const id = Number(req.params.id), productId = Number(req.body?.product_id);
        if (!Number.isInteger(id) || !Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ success: false, message: 'Say which product was added.' });
        }
        const [offer] = await pool.query("SELECT supplier_id, name FROM product_offers WHERE id = ? AND status = 'pending'", [id]);
        if (!offer.length) return res.status(404).json({ success: false, message: 'That offer is no longer waiting.' });
        const [prod] = await pool.query('SELECT id FROM products WHERE id = ? AND is_active = TRUE', [productId]);
        if (!prod.length) return res.status(404).json({ success: false, message: 'Product not found' });
        await pool.query(
            "UPDATE product_offers SET status = 'added', product_id = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'",
            [productId, req.user.id, id]);
        logAudit(req.user.id, 'update', 'product_offers', id, { status: 'pending' }, { status: 'added', product_id: productId }, req.ip);
        res.json({ success: true, message: `${offer[0].name} is now in Inventory. The supplier sees it was added.` });
    } catch (e) { fail(res, 'new product added', e); }
};
