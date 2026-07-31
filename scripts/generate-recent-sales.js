/**
 * generate-recent-sales.js
 *
 * Fills the gap between the last seeded sale and today with realistic POS
 * activity, so the forecasting backtest has a holdout window that actually
 * contains sales.
 *
 * WHY THIS EXISTS
 * The Analytics page scores accuracy by hiding the last 14 days from the model,
 * forecasting them, and grading the result. When the seeded history stops more
 * than a week before "today", those 14 days are nearly empty: the model predicts
 * a normal fortnight, the actual is almost zero, the error exceeds 100% and the
 * headline gets clamped to 0.0%. The model is fine — the data is stale.
 *
 * WHAT IT WRITES
 *   - sales + sale_items only. Stock is deliberately NOT decremented: the
 *     catalogue's stock levels are demo figures set independently of this
 *     synthetic history, and drawing them down would push products to zero and
 *     distort the low-stock and expiry dashboards.
 *   - Timestamps land inside shop hours (06:00-17:00 Philippine time) and are
 *     stored in UTC, matching how the POS writes them.
 *   - Product mix is weighted by what has actually been selling, so each
 *     product's demand series stays coherent for the forecaster.
 *   - Volume matches the recent trading average rather than inventing a spike.
 *
 * Deterministic: same seed in, same rows out.
 *
 * Usage:  node scripts/generate-recent-sales.js [--apply] [--seed=N]
 * Without --apply it prints a plan and writes nothing.
 */
const path = require('path');
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
    .config({ path: path.join(__dirname, '..', 'backend', '.env') });
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));

const APPLY = process.argv.includes('--apply');
const seedArg = process.argv.find(a => a.startsWith('--seed='));
const SEED = seedArg ? parseInt(seedArg.split('=')[1], 10) : 20260801;

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const OPEN_HOUR = 6;      // Risha Pet Supplies trades 6am-5pm
const CLOSE_HOUR = 17;

// Same generator the forecaster uses, so "random" is reproducible.
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rnd = mulberry32(SEED);
const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];

