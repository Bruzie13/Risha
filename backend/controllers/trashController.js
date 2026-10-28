/* The Trash: everything that was deleted but only hidden, so it can be put
   back. Products and suppliers are marked inactive when deleted; an account
   is deactivated. When and by whom comes from the Activity log. Sales are not
   here: deleting one erases it. */
const pool = require('../config/database');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const logAudit = require('../services/audit');

// the latest delete in the Activity log for a record: when, and by whom
const DELETED_BY = (table, alias) => `
    LEFT JOIN audit_logs d ON d.id = (SELECT MAX(a.id) FROM audit_logs a
        WHERE a.table_name = '${table}' AND a.record_id = ${alias}.id AND a.action IN ('delete', 'update'))
    LEFT JOIN users du ON du.id = d.user_id`;

exports.getTrash = async (req, res) => {
    try {
        const products = await Product.getDeleted();
        const [suppliers] = await pool.execute(
            `SELECT s.id, s.name, s.contact_person, s.email, s.city,
                    (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.is_active = TRUE) AS product_count,
                    UNIX_TIMESTAMP(COALESCE(d.created_at, s.updated_at)) * 1000 AS deleted_at, du.full_name AS deleted_by
             FROM suppliers s ${DELETED_BY('suppliers', 's')}
             WHERE s.is_active = FALSE
             ORDER BY deleted_at DESC LIMIT 500`);
        // accounts only for an administrator, who is the one who can restore them
        let accounts = [];
        if (req.user.role === 'admin') {
            [accounts] = await pool.execute(
                `SELECT u.id, u.username, u.full_name, u.email, u.role,
                        UNIX_TIMESTAMP(u.updated_at) * 1000 AS deleted_at
                 FROM users u WHERE u.is_active = FALSE
                 ORDER BY u.updated_at DESC LIMIT 500`);
        }
        res.json({ success: true, data: { products, suppliers, accounts } });
    } catch (error) {
        console.error('Get trash error:', error);
        res.status(500).json({ success: false, message: 'Error loading the Trash' });
    }
};

exports.restoreSupplier = async (req, res) => {
    try {
        const id = Number(req.params.id);
        // Supplier.findById only sees suppliers on the list, so read it directly
        const [[supplier]] = Number.isInteger(id) ? await pool.execute('SELECT id, name, is_active FROM suppliers WHERE id = ?', [id]) : [[null]];
        if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
        if (supplier.is_active) return res.status(400).json({ success: false, message: `${supplier.name} is not in the Trash: it is already on the supplier list.` });
        // another supplier may have been added under the same name meanwhile
        const sameName = await Supplier.nameTaken(supplier.name, id);
        if (sameName) {
            return res.status(409).json({ success: false, message: `${supplier.name} could not be restored: another supplier on the list already has that name. Rename that one first.` });
        }
        const [r] = await pool.execute('UPDATE suppliers SET is_active = TRUE WHERE id = ? AND is_active = FALSE', [id]);
        if (!r.affectedRows) return res.status(400).json({ success: false, message: `${supplier.name} is not in the Trash.` });
        logAudit(req.user.id, 'restore', 'suppliers', id, null, { name: supplier.name }, req.ip);
        res.json({ success: true, message: `${supplier.name} is back on the supplier list. Assign it to products again where needed.` });
    } catch (error) {
        console.error('Restore supplier error:', error);
        res.status(500).json({ success: false, message: 'Error restoring the supplier' });
    }
};
