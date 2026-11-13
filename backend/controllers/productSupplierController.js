/* A product's suppliers: the main one (products.supplier_id) and any others
   (product_suppliers), compared side by side (Carlo, 14 Nov; mock-up B). */
const pool = require('../config/database');
const logAudit = require('../services/audit');
const SupplierPerformance = require('../models/SupplierPerformance');
const { scorecard, starRating } = require('../utils/supply');
const { compareSuppliers } = require('../utils/supplierCompare');

const DAY = col => `DATE_FORMAT(CONVERT_TZ(${col},'+00:00','+08:00'), '%Y-%m-%d')`;

/* Everyone who supplies the product, main first: [{ supplier_id, name, status, is_main, cost }] */
async function suppliersOf(productId) {
    const [[p]] = await pool.query('SELECT id, name, supplier_id, cost_price FROM products WHERE id = ? AND is_active = TRUE', [productId]);
    if (!p) return null;
    const [rows] = await pool.query(
        `SELECT s.id AS supplier_id, s.name, s.status, s.is_active, (s.id = ?) AS is_main,
                CASE WHEN s.id = ? THEN ? ELSE ps.cost_price END AS cost
         FROM suppliers s
         LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.product_id = ?
         WHERE s.is_active = TRUE AND (s.id = ? OR ps.id IS NOT NULL)
         ORDER BY (s.id = ?) DESC, s.name`,
        [p.supplier_id, p.supplier_id, p.cost_price, p.id, p.supplier_id, p.supplier_id]);
    return { product: p, suppliers: rows.map(r => ({ ...r, is_main: !!Number(r.is_main), cost: r.cost == null ? (r.is_main ? null : Number(p.cost_price)) : Number(r.cost) })) };
}

exports.getSuppliers = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const found = await suppliersOf(id);
        if (!found) return res.status(404).json({ success: false, message: 'Product not found' });
        const ids = found.suppliers.map(s => s.supplier_id);
        const received = ids.length ? await SupplierPerformance.scorecardOrdersAll() : [];
        // the last batch of THIS product each supplier delivered, with its date
        const [batches] = ids.length ? await pool.query(
            `SELECT po.supplier_id, DATE_FORMAT(pi.expiration_date, '%Y-%m-%d') AS expiry, ${DAY('po.received_at')} AS received_day
             FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
             WHERE pi.product_id = ? AND po.status = 'received' AND pi.expiration_date IS NOT NULL AND po.supplier_id IN (?)
             ORDER BY po.received_at DESC`, [id, ids]) : [[]];
        const lastBatch = new Map();
        batches.forEach(b => { if (!lastBatch.has(b.supplier_id)) lastBatch.set(b.supplier_id, b); });
        const rows = found.suppliers.map(s => {
            const score = scorecard(received.filter(o => Number(o.supplier_id) === Number(s.supplier_id)));
            const b = lastBatch.get(s.supplier_id);
            const shelf = b && b.received_day ? Math.round((Date.parse(b.expiry + 'T00:00:00Z') - Date.parse(b.received_day + 'T00:00:00Z')) / 86400000) : null;
            return {
                supplier_id: s.supplier_id, name: s.name, status: s.status, is_main: s.is_main, cost: s.cost,
                delivered: score.delivered, average_days: score.average_days, on_time_percent: score.on_time_percent,
                stars: score.delivered ? starRating(score).stars : null,
                last_expiry: b ? b.expiry : null, last_received_day: b ? b.received_day : null, shelf_days: shelf
            };
        });
        const result = compareSuppliers(rows);
        res.json({ success: true, data: { product_id: id, product_name: found.product.name, ...result } });
    } catch (e) {
        console.error('Product suppliers error:', e.message);
        res.status(500).json({ success: false, message: 'Could not load the suppliers of this product' });
    }
};

/* Add another supplier to a product, with its price to the shop. */
exports.addSupplier = async (req, res) => {
    try {
        const id = Number(req.params.id), supplierId = Number(req.body && req.body.supplier_id);
        const priceText = String(req.body && req.body.cost_price != null ? req.body.cost_price : '').trim();
        const found = await suppliersOf(id);
        if (!found) return res.status(404).json({ success: false, message: 'Product not found' });
        if (!Number.isInteger(supplierId) || supplierId <= 0) return res.status(400).json({ success: false, message: 'Choose a supplier.' });
        if (!/^\d+(\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0) return res.status(400).json({ success: false, message: 'Enter the price this supplier charges, more than ₱0, like 560 or 560.50.' });
        if (Number(priceText) > 99999999.99) return res.status(400).json({ success: false, message: 'That price is too large.' });
        if (found.suppliers.some(s => Number(s.supplier_id) === supplierId)) return res.status(400).json({ success: false, message: 'That supplier already supplies this product.' });
        const [[s]] = await pool.query('SELECT id, name, status FROM suppliers WHERE id = ? AND is_active = TRUE', [supplierId]);
        if (!s) return res.status(400).json({ success: false, message: 'That supplier is not on the list any more.' });
        if (s.status === 'deactivated') return res.status(400).json({ success: false, message: `${s.name} is deactivated. Change its status first.` });
        await pool.query('INSERT INTO product_suppliers (product_id, supplier_id, cost_price) VALUES (?, ?, ?)', [id, supplierId, Number(priceText)]);
        logAudit(req.user.id, 'update', 'products', id, null, { supplier_added: s.name, cost_price: Number(priceText) }, req.ip);
        res.status(201).json({ success: true, message: `${s.name} now also supplies ${found.product.name}.` });
    } catch (e) {
        console.error('Add product supplier error:', e.message);
        res.status(500).json({ success: false, message: 'Could not add the supplier' });
    }
};

/* Take a second supplier off a product. The main supplier stays (change it with Edit). */
exports.removeSupplier = async (req, res) => {
    try {
        const id = Number(req.params.id), supplierId = Number(req.params.supplierId);
        const [r] = await pool.query('DELETE FROM product_suppliers WHERE product_id = ? AND supplier_id = ?', [id, supplierId]);
        if (!r.affectedRows) return res.status(404).json({ success: false, message: 'That supplier is not a second supplier of this product.' });
        logAudit(req.user.id, 'update', 'products', id, { supplier_removed: supplierId }, null, req.ip);
        res.json({ success: true, message: 'Supplier removed from this product.' });
    } catch (e) {
        console.error('Remove product supplier error:', e.message);
        res.status(500).json({ success: false, message: 'Could not remove the supplier' });
    }
};

exports._suppliersOf = suppliersOf;
