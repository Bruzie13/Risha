// One-time migration: move existing base64 product images out of the database
// and into Cloudinary, replacing products.image_url with the hosted URL.
//
// Prereqs: set CLOUDINARY_URL in backend/.env (same value you put in Render).
// Run from the repo root:  node scripts/migrate-images-to-cloudinary.js
//
// Safe to re-run: rows already holding an http(s) URL are skipped, and each
// product is updated only after its upload succeeds. Nothing is deleted.
const path = require('path');
const backend = path.join(__dirname, '..', 'backend');
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env') });
const pool = require(path.join(backend, 'config', 'database'));
const { storeImage, isConfigured } = require(path.join(backend, 'services', 'imageStore'));

(async () => {
    if (!isConfigured) {
        console.error('❌ CLOUDINARY_URL is not set in backend/.env — nothing to do.');
        process.exit(1);
    }
    try {
        const [rows] = await pool.query(
            "SELECT id, name, image_url FROM products WHERE image_url LIKE 'data:%'");
        console.log(`Found ${rows.length} product image(s) stored as base64.`);
        let migrated = 0, failed = 0;
        for (const p of rows) {
            try {
                const url = await storeImage(p.image_url);
                if (url && !url.startsWith('data:')) {
                    await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [url, p.id]);
                    migrated++;
                    console.log(`  ✓ #${p.id} ${p.name} → ${url}`);
                } else {
                    failed++;
                    console.warn(`  ⚠ #${p.id} ${p.name}: upload returned no URL, left as-is`);
                }
            } catch (e) {
                failed++;
                console.error(`  ✗ #${p.id} ${p.name}: ${e.message}`);
            }
        }
        console.log(`\n✅ Done. Migrated ${migrated}, failed ${failed}, unchanged ${rows.length - migrated - failed}.`);
        process.exit(failed ? 1 : 0);
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    }
})();
