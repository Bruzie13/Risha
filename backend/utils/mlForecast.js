/**
 * Bridge to the Python forecasting model.
 *
 * The demand model itself lives in ml/forecast.py and is built on
 * scikit-learn's RandomForestRegressor and GradientBoostingRegressor. Nothing
 * is fitted in JavaScript: Node owns HTTP, SQL and caching, Python owns the
 * machine learning.
 *
 * WHY A BATCH CACHE
 * The analytics endpoint forecasts ~120 products and backtests each one, so a
 * naive design would start Python — and pay scikit-learn's import cost —
 * several hundred times per request. Instead the caller hands every series it
 * is about to need to warmMLCache() in one go, that runs Python exactly once,
 * and the per-product forecastML() calls then read from memory. This keeps
 * forecastSeries() synchronous, so the surrounding pipeline did not change.
 *
 * A forecastML() call that misses the cache still works — it just runs its own
 * one-job Python process rather than silently degrading to no model at all.
 *
 * WHY THE SERVER WARMS ASYNCHRONOUSLY
 * execFileSync holds the event loop for the whole fit. On a small shared
 * instance that is long enough for every other request — stylesheets, the
 * platform's health check — to be answered 503 while Python works. The routes
 * therefore await warmMLCacheAsync(), which runs the same single Python
 * process without blocking; the synchronous path is left for the rare cache
 * miss and for scripts.
 */
const { execFileSync, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, '..', '..', 'ml', 'forecast.py');
const PYTHON = process.env.PYTHON_BIN || 'python3';
const WARMUP = 28;                 // must match ml/forecast.py
const MIN_TRAIN_ROWS = 14;
const MAX_BUFFER = 64 * 1024 * 1024;
// Generous: a small shared instance takes several times a laptop's ~10s, and
// nothing is blocked while it runs.
const ASYNC_TIMEOUT_MS = 5 * 60 * 1000;

/* How much history the model learns from: up to twelve months, the range the
   study specifies (three to twelve months), so it has a chance of seeing a
   season turn. This lives here, next to the cache key it feeds, because the
   window and the key have to be decided in the same place: when the caller
   trimmed the series and the lookup did not, every warm entry was filed under
   a key nobody ever asked for, and each product quietly fell back to fitting
   itself in its own Python process. */
const FIT_WINDOW = Number(process.env.ML_FIT_WINDOW) || 365;
// Recent days count for more in the fit; a day's weight halves every this
// many days going back (see ml/forecast.py). 0 switches the weighting off.
const HALF_LIFE = process.env.ML_HALF_LIFE !== undefined ? Number(process.env.ML_HALF_LIFE) : 0;
function fitSlice(series) {
    return series.length > FIT_WINDOW ? series.slice(-FIT_WINDOW) : series;
}

let cache = new Map();
let weights = new Map();           // key → the forest's feature weights for that fit
let featureNames = [];
let pythonBroken = null;           // remembers a failed run so we warn once

function seriesKey(series, days, compare) {
    const first = series.length ? series[0].date : '-';
    const last = series.length ? series[series.length - 1].date : '-';
    // The quantities decide the fit, so they belong in the key.
    let sum = 0, mix = 7;
    for (const p of series) {
        sum += p.quantity;
        mix = (mix * 31 + p.quantity) % 2147483647;
    }
    return `${first}|${last}|${series.length}|${days}|${sum}|${mix}|${compare ? 'c' : ''}`;
}

/** One job for the Python model. */
function jobFor(key, fit, days, compare) {
    return { key, series: fit.map(p => p.quantity), first_date: fit[0].date, days, compare: !!compare };
}

/** Turn Python's day offsets back into the dated shape callers expect. */
function toDated(series, preds) {
    if (!preds) return null;
    const DAY_MS = 86400000;
    const lastMs = Date.parse(series[series.length - 1].date + 'T00:00:00Z');
    return preds.map(p => ({
        date: new Date(lastMs + p.date_offset * DAY_MS).toISOString().split('T')[0],
        predicted_quantity: p.predicted_quantity,
        day: p.date_offset,
        // present only on comparison jobs: each learner forecasting alone
        ...(p.rf !== undefined ? { rf: p.rf, gb: p.gb } : {}),
    }));
}

function scriptMissing() {
    if (fs.existsSync(SCRIPT)) return false;
    if (!pythonBroken) { pythonBroken = 'model script missing at ' + SCRIPT; console.error('[ML] ' + pythonBroken); }
    return true;
}

function fitted(stdout, jobs, started) {
    // One line per Python process. A healthy request logs one fit of many
    // series; a page of single-series lines means the cache is missing.
    console.log(`[ML] fitted ${jobs.length} series in ${Date.now() - started}ms`);
    pythonBroken = null;
    const out = JSON.parse(stdout);
    if (Array.isArray(out.features)) featureNames = out.features;
    for (const [key, w] of Object.entries(out.importances || {})) weights.set(key, w);
    return out.results || {};
}

