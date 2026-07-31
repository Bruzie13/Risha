/**
 * repair-sale-totals.js
 *
 * Fixes two defects in the seeded sales history. Both come from the Python
 * generator; sales written by the POS are already correct.
 *
 * 1. HEADERS THAT DO NOT MATCH THEIR LINES
 *    817 of 1,592 sales have total_amount != SUM(sale_items.subtotal), off in
 *    both directions. Open one in Sales History and the receipt contradicts
 *    itself; every report built on the header disagrees with one built on the
 *    lines.
 *
 * 2. THE discount COLUMN MEANS TWO DIFFERENT THINGS
 *    The seed wrote a PESO AMOUNT (final_amount = total_amount - discount,
 *    true for all 176 discounted rows). The POS writes a PERCENT — it sends
 *    discount_percent, clamped 0-100, straight into the same column. No POS
 *    sale has used a discount yet, so the clash has never surfaced, but the
 *    first 10% sale would store "10" next to historical rows storing "1084".
 *
 *    The implied rates in the seeded data are exactly 5% and 10% (88 rows
 *    each), so converting amount -> percent is lossless. Percent is the unit
 *    the application code already assumes, so that is what the column becomes.
 *
 * After this runs, for every sale:
 *    total_amount = SUM(sale_items.subtotal)
 *    discount     = a percentage, 0-100
 *    final_amount = total_amount * (1 - discount/100)
 *
 * Usage:  node scripts/repair-sale-totals.js [--apply]
 * Without --apply it reports what it would change and writes nothing.
 */
const path = require('path');
// Dependencies live in backend/node_modules, matching the other maintenance scripts.
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
    .config({ path: path.join(__dirname, '..', 'backend', '.env') });
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));

const APPLY = process.argv.includes('--apply');

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    // --- survey -----------------------------------------------------------
    const [[amountRows]] = await conn.execute(`
        SELECT COUNT(*) AS n FROM sales
        WHERE discount > 0
          AND ABS(final_amount - (total_amount - discount)) <= 0.02
          AND ABS(final_amount - total_amount * (1 - discount / 100)) > 0.02`);

    const [broken] = await conn.execute(`
        SELECT s.id, s.total_amount, s.discount, s.final_amount, SUM(si.subtotal) AS items_sum
        FROM sales s JOIN sale_items si ON si.sale_id = s.id
        GROUP BY s.id HAVING ABS(s.total_amount - items_sum) > 0.01`);

    console.log(`discount stored as a peso amount (needs converting to %): ${amountRows.n}`);
    console.log(`headers that disagree with their lines:                   ${broken.length}`);

    if (broken.length) {
        console.log('\nsample of the header rebuild:');
        console.table(broken.slice(0, 4).map(r => {
            const rate = Number(r.total_amount) > 0
                ? Math.round(Number(r.discount) / Number(r.total_amount) * 10000) / 100 : 0;
            const newTotal = Number(r.items_sum);
            return {
                id: r.id,
                header_now: Number(r.total_amount),
                lines_say: newTotal,
                rate_pct: rate,
                new_final: +(newTotal * (1 - rate / 100)).toFixed(2),
            };
        }));
    }

    if (!APPLY) {
        console.log('\nDry run — nothing written. Re-run with --apply to commit.');
        await conn.end();
        return;
    }

    await conn.beginTransaction();
    try {
        // Step 1 — amount to percent, using the total the amount was derived from.
        const [conv] = await conn.execute(`
            UPDATE sales
            SET discount = ROUND(discount / total_amount * 100, 2)
            WHERE discount > 0
              AND total_amount > 0
              AND ABS(final_amount - (total_amount - discount)) <= 0.02
              AND ABS(final_amount - total_amount * (1 - discount / 100)) > 0.02`);
        console.log(`discounts converted to percent: ${conv.affectedRows}`);

        // Step 2 — rebuild the header from the lines, then re-apply the rate.
        const [fix] = await conn.execute(`
            UPDATE sales s
            JOIN (SELECT sale_id, SUM(subtotal) AS items_sum FROM sale_items GROUP BY sale_id) t
              ON t.sale_id = s.id
            SET s.total_amount = t.items_sum,
                s.final_amount = ROUND(t.items_sum * (1 - COALESCE(s.discount, 0) / 100), 2)
            WHERE ABS(s.total_amount - t.items_sum) > 0.01`);
        console.log(`headers rebuilt from their lines: ${fix.affectedRows}`);

        // Step 3 — any row whose final no longer follows from total and rate.
        const [refresh] = await conn.execute(`
            UPDATE sales
            SET final_amount = ROUND(total_amount * (1 - COALESCE(discount, 0) / 100), 2)
            WHERE ABS(final_amount - total_amount * (1 - COALESCE(discount, 0) / 100)) > 0.02`);
        console.log(`final_amount recomputed:          ${refresh.affectedRows}`);

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    }

    // --- verify -----------------------------------------------------------
    const [[v]] = await conn.execute(`
        SELECT
          (SELECT COUNT(*) FROM (
              SELECT s.id, s.total_amount AS header, SUM(si.subtotal) AS lines_sum
              FROM sales s JOIN sale_items si ON si.sale_id = s.id
              GROUP BY s.id, s.total_amount HAVING ABS(header - lines_sum) > 0.01) x
          ) AS header_vs_lines_mismatches,
          (SELECT COUNT(*) FROM sales
            WHERE ABS(final_amount - total_amount * (1 - COALESCE(discount,0)/100)) > 0.02
          ) AS final_amount_mismatches,
          (SELECT COUNT(*) FROM sales WHERE discount < 0 OR discount > 100) AS impossible_discounts`);
    console.log('\nafter:');
    console.table([v]);

    await conn.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
