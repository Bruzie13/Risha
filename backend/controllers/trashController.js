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
             WHERE s.is_active = FALSE AND s.purged_at IS NULL
             ORDER BY deleted_at DESC LIMIT 500`);
        // accounts only for an administrator, who is the one who can restore them
        let accounts = [];
        if (req.user.role === 'admin') {
            [accounts] = await pool.execute(
                `SELECT u.id, u.username, u.full_name, u.email, u.role,
                        UNIX_TIMESTAMP(u.updated_at) * 1000 AS deleted_at
                 FROM users u WHERE u.is_active = FALSE AND u.purged_at IS NULL
                 ORDER BY u.updated_at DESC LIMIT 500`);
        }
        res.json({ success: true, data: { products, suppliers, accounts, retention_days: await retentionDays() } });
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
        const [r] = await pool.execute('UPDATE suppliers SET is_active = TRUE WHERE id = ? AND is_active = FALSE AND purged_at IS NULL', [id]);
        if (!r.affectedRows) return res.status(400).json({ success: false, message: `${supplier.name} is not in the Trash.` });
        logAudit(req.user.id, 'restore', 'suppliers', id, null, { name: supplier.name }, req.ip);
        res.json({ success: true, message: `${supplier.name} is back on the supplier list. Assign it to products again where needed.` });
    } catch (error) {
        console.error('Restore supplier error:', error);
        res.status(500).json({ success: false, message: 'Error restoring the supplier' });
    }
};

/* ---------- Delete permanently, and how long the Trash keeps things ----------
   (UAT, 31 Oct.) A record deleted for good is marked purged: it leaves the
   Trash and cannot be restored, but its past sales, orders and Activity log
   entries stay, so no report changes. */
const KINDS = {
    products: { table: 'products', label: 'product' },
    suppliers: { table: 'suppliers', label: 'supplier' },
    accounts: { table: 'users', label: 'account' }
};
const RETENTION_KEY = 'trash_retention_days';
const RETENTION_CHOICES = [0, 20, 30, 60];      // 0: never empties itself
const DEFAULT_RETENTION = 30;

async function retentionDays() {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [RETENTION_KEY]);
    const n = rows.length ? Number(rows[0].setting_value) : DEFAULT_RETENTION;
    return RETENTION_CHOICES.includes(n) ? n : DEFAULT_RETENTION;
}
exports.retentionDays = retentionDays;

exports.purge = async (req, res) => {
    try {
        const kind = KINDS[req.params.kind];
        const id = Number(req.params.id);
        if (!kind || !Number.isInteger(id)) return res.status(404).json({ success: false, message: 'Not found in the Trash' });
        if (req.params.kind === 'accounts' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only an administrator can delete an account for good.' });
        }
        const nameCol = kind.table === 'users' ? "COALESCE(NULLIF(full_name, ''), username)" : 'name';
        const [[row]] = await pool.query(`SELECT id, ${nameCol} AS name FROM ${kind.table} WHERE id = ? AND is_active = FALSE AND purged_at IS NULL`, [id]);
        if (!row) return res.status(404).json({ success: false, message: `That ${kind.label} is not in the Trash.` });
        await pool.query(`UPDATE ${kind.table} SET purged_at = NOW() WHERE id = ?`, [id]);
        logAudit(req.user.id, 'purge', kind.table, id, { name: row.name }, null, req.ip);
        res.json({ success: true, message: `${row.name} was deleted permanently.` });
    } catch (error) {
        console.error('Purge error:', error);
        res.status(500).json({ success: false, message: 'Error deleting it permanently' });
    }
};

exports.getSettings = async (req, res) => {
    try { res.json({ success: true, data: { retention_days: await retentionDays(), choices: RETENTION_CHOICES } }); }
    catch (error) { res.status(500).json({ success: false, message: 'Error loading the Trash settings' }); }
};

exports.saveSettings = async (req, res) => {
    try {
        const n = Number(req.body?.retention_days);
        if (!RETENTION_CHOICES.includes(n)) return res.status(400).json({ success: false, message: 'Choose 20, 30 or 60 days, or Never.' });
        await pool.query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [RETENTION_KEY, String(n)]);
        logAudit(req.user.id, 'update', 'app_settings', null, null, { trash_retention_days: n }, req.ip);
        res.json({ success: true, message: n ? `The Trash now keeps things for ${n} days.` : 'The Trash now keeps things until they are deleted by hand.' });
    } catch (error) {
        console.error('Save trash settings error:', error);
        res.status(500).json({ success: false, message: 'Error saving the Trash settings' });
    }
};

/* Run by the scheduler: whatever has waited longer than the chosen number of
   days is deleted for good. (When it went to the Trash is its last change.) */
exports.emptyOld = async () => {
    const days = await retentionDays();
    if (!days) return 0;
    let count = 0;
    for (const table of ['products', 'suppliers', 'users']) {
        const [r] = await pool.query(
            `UPDATE ${table} SET purged_at = NOW()
             WHERE is_active = FALSE AND purged_at IS NULL AND updated_at < NOW() - INTERVAL ? DAY`, [days]);
        count += r.affectedRows;
    }
    if (count) console.log(`[Trash] ${count} item(s) older than ${days} days deleted for good`);
    return count;
};
