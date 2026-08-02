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
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, '..', '..', 'ml', 'forecast.py');
const PYTHON = process.env.PYTHON_BIN || 'python3';
const WARMUP = 28;                 // must match ml/forecast.py
const MIN_TRAIN_ROWS = 14;
const MAX_BUFFER = 64 * 1024 * 1024;

/* Only the most recent weeks are fitted — older retail history mostly adds
   noise. This lives here, next to the cache key it feeds, because the window
   and the key have to be decided in the same place: when the caller trimmed
   the series and the lookup did not, every warm entry was filed under a key
   nobody ever asked for, and each product quietly fell back to fitting itself
   in its own Python process. */
const FIT_WINDOW = 56;
function fitSlice(series) {
    return series.length > FIT_WINDOW ? series.slice(-FIT_WINDOW) : series;
}

let cache = new Map();
let pythonBroken = null;           // remembers a failed run so we warn once

function seriesKey(series, days) {
    const first = series.length ? series[0].date : '-';
    const last = series.length ? series[series.length - 1].date : '-';
    // The quantities decide the fit, so they belong in the key.
    let sum = 0, mix = 7;
    for (const p of series) {
        sum += p.quantity;
        mix = (mix * 31 + p.quantity) % 2147483647;
    }
    return `${first}|${last}|${series.length}|${days}|${sum}|${mix}`;
}

function firstDow(series) {
    if (!series.length) return 0;
    return new Date(series[0].date + 'T00:00:00Z').getUTCDay();
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
    }));
}

function runPython(jobs, days) {
    if (!jobs.length) return {};
    if (!fs.existsSync(SCRIPT)) {
        if (!pythonBroken) { pythonBroken = 'model script missing at ' + SCRIPT; console.error('[ML] ' + pythonBroken); }
        return {};
    }
    try {
        const started = Date.now();
        const stdout = execFileSync(PYTHON, [SCRIPT], {
            input: JSON.stringify({ days, jobs }),
            encoding: 'utf8',
            maxBuffer: MAX_BUFFER,
            timeout: 120000,
        });
        // One line per Python process. A healthy request logs one fit of many
        // series; a page of single-series lines means the cache is missing.
        console.log(`[ML] fitted ${jobs.length} series in ${Date.now() - started}ms`);
        pythonBroken = null;
        return JSON.parse(stdout).results || {};
    } catch (err) {
        // Falling back to the statistical baseline is survivable; pretending a
        // model ran is not. Say so loudly, once.
        if (!pythonBroken) {
            pythonBroken = err.message;
            console.error(`[ML] Python forecaster unavailable (${PYTHON}): ${err.message}`);
            console.error('[ML] Forecasts fall back to the statistical baseline until this is fixed.');
        }
        return {};
    }
}

/**
 * Fit every series in one Python process. `list` is [{ series, days }].
 * Series too short to train are skipped here and resolved as null.
 */
function warmMLCache(list) {
    const jobs = [];
    const keyed = [];
    const days = list.length ? list[0].days : 30;

    for (const item of list) {
        const fit = fitSlice(item.series);
        const key = seriesKey(fit, item.days);
        if (cache.has(key)) continue;
        if (fit.length < WARMUP + MIN_TRAIN_ROWS) { cache.set(key, null); continue; }
        jobs.push({ key, series: fit.map(p => p.quantity), first_dow: firstDow(fit), days: item.days });
        keyed.push({ key, series: fit });
    }

    if (!jobs.length) return;
    const results = runPython(jobs, days);
    for (const { key, series } of keyed) {
        cache.set(key, toDated(series, results[key] || null));
    }
}

/**
 * series: [{ date: 'YYYY-MM-DD', quantity }] — continuous calendar days.
 * Returns daily predictions, or null when history is too short to train.
 */
function forecastML(series, days) {
    const fit = fitSlice(series);
    if (fit.length < WARMUP + MIN_TRAIN_ROWS) return null;
    const key = seriesKey(fit, days);
    if (cache.has(key)) return cache.get(key);

    // Cache miss: fit this one series on its own rather than skip the model.
    // After a warm pass this should be rare — a burst of these means the warm
    // list and the callers have drifted apart again.
    const results = runPython(
        [{ key, series: fit.map(p => p.quantity), first_dow: firstDow(fit), days }], days);
    const dated = toDated(fit, results[key] || null);
    cache.set(key, dated);
    return dated;
}

function clearMLCache() { cache = new Map(); }

/** True when a real Python fit has succeeded and no failure is outstanding. */
function mlAvailable() { return pythonBroken === null; }

module.exports = { forecastML, warmMLCache, clearMLCache, mlAvailable, WARMUP };
