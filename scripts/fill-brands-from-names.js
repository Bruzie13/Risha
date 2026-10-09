/**
 * fill-brands-from-names.js
 *
 * Sets products.brand from the start of the product name, for products that
 * have no brand yet. The Analytics page groups expected sales by brand, and
 * with the field empty on every product that chart had nothing to show.
 *
 * Only an empty brand is ever filled; a brand someone typed in is left alone.
 * Names with no recognisable brand (generic items) are left blank on purpose.
 *
 * Usage:  node scripts/fill-brands-from-names.js [--apply]
 * Undo:   node scripts/fill-brands-from-names.js --undo   (clears only the brands in the list below)
 */
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
    .config({ path: path.join(__dirname, '..', 'backend', '.env') });
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));

// name starts with → brand. Longer prefixes first, so "SPECIAL CAT" is not caught by a shorter one.
const BRANDS = [
    ['PROLIFIC TAILS', 'Prolific Tails'], ['DOGGIES CHOICE', "Doggies Choice"], ['FELINE FRESH', 'Feline Fresh'],
    ['SPECIAL CAT', 'Special Cat'], ['SPECIAL DOG', 'Special Dog'], ['TOP BREED', 'Top Breed'], ['PETS OWN', "Pets Own"],
    ['ST. ROCHE', 'St. Roche'], ['MEAT JERKY (SCHMACKOS)', 'Schmackos'], ['DENTASTIX', 'Pedigree'],
    ['NUTRICHUNKS', 'Nutri Chunks'], ['SMARTHEART', 'SmartHeart'], ['PUPPYLOVE', 'Puppy Love'], ['DEXTROVET', 'Dextrovet'],
    ['NACALVIT-C', 'Nacalvit-C'], ['NEMATOCIDE', 'Nematocide'], ['VETNODERM', 'Vetnoderm'], ['POWERCAT', 'Powercat'],
    ['FURMAGIC', 'Furmagic'], ['BRONCURE', 'Broncure'], ['MYCOCIDE', 'Mycocide'], ['RENACURE', 'Renacure'],
    ['PEDIGREE', 'Pedigree'], ['INFINITY', 'Infinity'], ['HOLISTIC', 'Holistic'], ['VITALITY', 'Vitality'],
    ['BAYOPET', 'Bayopet'], ['BEARING', 'Bearing'], ['BEEFPRO', 'BeefPro'], ['GOODBOY', 'Good Boy'], ['JERHIGH', 'JerHigh'],
    ['KITEKAT', 'Kitekat'], ['MONELLO', 'Monello'], ['NEXGARD', 'NexGard'], ['PETMARA', 'Petmara'], ['SPECTRA', 'NexGard Spectra'],
    ['VETCORE', 'Vetcore'], ['WHISKAS', 'Whiskas'], ['ENMALAC', 'Enmalac'], ['TOEICAT', 'Toei'], ['TOEIDOG', 'Toei'],
    ['DETICK', 'Detick'], ['MONDEX', 'Mondex'], ['REFLEX', 'Reflex'], ['WHOOPY', 'Whoopy'], ['YUMYUM', 'Yumyum'],
    ['PETYUM', 'Petyum'], ['ENER-G', 'Ener-G'], ['CHLOE', 'Chloe'], ['LCVIT', 'LC-Vit'], ['IOZIN', 'Iozin'], ['SEVIN', 'Sevin'],
    ['AOZI', 'Aozi'], ['COSI', 'Cosi'], ['LORI', 'Lori'], ['PAPI', 'Papi'], ['MDC', 'MDC'], ['ZOI', 'Zoi'],
].sort((a, b) => b[0].length - a[0].length);

function brandFor(name) {
    const n = String(name || '').trim().toUpperCase();
    for (const [prefix, brand] of BRANDS) {
        if (n === prefix || n.startsWith(prefix + ' ') || n.startsWith(prefix + '(')) return brand;
    }
    return null;
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    if (process.argv.includes('--undo')) {
        const names = [...new Set(BRANDS.map(b => b[1]))];
        const [r] = await conn.query('UPDATE products SET brand = NULL WHERE brand IN (?)', [names]);
        console.log(`cleared brand on ${r.affectedRows} products`);
        await conn.end(); return;
    }
    const [rows] = await conn.query("SELECT id, name FROM products WHERE brand IS NULL OR TRIM(brand) = '' ORDER BY name");
    const plan = rows.map(r => ({ ...r, brand: brandFor(r.name) }));
    const set = plan.filter(p => p.brand), blank = plan.filter(p => !p.brand);
    const byBrand = {};
    set.forEach(p => { (byBrand[p.brand] = byBrand[p.brand] || []).push(p.name); });
    Object.keys(byBrand).sort().forEach(b => console.log(`${b.padEnd(16)} ${byBrand[b].length}  ${byBrand[b].join(', ')}`));
    console.log(`\nwould set a brand on ${set.length} products (${Object.keys(byBrand).length} brands)`);
    console.log(`left blank (${blank.length}): ${blank.map(p => p.name).join(', ') || '-'}`);
    if (!process.argv.includes('--apply')) { console.log('\nDry run. Re-run with --apply to write.'); await conn.end(); return; }
    await conn.beginTransaction();
    try {
        for (const p of set) {
            await conn.execute("UPDATE products SET brand = ? WHERE id = ? AND (brand IS NULL OR TRIM(brand) = '')", [p.brand, p.id]);
        }
        await conn.commit();
        console.log(`\nset brand on ${set.length} products`);
    } catch (e) { await conn.rollback(); throw e; }
    await conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
