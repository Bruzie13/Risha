#!/usr/bin/env node
/**
 * GO-LIVE RESET — prepares the system for real shop operation by wiping all
 * demo TRANSACTIONS while keeping the catalog, suppliers, and user accounts.
 *
 * What it deletes:  sales, sale_items, purchase orders (+items),
 *                   notifications, email logs, audit logs, cash counts
 * What it keeps:    products, categories, suppliers, users, app settings
 *
 * Usage:
 *   node scripts/go-live-reset.js               # dry run — shows counts only
 *   node scripts/go-live-reset.js --confirm     # backs up first, then wipes
 *
 * Targets backend/.env's database, or DB_URL=mysql://... to override
 * (use the Railway MYSQL_PUBLIC_URL to reset production).
 *
 * After running: do a physical stock count and correct stock_quantity and
 * expiration_date on every product before the first real sale.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));

const WIPE_TABLES = [
    'sale_items', 'sales',
    'po_items', 'purchase_order_items', 'purchase_orders',
    'notifications', 'email_logs', 'audit_logs', 'cash_reconciliations'
];
const KEEP_TABLES = ['products', 'categories', 'suppliers', 'users', 'app_settings'];

(async () => {
    const confirm = process.argv.includes('--confirm');

    let conn;
    if (process.env.DB_URL) {
        conn = await mysql.createConnection(process.env.DB_URL);
        console.log('Target: DB_URL override');
    } else {
        require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
            .config({ path: path.join(__dirname, '..', 'backend', '.env') });
        conn = await mysql.createConnection({
            host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
        });
        console.log('Target: ' + process.env.DB_HOST + '/' + process.env.DB_NAME);
    }

    const [allTables] = await conn.query('SHOW TABLES');
    const existing = new Set(allTables.map(t => Object.values(t)[0]));

    console.log('\n--- Transactions to be WIPED ---');
    for (const t of WIPE_TABLES) {
        if (!existing.has(t)) continue;
        const [[{ c }]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
        console.log(`  ${t.padEnd(24)} ${c} rows`);
    }
    console.log('--- Kept as-is ---');
    for (const t of KEEP_TABLES) {
        if (!existing.has(t)) continue;
        const [[{ c }]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
        console.log(`  ${t.padEnd(24)} ${c} rows`);
    }

    if (!confirm) {
        console.log('\nDRY RUN — nothing changed. Re-run with --confirm to execute.');
        await conn.end();
        return;
    }

    // Safety net: full backup into ./backups before touching anything
    const backupDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const dump = { created_at: new Date().toISOString(), reason: 'pre-go-live-reset', tables: {} };
    for (const t of existing) {
        const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
        dump.tables[t] = rows;
    }
    const backupFile = path.join(backupDir, `pre-golive-${Date.now()}.json.gz`);
    fs.writeFileSync(backupFile, zlib.gzipSync(Buffer.from(JSON.stringify(dump))));
    console.log(`\nBackup written: ${backupFile}`);

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of WIPE_TABLES) {
        if (!existing.has(t)) continue;
        await conn.query(`TRUNCATE TABLE \`${t}\``);
        console.log(`wiped ${t}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.end();

    console.log(`\nGo-live reset complete.
Next steps before the first real sale:
  1. Physical stock count -> correct every product's stock_quantity
  2. Check real expiration dates on shelf items
  3. Verify supplier contact emails are the real ones
  4. Create one account per employee (Users page) and delete demo accounts
  5. Keep the backup file (${path.basename(backupFile)}) somewhere safe`);
})();