/** 'YYYY-MM-DD HH:MM:SS' in UTC for a given Philippine wall-clock moment. */
function phToUtcString(y, m, d, hh, mm, ss) {
    const utcMs = Date.UTC(y, m - 1, d, hh, mm, ss) - PH_OFFSET_MS;
    const t = new Date(utcMs);
    const p = n => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ` +
           `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: process.env.DB_PORT,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        dateStrings: true,
    });

    const [[bounds]] = await conn.execute(`
        SELECT MAX(DATE(CONVERT_TZ(created_at,'+00:00','+08:00'))) AS last_day,
               DATE(CONVERT_TZ(NOW(),'+00:00','+08:00'))           AS today,
               HOUR(CONVERT_TZ(NOW(),'+00:00','+08:00'))           AS hour_now
        FROM sales`);

    // Typical day, measured from the last 60 days of real trading.
    const [[rate]] = await conn.execute(`
        SELECT COUNT(DISTINCT DATE(CONVERT_TZ(s.created_at,'+00:00','+08:00'))) AS days,
               COUNT(*) AS sales
        FROM sales s WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)`);
    const salesPerDay = Math.max(6, Math.round(rate.sales / Math.max(1, rate.days)));

    // Product mix, weighted by units actually sold. Only sellable stock.
    const [products] = await conn.execute(`
        SELECT p.id, p.unit_price, p.unit_type,
               COALESCE(SUM(si.quantity), 0) AS sold
        FROM products p
        LEFT JOIN sale_items si ON si.product_id = p.id
        WHERE p.is_active = 1
          AND (p.expiration_date IS NULL OR p.expiration_date > CURDATE())
        GROUP BY p.id, p.unit_price, p.unit_type`);

    const weighted = [];
    products.forEach(p => {
        const w = 1 + Math.round(Number(p.sold) / 15);  // popular items appear more often, without swamping the mix
        for (let i = 0; i < w; i++) weighted.push(p);
    });

    // Days to fill: the morning after the last sale, up to yesterday. Today is
    // left alone — if the shop has not opened yet, an empty "today" is correct.
    const days = [];
    const start = new Date(bounds.last_day + 'T00:00:00Z');
    const today = new Date(bounds.today + 'T00:00:00Z');
    for (let t = start.getTime() + 86400000; t < today.getTime(); t += 86400000) {
        days.push(new Date(t));
    }
    if (bounds.hour_now >= CLOSE_HOUR) days.push(today);   // shop has closed, today counts

    console.log(`last day with sales : ${bounds.last_day}`);
    console.log(`today (Manila)      : ${bounds.today} ${bounds.hour_now}:00`);
    console.log(`typical sales/day   : ${salesPerDay}`);
    console.log(`days to fill        : ${days.length}` +
                (days.length ? ` (${days[0].toISOString().slice(0, 10)} .. ${days[days.length - 1].toISOString().slice(0, 10)})` : ''));
    console.log(`sellable products   : ${products.length}`);

    if (!days.length) { console.log('\nNothing to fill.'); await conn.end(); return; }

    // Build every row first so a dry run can show exactly what would land.
    const staff = [1, 3];
    const planned = [];
    for (const day of days) {
        const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
        const dow = day.getUTCDay();
        // Weekends run busier, as retail does.
        const busy = (dow === 0 || dow === 6) ? 1.25 : 1;
        const count = Math.max(4, Math.round(salesPerDay * busy * (0.75 + rnd() * 0.5)));

        for (let i = 0; i < count; i++) {
            const hh = randInt(OPEN_HOUR, CLOSE_HOUR - 1);
            const created = phToUtcString(y, m, d, hh, randInt(0, 59), randInt(0, 59));
            // Basket shape is matched to the real history (~1.5 units per sale):
            // a pet shop mostly sells one sack or one bottle at a time.
            const r1 = rnd();
            const nLines = r1 < 0.65 ? 1 : r1 < 0.90 ? 2 : 3;
            const lines = [];
            const used = new Set();
            for (let L = 0; L < nLines; L++) {
                const p = pick(weighted);
                if (used.has(p.id)) continue;
                used.add(p.id);
                const r2 = rnd();
                const qty = r2 < 0.75 ? 1 : r2 < 0.93 ? 2 : 3;
                const price = Number(p.unit_price);
                lines.push({ product_id: p.id, quantity: qty, unit_price: price, subtotal: +(qty * price).toFixed(2) });
            }
            if (!lines.length) continue;
            const total = +lines.reduce((a, l) => a + l.subtotal, 0).toFixed(2);
            // Roughly one sale in nine gets a 5% or 10% discount, as in the history.
            const discount = rnd() < 0.11 ? pick([5, 10]) : 0;
            const final = +(total * (1 - discount / 100)).toFixed(2);
            planned.push({ created, total, discount, final, lines, staff: pick(staff) });
        }
    }

    const units = planned.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.quantity, 0), 0);
    console.log(`\nwould create        : ${planned.length} sales, ${units} units, ` +
                `₱${planned.reduce((a, s) => a + s.final, 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);

    if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply to commit.'); await conn.end(); return; }

    await conn.beginTransaction();
    try {
        let n = 0;
        for (const s of planned) {
            // Match the POS's own sale_number shape: SALE-<epoch ms>.
            const saleNumber = 'SALE-' + (Date.parse(s.created + 'Z') + (n % 997));
            const [res] = await conn.execute(
                `INSERT INTO sales (sale_number, customer_name, customer_phone, total_amount,
                                    final_amount, discount, payment_method, payment_status,
                                    notes, created_by, created_at)
                 VALUES (?, NULL, NULL, ?, ?, ?, 'cash', 'completed', 'POS sale', ?, ?)`,
                [saleNumber, s.total, s.final, s.discount, s.staff, s.created]);
            for (const l of s.lines) {
                await conn.execute(
                    `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
                     VALUES (?, ?, ?, ?, ?)`,
                    [res.insertId, l.product_id, l.quantity, l.unit_price, l.subtotal]);
            }
            n++;
        }
        await conn.commit();
        console.log(`\ninserted ${n} sales`);
    } catch (err) {
        await conn.rollback();
        throw err;
    }

    const [[after]] = await conn.execute(`
        SELECT COUNT(*) AS total_sales,
               MAX(DATE(CONVERT_TZ(created_at,'+00:00','+08:00'))) AS last_day
        FROM sales`);
    console.log(`sales now: ${after.total_sales}, last day: ${after.last_day}`);
    await conn.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