function fitFailed(err) {
    // Falling back to the statistical baseline is survivable; pretending a
    // model ran is not. Say so loudly, once.
    if (!pythonBroken) {
        pythonBroken = err.message;
        console.error(`[ML] Python forecaster unavailable (${PYTHON}): ${err.message}`);
        console.error('[ML] Forecasts fall back to the statistical baseline until this is fixed.');
    }
    return {};
}

function runPython(jobs, days) {
    if (!jobs.length || scriptMissing()) return {};
    try {
        const started = Date.now();
        const stdout = execFileSync(PYTHON, [SCRIPT], {
            input: JSON.stringify({ days, jobs, half_life: HALF_LIFE }),
            encoding: 'utf8',
            maxBuffer: MAX_BUFFER,
            timeout: 120000,
        });
        return fitted(stdout, jobs, started);
    } catch (err) {
        return fitFailed(err);
    }
}

/** Same Python run as runPython, without holding the event loop. Never rejects. */
function runPythonAsync(jobs, days) {
    if (!jobs.length || scriptMissing()) return Promise.resolve({});
    return new Promise(resolve => {
        const started = Date.now();
        const child = execFile(PYTHON, [SCRIPT], {
            encoding: 'utf8',
            maxBuffer: MAX_BUFFER,
            timeout: ASYNC_TIMEOUT_MS,
        }, (err, stdout) => {
            if (err) return resolve(fitFailed(err));
            try { resolve(fitted(stdout, jobs, started)); } catch (e) { resolve(fitFailed(e)); }
        });
        // A Python that died early closes its stdin; without a listener that
        // EPIPE is an unhandled error and takes the server down with it.
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ days, jobs, half_life: HALF_LIFE }));
    });
}

/**
 * Fit every series in one Python process. `list` is [{ series, days }].
 * Series too short to train are skipped here and resolved as null.
 */
function pendingJobs(list) {
    const jobs = [];
    const keyed = [];
    const days = list.length ? list[0].days : 30;

    for (const item of list) {
        const fit = fitSlice(item.series);
        const key = seriesKey(fit, item.days, item.compare);
        if (cache.has(key)) continue;
        if (fit.length < WARMUP + MIN_TRAIN_ROWS) { cache.set(key, null); continue; }
        jobs.push(jobFor(key, fit, item.days, item.compare));
        keyed.push({ key, series: fit });
    }
    return { jobs, keyed, days };
}

function store(keyed, results) {
    for (const { key, series } of keyed) {
        cache.set(key, toDated(series, results[key] || null));
    }
}

function warmMLCache(list) {
    const { jobs, keyed, days } = pendingJobs(list);
    if (!jobs.length) return;
    store(keyed, runPython(jobs, days));
}

/** warmMLCache without blocking the event loop — what the HTTP routes use. */
async function warmMLCacheAsync(list) {
    const { jobs, keyed, days } = pendingJobs(list);
    if (!jobs.length) return;
    store(keyed, await runPythonAsync(jobs, days));
}

/**
 * series: [{ date: 'YYYY-MM-DD', quantity }] — continuous calendar days.
 * Returns daily predictions, or null when history is too short to train.
 */
function forecastML(series, days, compare) {
    const fit = fitSlice(series);
    if (fit.length < WARMUP + MIN_TRAIN_ROWS) return null;
    const key = seriesKey(fit, days, compare);
    if (cache.has(key)) return cache.get(key);

    // Cache miss: fit this one series on its own rather than skip the model.
    // After a warm pass this should be rare — a burst of these means the warm
    // list and the callers have drifted apart again.
    const results = runPython([jobFor(key, fit, days, compare)], days);
    const dated = toDated(fit, results[key] || null);
    cache.set(key, dated);
    return dated;
}

/* What the forest leaned on, averaged over the given series' live fits. Each
   weight is the share of the forest's splitting done on that input, so they
   sum to 1. Returns [] until something has been fitted. */
function featureWeights(seriesList, days) {
    const sums = [];
    let n = 0;
    for (const series of seriesList) {
        const w = weights.get(seriesKey(fitSlice(series), days, false));
        if (!w) continue;
        w.forEach((v, i) => { sums[i] = (sums[i] || 0) + v; });
        n++;
    }
    if (!n) return [];
    return sums.map((v, i) => ({ feature: featureNames[i] || `input ${i + 1}`, weight: Math.round(v / n * 1000) / 1000 }))
        .sort((a, b) => b.weight - a.weight);
}

function clearMLCache() { cache = new Map(); weights = new Map(); }

/** True when a real Python fit has succeeded and no failure is outstanding. */
function mlAvailable() { return pythonBroken === null; }

module.exports = { forecastML, warmMLCache, warmMLCacheAsync, clearMLCache, featureWeights, FIT_WINDOW, mlAvailable, WARMUP };
