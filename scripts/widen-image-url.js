// One-time migration: widen products.image_url so it can hold uploaded images
// (data URLs) and long URLs. Safe/non-destructive — only enlarges the column.
// Run from the repo root:  node scripts/widen-image-url.js
require('dotenv').config({ path: __dirname + '/../backend/.env' });
const pool = require('../backend/config/database');

(async () => {
    try {
        const [before] = await pool.query(
            "SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='products' AND column_name='image_url'");
        console.log('image_url was:', before[0] && before[0].COLUMN_TYPE);
        await pool.query('ALTER TABLE products MODIFY COLUMN image_url MEDIUMTEXT');
        const [after] = await pool.query(
            "SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='products' AND column_name='image_url'");
        console.log('image_url is now:', after[0] && after[0].COLUMN_TYPE);
        console.log('✅ Done — product image upload/URLs will now save.');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    }
})();
