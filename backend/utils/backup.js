/* Full-database backup.

   buildBackup() dumps every table into one JSON file inside a ZIP. It is used
   by the admin download button, the daily backup email, and the daily sales
   simulation (which saves a copy to disk before it writes anything).
   Restore with scripts/restore-backup.js.

   ZIP rather than gzip for two reasons: Brevo refuses .gz attachments outright
   ("Unsupported file format: gz"), which meant the daily backup email failed
   every night; and .zip opens with a double-click on the Windows machines the
   shop uses, where .gz needs extra software. */
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { zipSingleFile } = require('./zip');
const { shopToday } = require('./expiry');

async function buildBackup() {
    const conn = await pool.getConnection();
    try {
        const [tables] = await conn.query('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        const dump = { created_at: new Date().toISOString(), database: 'risha', tables: {} };
        for (const t of tableNames) {
            const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
            dump.tables[t] = rows;
        }
        const json = Buffer.from(JSON.stringify(dump));
        const day = shopToday(); // the shop's date, not UTC's
        return {
            zip: zipSingleFile(`risha-backup-${day}.json`, json),
            filename: `risha-backup-${day}.zip`,
            tables: tableNames.length,
            rows: Object.values(dump.tables).reduce((a, r) => a + r.length, 0),
        };
    } finally {
        conn.release();
    }
}

const AUTO_DIR = path.join(__dirname, '..', '..', 'backups', 'auto');

/** Writes a backup to backups/auto/ and keeps the newest `keep` files.
    Throws if anything fails, so a caller can refuse to go on without one. */
async function saveBackupToDisk({ label = 'backup', keep = 14 } = {}) {
    const b = await buildBackup();
    if (!b.rows) throw new Error('backup came back empty');
    fs.mkdirSync(AUTO_DIR, { recursive: true });
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = path.join(AUTO_DIR, `risha-${label}-${stamp}.zip`);
    fs.writeFileSync(file, b.zip);
    if (fs.statSync(file).size !== b.zip.length) throw new Error('backup file did not save completely');
    const old = fs.readdirSync(AUTO_DIR).filter(f => f.endsWith('.zip')).sort().reverse().slice(keep);
    for (const f of old) { try { fs.unlinkSync(path.join(AUTO_DIR, f)); } catch (e) { /* keep going */ } }
    return { file, tables: b.tables, rows: b.rows, bytes: b.zip.length };
}

module.exports = { buildBackup, saveBackupToDisk, AUTO_DIR };
