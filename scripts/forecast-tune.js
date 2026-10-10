/**
 * forecast-tune.js
 *
 * How the forecast's settings were chosen: a walk-forward test.
 *
 * Candidates are every combination of
 *     the model's memory      how fast older days fade (half-life) and how far back it reads
 *     the simple trend        its floor, and the days a slow product's level is averaged over
 *     the mix                 the model's share of the final figure, 0 to 1
 *     the last step           none, a correction for the shop's recent trend, or a correction
 *                             for the forecast's own last miss (whole shop, or by category)
 *
 * For each fortnight tested, the settings are chosen using ONLY test windows that had
 * already ended when that fortnight's forecast would have been made. The rule for
 * choosing was fixed before any result was looked at:
 *     1. keep the candidates whose forecast total is within 10% of what sold
 *     2. among those, take the smallest error per product per fortnight (RMSE)
 * So the figures printed for a fortnight are for settings that could not have been
 * fitted to it. The last line gives what the same rule picks from every window on
 * record, which is what the code is set to.
 *
 * Windows start once the shop's sales had settled after the break in May 2026
 * (--from, default 2026-07-04): before that, every method was still catching up
 * with the change of level and no setting could be told from another.
 *
 * It reads the database and writes nothing to it. The forecasts it works out are
 * kept in a file in the system's temporary folder, so a second run is quick.
 * A first run fits the model about 90 times and takes ten minutes or so.
 *
 * Usage:  node scripts/forecast-tune.js
 *         node scripts/forecast-tune.js --test 2026-08-15,2026-08-29,2026-09-12,2026-09-26
 *         node scripts/forecast-tune.js --fresh        (ignore the saved file)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const BACKEND = path.join(__dirname, '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
const pool = require(path.join(BACKEND, 'config', 'database'));
const { buildDailySeries, findNoDataDays, simpleTrend, TUNING } = require(path.join(BACKEND, 'routes', 'predictions'))._internals;
const { capSeries, shopTypical } = require(path.join(BACKEND, 'utils', 'forecastGuards'));
const ml = require(path.join(BACKEND, 'utils', 'mlForecast'));

const HOLD = 14, DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const shopDay = (off = 0) => new Date(Date.now() + 8 * 3600e3 + off * DAY).toISOString().slice(0, 10);
const sum = a => a.reduce((x, y) => x + y, 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i === -1 ? fallback : process.argv[i + 1]; };

const ML = [[0, 365], [30, 365], [60, 365], [0, 120], [30, 120], [60, 120]];       // [half-life, days read]
const TREND = [[0.55, 28], [0.3, 28], [0, 28], [0.55, 14], [0.3, 14], [0, 14]];    // [floor, slow window]
const SHARE = [0, 0.25, 0.5, 0.75, 1];
const LAST = [['none'], ['trend', 1, 0.5], ['trend', 1, 1], ['trend', 1.5, 0.5], ['trend', 1.5, 1], ['miss', 0.5], ['miss', 1], ['miss by category', 0.5], ['miss by category', 1]];
const CANDIDATES = [];
for (const m of ML) for (const t of TREND) for (const w of SHARE) for (const last of LAST) CANDIDATES.push({ m: m.join('/'), t: t.join('/'), w, last });
const OLD = { m: '0/365', t: '0.55/28', w: 0.5, last: ['none'] };      // how the forecast was set before this test

const python = payload => new Promise((resolve, reject) => {
    const child = execFile(ml.PYTHON, [ml.SCRIPT], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600000 }, (err, out) => (err ? reject(err) : resolve(JSON.parse(out))));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
});

/* What every ingredient would have forecast for the 14 days after `cut`, and what sold. */
async function ingredients(products, rows, cut) {
    const end = addDays(cut, HOLD);
    const noData = await findNoDataDays(rows, end);
    const items = products.map(p => ({ p, full: buildDailySeries(p.rows, 365, end, noData.days) })).filter(x => x.full.length >= 42)
        .map(x => ({ p: x.p, train: x.full.slice(0, -HOLD), test: x.full.slice(-HOLD) }));
    if (items.some(x => x.train[x.train.length - 1].date !== cut)) throw new Error(`the window at ${cut} does not line up: a day near it has been left out`);
    const typical = shopTypical(items.map(x => x.train));
    items.forEach(x => { x.capped = capSeries(x.train, typical).series; });
    const perDay = {};
    items.forEach(x => x.train.slice(-28).forEach(d => { perDay[d.date] = (perDay[d.date] || 0) + d.quantity; }));
    const days = Object.keys(perDay).sort();
    const out = {
        shop: { last14: sum(days.slice(-14).map(d => perDay[d])), before14: sum(days.slice(-28, -14).map(d => perDay[d])) },
        products: items.map(x => ({ category: x.p.category, sold: sum(x.test.map(d => d.quantity)), trend: {}, model: {} }))
    };
    for (const [floor, slowWindow] of TREND) {
        const tune = Object.assign({}, TUNING, { floor, slowWindow });
        items.forEach((x, i) => { out.products[i].trend[`${floor}/${slowWindow}`] = sum(simpleTrend(x.capped, HOLD, tune).daily); });
    }
    for (const [halfLife, window] of ML) {
        const jobs = items.map((x, i) => ml.jobFor(String(i), x.capped.length > window ? x.capped.slice(-window) : x.capped, HOLD, false));
        const res = await python({ days: HOLD, half_life: halfLife, jobs });
        items.forEach((x, i) => { const r = res.results[String(i)]; out.products[i].model[`${halfLife}/${window}`] = r ? sum(r.map(d => d.predicted_quantity)) : null; });
    }
    return out;
}

