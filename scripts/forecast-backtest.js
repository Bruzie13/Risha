/**
 * forecast-backtest.js
 *
 * Scores the forecast, as the code stands, on fortnights it is not shown.
 *
 * For each fortnight it does what the Stock planning page does when it works
 * out "Forecast accuracy": the 14 days are hidden, every product is forecast
 * from the days before them, and the forecast is compared with what sold. The
 * forecast carries the correction it would have had at the time, which comes
 * from the fortnight before. Nothing from the hidden days, or after them, is
 * used to make the forecast.
 *
 * It reads the database and writes nothing.
 *
 * Usage:  node scripts/forecast-backtest.js                      (the last four fortnights, ending yesterday)
 *         node scripts/forecast-backtest.js 2026-10-10 2026-09-26   (fortnights ending on these days)
 *         node scripts/forecast-backtest.js --json out.json ...      (also save every product's figures)
 *
 * MAE and RMSE are in items. MAPE can only be worked out where something was
 * sold, so the number of cases it rests on is printed beside it. WAPE is the
 * total miss as a share of the total sold. "Bias" is the forecast total
 * against the sold total: above zero means the forecast ran high.
 */
const fs = require('fs');
const path = require('path');
const BACKEND = path.join(__dirname, '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const pool = require(path.join(BACKEND, 'config', 'database'));
const { prepareShop, testShop, forecastSeries, backtestSplit, TUNING } = require(path.join(BACKEND, 'routes', 'predictions'))._internals;
const { factorFor } = require(path.join(BACKEND, 'utils', 'forecastAdjust'));
const ml = require(path.join(BACKEND, 'utils', 'mlForecast'));

const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const shopDay = (off = 0) => new Date(Date.now() + 8 * 3600e3 + off * DAY).toISOString().slice(0, 10);
const sum = a => a.reduce((x, y) => x + y, 0);
const fix = (v, k = 3) => (v == null ? '-' : v.toFixed(k));
const pct = v => (v == null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');

/** pairs: [[forecast, sold], ...] */
function metrics(pairs) {
    const n = pairs.length;
    if (!n) return null;
    const err = pairs.map(([f, a]) => f - a);
    const F = sum(pairs.map(p => p[0])), A = sum(pairs.map(p => p[1]));
    const sold = pairs.filter(p => p[1] > 0);
    return {
        n,
        mae: sum(err.map(Math.abs)) / n,
        rmse: Math.sqrt(sum(err.map(e => e * e)) / n),
        mape: sold.length ? sum(sold.map(([f, a]) => Math.abs(f - a) / a)) / sold.length * 100 : null,
        mapeN: sold.length,
        wape: A > 0 ? sum(err.map(Math.abs)) / A * 100 : null,
        bias: A > 0 ? (F - A) / A * 100 : null,
        forecast: F,
        sold: A
    };
}
const line = m => (m ? `n=${String(m.n).padStart(5)}  MAE ${fix(m.mae)}  RMSE ${fix(m.rmse)}  MAPE ${fix(m.mape, 1)}% (on ${m.mapeN})  WAPE ${fix(m.wape, 1)}%  bias ${pct(m.bias)}  forecast ${fix(m.forecast, 1)} vs sold ${fix(m.sold, 0)}` : 'nothing to score');

(async () => {
    const args = process.argv.slice(2);
    const jsonAt = args.indexOf('--json');
    const jsonFile = jsonAt !== -1 ? args[jsonAt + 1] : null;
    const days = args.filter((a, i) => /^\d{4}-\d{2}-\d{2}$/.test(a) && (jsonAt === -1 || i !== jsonAt + 1));
    const ends = days.length ? days : [0, 1, 2, 3].map(k => addDays(shopDay(-1), -14 * k));

    const [rows] = await pool.query(`
        SELECT si.product_id, p.name, p.category_id, c.name AS category_name,
               si.quantity, s.created_at AS sale_date,
               DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+08:00'), '%Y-%m-%d') AS sale_day
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.payment_status = 'completed'
          AND s.created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
        ORDER BY s.created_at ASC`);
    const byProduct = {};
    rows.forEach(r => {
        const pid = r.product_id;
        if (!byProduct[pid]) byProduct[pid] = { name: r.name, group: r.category_id, category: r.category_name || 'Not set', rows: [] };
        byProduct[pid].rows.push(r);
    });
    console.log(`Read ${rows.length} sale lines for ${Object.keys(byProduct).length} products. Nothing is written.`);
    console.log(`Settings: model share ${TUNING.mlWeight}, model reads the last ${ml.FIT_WINDOW} days, a day's weight halves every ${ml.HALF_LIFE || 'never'} days.\n`);

    const all = [];
    for (const end of ends) {
        ml.clearMLCache();
        const { noData, allSeries, shop } = await prepareShop(byProduct, rows, end, false);
        const { tested, adjustBack } = testShop(byProduct, allSeries, shop);
        const fold = [];
        for (const { pid, data, series, bt } of tested) {
            if (!bt) continue;
            const split = backtestSplit(series);
            // the same forecast day by day, for the per-day figures (already fitted, so this costs nothing)
            const factor = factorFor(adjustBack, data.group);
            const fc = forecastSeries(split.train, split.horizon, { compare: true, shopTypical: shop.back, factor });
            const byDate = new Map(fc.predictions.map(p => [p.date, p.predicted_quantity]));
            fold.push({
                end, product_id: Number(pid), name: data.name, category: data.category,
                forecast: bt.predTotal, before_correction: bt.rawTotal, sold: bt.actualTotal, factor,
                trend_alone: bt.parts ? bt.parts.baseline : null, model_alone: bt.parts ? bt.parts.ml : null,
                daily: split.test.map(d => [byDate.get(d.date) || 0, d.quantity])
            });
        }
        all.push(...fold);
        const from = fold.length ? addDays(end, -13) : '?';
        console.log(`Fortnight ${from} to ${end}: ${fold.length} products${noData.days.size ? ` (${noData.days.size} days left out of every history)` : ''}`);
        console.log('  what the page uses  ' + line(metrics(fold.map(x => [x.forecast, x.sold]))));
        console.log('  before correction   ' + line(metrics(fold.map(x => [x.before_correction, x.sold]))));
        const both = fold.filter(x => x.model_alone != null);
        console.log('  simple trend alone  ' + line(metrics(both.map(x => [x.trend_alone, x.sold]))));
        console.log('  model alone         ' + line(metrics(both.map(x => [x.model_alone, x.sold]))));
        console.log('  correction applied  ' + adjustBack.detail.map(d => `${(Object.values(byProduct).find(p => String(p.group) === d.group) || {}).category || d.group} x${d.factor}`).join(', ') + ` (shop x${adjustBack.shop.toFixed(3)})\n`);
    }

    console.log(`All ${ends.length} fortnights together, per product per fortnight:`);
    console.log('  what the page uses  ' + line(metrics(all.map(x => [x.forecast, x.sold]))));
    console.log('  before correction   ' + line(metrics(all.map(x => [x.before_correction, x.sold]))));
    const both = all.filter(x => x.model_alone != null);
    console.log('  simple trend alone  ' + line(metrics(both.map(x => [x.trend_alone, x.sold]))));
    console.log('  model alone         ' + line(metrics(both.map(x => [x.model_alone, x.sold]))));
    console.log('\nBy category (what the page uses):');
    const cats = [...new Set(all.map(x => x.category))].sort((a, b) => all.filter(x => x.category === b).length - all.filter(x => x.category === a).length);
    for (const cat of cats) console.log(`  ${cat.padEnd(20)}` + line(metrics(all.filter(x => x.category === cat).map(x => [x.forecast, x.sold]))));
    console.log('\nPer product per day (what the page uses):');
    console.log('  ' + line(metrics(all.flatMap(x => x.daily))));

    if (jsonFile) {
        fs.writeFileSync(jsonFile, JSON.stringify({ ends, settings: { mlWeight: TUNING.mlWeight, fitWindow: ml.FIT_WINDOW, halfLife: ml.HALF_LIFE }, rows: all.map(({ daily, ...x }) => x) }, null, 1));
        console.log(`\nSaved every product's figures to ${jsonFile}`);
    }
    process.exit(0);
})().catch(e => { console.error('Stopped: ' + e.message); process.exit(1); });
