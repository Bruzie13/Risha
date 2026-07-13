// One-time migration: add users.avatar (MEDIUMTEXT) to hold an uploaded
// profile picture (stored as a resized data URL). Run:  node scripts/add-user-avatar.js
const path = require('path');
const backend = path.join(__dirname, '..', 'backend');
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env') });
const pool = require(path.join(backend, 'config', 'database'));

(async () => {
    try {
        const [c] = await pool.query(
            "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='avatar'");
        if (c.length) { console.log('avatar column already exists — nothing to do.'); process.exit(0); }
        await pool.query('ALTER TABLE users ADD COLUMN avatar MEDIUMTEXT NULL AFTER full_name');
        console.log('✅ Added users.avatar (MEDIUMTEXT).');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    }
})();