(async () => {
    const from = arg('--from', '2026-07-04');
    const lastCut = addDays(shopDay(-1), -HOLD);
    const cuts = [];
    for (let c = addDays(from, -14); c <= lastCut; c = addDays(c, 7)) cuts.push(c);
    const tests = (arg('--test', '') || cuts.filter(c => c >= addDays(from, 42)).filter((c, i, a) => (a.length - 1 - i) % 2 === 0).slice(-4).join(',')).split(',').filter(Boolean);

    const [rows] = await pool.query(`
        SELECT si.product_id, p.name, c.name AS category, si.quantity, s.created_at AS sale_date,
               DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+08:00'), '%Y-%m-%d') AS sale_day
        FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.payment_status = 'completed' AND s.created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
        ORDER BY s.created_at ASC`);
    const byId = {};
    rows.forEach(r => { (byId[r.product_id] = byId[r.product_id] || { category: r.category || 'Not set', rows: [] }).rows.push(r); });
    const products = Object.values(byId);

    const cacheFile = path.join(os.tmpdir(), `fetch-forecast-tune-${rows.length}.json`);
    const cache = !process.argv.includes('--fresh') && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
    for (const cut of cuts) {
        if (cache[cut]) continue;
        process.stdout.write(`working out the window after ${cut} ...\n`);
        cache[cut] = await ingredients(products, rows, cut);
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }

    const mix = (cut, c) => cache[cut].products.map(p => { const m = p.model[c.m]; return { category: p.category, f: m == null ? p.trend[c.t] : (1 - c.w) * p.trend[c.t] + c.w * m, a: p.sold }; });
    const missFactor = (rowsBefore, strength) => { const F = sum(rowsBefore.map(x => x.f)), A = sum(rowsBefore.map(x => x.a)); return F > 0 && A >= 20 ? clamp(1 + strength * (A / F - 1), 0.6, 1.4) : 1; };
    function forecast(cut, c) {
        const base = mix(cut, c), [kind, a, b] = c.last;
        if (kind === 'none') return base;
        if (kind === 'trend') { const s = cache[cut].shop; const f = s.before14 > 0 && s.last14 > 0 ? clamp(1 + b * (Math.pow(s.last14 / s.before14, a) - 1), 0.6, 1.4) : 1; return base.map(x => ({ ...x, f: x.f * f })); }
        const prev = addDays(cut, -14);
        if (!cache[prev]) return null;
        const before = mix(prev, c), shop = missFactor(before, a);
        if (kind === 'miss') return base.map(x => ({ ...x, f: x.f * shop }));
        const by = {};
        for (const cat of new Set(before.map(x => x.category))) { const r = before.filter(x => x.category === cat); by[cat] = sum(r.map(x => x.a)) >= 20 ? missFactor(r, a) : shop; }
        return base.map(x => ({ ...x, f: x.f * (by[x.category] ?? shop) }));
    }
    const stats = r => { const F = sum(r.map(x => x.f)), A = sum(r.map(x => x.a)); return { n: r.length, mae: sum(r.map(x => Math.abs(x.f - x.a))) / r.length, rmse: Math.sqrt(sum(r.map(x => (x.f - x.a) ** 2)) / r.length), bias: (F - A) / A * 100, F, A }; };
    function choose(windows) {
        const scored = [];
        for (const c of CANDIDATES) { const r = []; let ok = true; for (const cut of windows) { const f = forecast(cut, c); if (!f) { ok = false; break; } r.push(...f); } if (ok) scored.push({ c, s: stats(r) }); }
        const near = scored.filter(x => Math.abs(x.s.bias) <= 10).sort((a, b) => a.s.rmse - b.s.rmse);
        return (near.length ? near : scored.sort((a, b) => Math.abs(a.s.bias) - Math.abs(b.s.bias)))[0];
    }
    const name = c => `model fades by half every ${c.m.split('/')[0] === '0' ? 'never' : c.m.split('/')[0] + ' days'}, reads ${c.m.split('/')[1]} days | trend floor ${c.t.split('/')[0]}, slow window ${c.t.split('/')[1]} | model share ${c.w} | last step: ${c.last.join(' ')}`;
    const line = s => `MAE ${s.mae.toFixed(3)}  RMSE ${s.rmse.toFixed(3)}  bias ${(s.bias >= 0 ? '+' : '') + s.bias.toFixed(1)}%  (${s.F.toFixed(1)} vs ${s.A})`;

    console.log(`\n${CANDIDATES.length} candidates, ${cuts.length} weekly windows from ${cuts[0]}; windows count toward choosing from ${from}. Nothing is written to the database.\n`);
    const old = [], picked = [];
    for (const T of tests) {
        const windows = cuts.filter(c => c >= from && c <= addDays(T, -14));
        if (!windows.length || !cache[T]) { console.log(`${T}: no earlier window to choose from, skipped`); continue; }
        const pick = choose(windows);
        const o = forecast(T, OLD), p = forecast(T, pick.c);
        old.push(...o); picked.push(...p);
        console.log(`Fortnight ${addDays(T, 1)} to ${addDays(T, HOLD)}, settings chosen from ${windows.length} windows that had ended by ${T}:`);
        console.log(`   chosen        ${name(pick.c)}`);
        console.log(`   old settings  ${line(stats(o))}`);
        console.log(`   chosen        ${line(stats(p))}\n`);
    }
    if (old.length) {
        console.log(`The ${tests.length} fortnights together:`);
        console.log(`   old settings  ${line(stats(old))}`);
        console.log(`   chosen        ${line(stats(picked))}`);
        for (const cat of [...new Set(old.map(x => x.category))]) console.log(`   ${cat.padEnd(20)} old ${line(stats(old.filter(x => x.category === cat)))}  ->  chosen ${line(stats(picked.filter(x => x.category === cat)))}`);
    }
    const all = cuts.filter(c => c >= from);
    const final = choose(all);
    console.log(`\nFrom every window on record (${all.length}, ${all[0]} to ${all[all.length - 1]}) the rule picks:`);
    console.log(`   ${name(final.c)}`);
    console.log(`   ${line(final.s)}   (old settings on the same windows: ${line(stats(all.flatMap(c => forecast(c, OLD))))})`);
    process.exit(0);
})().catch(e => { console.error('Stopped: ' + e.message); process.exit(1); });
