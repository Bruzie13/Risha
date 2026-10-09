/**
 * reset-admin-password.js — the last way back in.
 *
 * For when an administrator has forgotten their password AND cannot get the
 * reset email (lost mailbox, email sending broken). It sets a new password
 * directly in the database, so it only works for someone who already has the
 * server's database credentials (backend/.env) — which is the point: that
 * person already controls the system.
 *
 * It will only touch an ADMINISTRATOR account. Everyone else's password is
 * reset from the Users page, by an administrator.
 *
 * The new password is typed at a prompt and never appears on screen, in the
 * command line or in the shell history. Every session of that account is
 * signed out, and the reset is written to the activity log.
 *
 * Usage:  node scripts/reset-admin-password.js <username>
 */
const path = require('path');
const readline = require('readline');
const backend = path.join(__dirname, '..', 'backend');
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env') });
const mysql = require(path.join(backend, 'node_modules', 'mysql2', 'promise'));
const bcrypt = require(path.join(backend, 'node_modules', 'bcryptjs'));
const { validatePassword } = require(path.join(backend, 'utils', 'passwordPolicy'));

function ask(question, hidden) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            // print the question once, then swallow what is typed
            rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
        }
        rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
    });
}

(async () => {
    const username = (process.argv[2] || '').trim();
    if (!username) { console.error('Usage: node scripts/reset-admin-password.js <username>'); process.exit(1); }

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    try {
        const [rows] = await conn.execute('SELECT id, username, full_name, role, is_active FROM users WHERE username = ?', [username]);
        const user = rows[0];
        if (!user) { console.error(`No account is called "${username}".`); process.exit(1); }
        if (user.role !== 'admin') {
            console.error(`"${username}" is not an administrator. Reset it from the Users page instead.`);
            process.exit(1);
        }
        if (!Number(user.is_active)) { console.error(`"${username}" is deactivated. Restore it first.`); process.exit(1); }

        if (!process.stdin.isTTY) { console.error('Run this in a terminal: the new password is typed at a prompt.'); process.exit(1); }
        console.log(`Resetting the password for ${user.full_name || user.username} (${user.username}), administrator.`);
        const first = await ask('New password: ', true);
        const problem = validatePassword(first);
        if (problem) { console.error(problem); process.exit(1); }
        const second = await ask('Type it again: ', true);
        if (first !== second) { console.error('The two passwords are not the same. Nothing was changed.'); process.exit(1); }

        const hash = await bcrypt.hash(first, 10);
        await conn.execute(
            `UPDATE users SET password = ?, token_version = token_version + 1,
                              reset_token_hash = NULL, reset_token_expires = NULL
              WHERE id = ? AND role = 'admin'`,
            [hash, user.id]);
        await conn.execute(
            `INSERT INTO audit_logs (user_id, action, table_name, record_id, ip_address) VALUES (?, 'password_reset_from_server', 'users', ?, 'server script')`,
            [user.id, user.id]).catch(e => console.warn('Password changed, but the activity log entry could not be written:', e.message));
        console.log('Done. The password is changed and every open session of this account has been signed out.');
    } finally {
        await conn.end();
    }
})().catch(e => { console.error(e.message); process.exit(1); });
