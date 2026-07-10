#!/usr/bin/env node
/**
 * Restore a RISHA backup (.json.gz produced by /api/backup or the daily email).
 *
 * Usage:
 *   node scripts/restore-backup.js path/to/risha-backup-YYYY-MM-DD.json.gz [--confirm]
 *
 * Targets the database from backend/.env by default, or DB_URL=mysql://... to override.
 * Without --confirm it only shows what WOULD be restored.
 * Restoring REPLACES the contents of every table present in the backup.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));

(async () => {
    const file = process.argv[2];
    const confirm = process.argv.includes('--confirm');
    if (!file || !fs.existsSync(file)) {
        console.error('Usage: node scripts/restore-backup.js <backup.json.gz> [--confirm]');
        process.exit(1);
    }

    const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
    console.log(`Backup from ${dump.created_at} — ${Object.keys(dump.tables).length} tables:`);
    for (const [t, rows] of Object.entries(dump.tables)) {
        console.log(`  ${t.padEnd(24)} ${rows.length} rows`);
    }
    if (!confirm) {
        console.log('\nDry run only. Re-run with --confirm to REPLACE the database contents with this backup.');
        process.exit(0);
    }

    let conn;
    if (process.env.DB_URL) {
        conn = await mysql.createConnection(process.env.DB_URL);
    } else {
        require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
            .config({ path: path.join(__dirname, '..', 'backend', '.env') });
        conn = await mysql.createConnection({
            host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
        });
    }

    // JSON serializes DATETIME columns as ISO strings, which strict-mode
    // MySQL rejects — convert back to 'YYYY-MM-DD HH:MM:SS'
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    const toSql = v => {
        if (v && typeof v === 'object') return JSON.stringify(v); // JSON columns round-trip as objects
        if (typeof v === 'string' && ISO_RE.test(v)) return v.slice(0, 19).replace('T', ' ');
        return v;
    };

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const [table, rows] of Object.entries(dump.tables)) {
        await conn.query(`TRUNCATE TABLE \`${table}\``);
        if (!rows.length) { console.log(`restored ${table}: empty`); continue; }
        const cols = Object.keys(rows[0]);
        const placeholders = '(' + cols.map(() => '?').join(',') + ')';
        // insert in chunks of 200
        for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            const values = [];
            chunk.forEach(r => cols.forEach(c => values.push(toSql(r[c]))));
            await conn.query(
                `INSERT INTO \`${table}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES ${chunk.map(() => placeholders).join(',')}`,
                values
            );
        }
        console.log(`restored ${table}: ${rows.length} rows`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.end();
    console.log('\nRestore complete.');
})();
