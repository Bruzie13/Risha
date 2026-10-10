/**
 * assign-supplier.js
 *
 * Gives a supplier to the products that have none.
 *
 * A product "has none" when its supplier was never set, or when the supplier
 * it points at has been deleted. Those products cannot be reordered, because
 * an order has to go to someone. This sets them all to one supplier that is
 * still on the list. Products that already have a current supplier are left
 * alone unless --all is given. Deleted products are never touched.
 *
 * Nothing is changed without --apply. With it, the supplier each product had
 * before is first written to backups/ (kept out of git), so it can be undone.
 *
 * Usage:  node scripts/assign-supplier.js "Roger Enteria"            (shows what would change)
 *         node scripts/assign-supplier.js "Roger Enteria" --apply
 *         node scripts/assign-supplier.js "Roger Enteria" --all --apply    (every product, whatever it has now)
 * Undo:   node scripts/assign-supplier.js --undo backups/assign-supplier-<time>.json
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
    .config({ path: path.join(__dirname, '..', 'backend', '.env') });
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const everyProduct = args.includes('--all');
const undoAt = args.indexOf('--undo');
const wanted = args.find(a => !a.startsWith('--') && (undoAt === -1 || a !== args[undoAt + 1]));

(async () => {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    });
    try {
        /* ---- undo ---- */
        if (undoAt !== -1) {
            const file = args[undoAt + 1];
            if (!file || !fs.existsSync(file)) throw new Error('Give the backup file to undo from: --undo backups/assign-supplier-<time>.json');
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            await db.beginTransaction();
            let restored = 0;
            for (const row of saved.products) {
                // only where the product still has the supplier this script gave it
                const [r] = await db.query('UPDATE products SET supplier_id = ? WHERE id = ? AND supplier_id = ?', [row.was, row.id, saved.supplier.id]);
                restored += r.affectedRows;
            }
            await db.commit();
            console.log(`Put back the previous supplier on ${restored} of ${saved.products.length} products.`);
            return;
        }

        /* ---- which supplier ---- */
        if (!wanted) throw new Error('Say which supplier: node scripts/assign-supplier.js "Supplier name" [--apply]');
        const [found] = await db.query(
            'SELECT id, name, email FROM suppliers WHERE is_active = TRUE AND (name = ? OR id = ?)', [wanted, Number(wanted) || 0]);
        if (found.length !== 1) {
            const [all] = await db.query('SELECT id, name FROM suppliers WHERE is_active = TRUE ORDER BY name');
            throw new Error(`No single current supplier is called "${wanted}". Current suppliers: ${all.map(s => `${s.name} (#${s.id})`).join(', ') || 'none'}`);
        }
        const supplier = found[0];

        /* ---- which products ---- */
        const [products] = await db.query(
            `SELECT p.id, p.sku, p.name, p.supplier_id AS was, s.name AS was_name, s.is_active AS was_active
             FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.is_active = TRUE AND (p.supplier_id IS NULL OR p.supplier_id <> ?)
             ORDER BY p.id`, [supplier.id]);
        const noCurrent = products.filter(p => p.was == null || !p.was_active);
        const haveAnother = products.filter(p => p.was != null && p.was_active);
        const change = everyProduct ? products : noCurrent;

        const [[already]] = await db.query('SELECT COUNT(*) AS n FROM products WHERE is_active = TRUE AND supplier_id = ?', [supplier.id]);
        console.log(`Supplier: ${supplier.name} (#${supplier.id})`);
        console.log(`Already with this supplier: ${already.n}`);
        console.log(`With no supplier set: ${noCurrent.filter(p => p.was == null).length}`);
        const byDeleted = {};
        noCurrent.filter(p => p.was != null).forEach(p => { byDeleted[p.was_name] = (byDeleted[p.was_name] || 0) + 1; });
        Object.entries(byDeleted).forEach(([name, n]) => console.log(`Pointing at a deleted supplier (${name}): ${n}`));
        console.log(`With another current supplier: ${haveAnother.length}${haveAnother.length && !everyProduct ? ' (left alone; add --all to move these too)' : ''}`);
        console.log(`${apply ? 'Changing' : 'Would change'}: ${change.length} product${change.length === 1 ? '' : 's'}`);
        if (!change.length) return;
        if (!apply) { console.log('\nNothing was changed. Run again with --apply to do it.'); return; }

        /* ---- save what was there, then change it ---- */
        const dir = path.join(__dirname, '..', 'backups');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `assign-supplier-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), supplier: { id: supplier.id, name: supplier.name }, products: change.map(p => ({ id: p.id, sku: p.sku, was: p.was })) }, null, 1));

        await db.beginTransaction();
        const ids = change.map(p => p.id);
        const [r] = await db.query('UPDATE products SET supplier_id = ? WHERE id IN (?) AND is_active = TRUE', [supplier.id, ids]);
        if (r.affectedRows !== ids.length) { await db.rollback(); throw new Error(`Expected to change ${ids.length} products but ${r.affectedRows} matched; nothing was changed.`); }
        // one line in the activity log, so the change is on record
        await db.query(
            'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [null, 'update', 'products', null, JSON.stringify({ note: 'supplier missing or deleted', products: ids.length }),
             JSON.stringify({ supplier_id: supplier.id, supplier_name: supplier.name, products: ids.length, by: 'scripts/assign-supplier.js' }), 'script']);
        await db.commit();
        console.log(`\nDone: ${r.affectedRows} products now have ${supplier.name} as their supplier.`);
        console.log(`To undo:  node scripts/assign-supplier.js --undo ${path.relative(path.join(__dirname, '..'), file)}`);
    } catch (e) {
        try { await db.rollback(); } catch (x) { /* nothing open */ }
        console.error('Stopped: ' + e.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
