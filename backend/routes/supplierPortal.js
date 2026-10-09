/* Supplier portal — what a supplier's own login can see and do.

   Every query here is filtered by the supplier the account is tied to, read
   from the database on each request. Nothing takes a supplier id from the
   browser, so one supplier cannot ask for another's orders by changing a
   number in a URL. */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const PurchaseOrder = require('../models/PurchaseOrder');
const logAudit = require('../services/audit');
const { notifyPOStatusChanged } = require('../services/notifier');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

/** Resolve which supplier this account belongs to, or refuse. */
async function requireSupplier(req, res, next) {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.email, s.phone, s.address, s.city, s.contact_person, s.payment_terms
             FROM users u JOIN suppliers s ON s.id = u.supplier_id
             WHERE u.id = ? AND s.is_active = TRUE`, [req.user.id]);
        if (!rows.length) {
            return res.status(403).json({ success: false, message: 'This account is not linked to a supplier yet. Ask the shop to link it.' });
        }
        req.supplier = rows[0];
        next();
    } catch (e) {
        console.error('[SupplierPortal] lookup failed:', e.message);
        res.status(500).json({ success: false, message: 'Could not load supplier details' });
    }
}

router.use(authenticateToken, authorizeRole('supplier'), requireSupplier);

router.get('/me', (req, res) => {
    res.json({ success: true, data: req.supplier });
});

// The products this supplier provides, with how the shop's stock of each stands.
router.get('/products', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT p.id, p.name, p.sku, p.brand, c.name AS category,
                    p.stock_quantity, p.reorder_level, p.cost_price
             FROM products p LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.supplier_id = ? AND p.is_active = TRUE
             ORDER BY p.name`, [req.supplier.id]);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[SupplierPortal] products failed:', e.message);
        res.status(500).json({ success: false, message: 'Could not load products' });
    }
});

// Purchase orders addressed to this supplier, newest first, with their lines.
router.get('/orders', async (req, res) => {
    try {
        const [orders] = await pool.query(
            `SELECT id, po_number,
                    DATE_FORMAT(order_date, '%Y-%m-%d') AS order_date,
                    DATE_FORMAT(expected_delivery_date, '%Y-%m-%d') AS expected_delivery_date,
                    total_amount, status, notes,
                    confirmed_at, shipped_at, received_at, created_at
             FROM purchase_orders
             WHERE supplier_id = ?
             ORDER BY created_at DESC LIMIT 200`, [req.supplier.id]);
        if (orders.length) {
            const [items] = await pool.query(
                `SELECT pi.po_id, p.name, p.sku, pi.quantity, pi.unit_price, pi.subtotal
                 FROM po_items pi JOIN products p ON p.id = pi.product_id
                 WHERE pi.po_id IN (?)`, [orders.map(o => o.id)]);
            const byOrder = new Map(orders.map(o => [o.id, (o.items = [])]));
            items.forEach(i => byOrder.get(i.po_id)?.push({
                name: i.name, sku: i.sku, quantity: i.quantity, unit_price: i.unit_price, subtotal: i.subtotal
            }));
        }
        res.json({ success: true, data: orders });
    } catch (e) {
        console.error('[SupplierPortal] orders failed:', e.message);
        res.status(500).json({ success: false, message: 'Could not load orders' });
    }
});

// A supplier moves its own order forward: accept it, then say it has shipped.
// Receiving stays with the shop — that step adds stock to the shelves.
const SUPPLIER_STEPS = { pending: 'confirmed', confirmed: 'shipped' };

router.put('/orders/:id/status', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const wanted = String(req.body?.status || '');
        const order = Number.isInteger(id) ? await PurchaseOrder.findById(id) : null;
        // Same answer whether the order does not exist or belongs to someone
        // else, so order numbers cannot be probed.
        if (!order || Number(order.supplier_id) !== Number(req.supplier.id)) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (SUPPLIER_STEPS[order.status] !== wanted) {
            return res.status(400).json({ success: false, message: 'That order cannot be moved to that step.' });
        }
        await PurchaseOrder.updateStatus(id, wanted, {});
        logAudit(req.user.id, 'update', 'purchase_orders', id,
            { po_number: order.po_number, supplier_name: req.supplier.name, status: order.status },
            { po_number: order.po_number, supplier_name: req.supplier.name, status: wanted }, req.ip);
        notifyPOStatusChanged(order, order.status, wanted, req.user.id).catch(e => console.error('Notif error:', e.message));
        res.json({ success: true, message: wanted === 'confirmed' ? 'Order confirmed' : 'Order marked as shipped' });
    } catch (e) {
        console.error('[SupplierPortal] status failed:', e.message);
        res.status(500).json({ success: false, message: 'Could not update the order' });
    }
});

module.exports = router;
