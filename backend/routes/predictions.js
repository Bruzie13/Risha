const express = require('express');
const router = express.Router();
const { forecastML, warmMLCacheAsync, mlAvailable, featureWeights, FIT_WINDOW: MODEL_DAYS, HALF_LIFE: MODEL_HALF_LIFE } = require('../utils/mlForecast');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { shopTypical, capSeries, isNewProduct, cautiousDailyRate, noDataDays } = require('../utils/forecastGuards');
const { ADJUST, errorFactors, factorFor } = require('../utils/forecastAdjust');

// Up to twelve months of sales, the range the study specifies (3–12 months),
// so weekend, pay-day and seasonal patterns are all inside what the model sees.
const HISTORY_WINDOW_DAYS = 365;
const FORECAST_DAYS = 30;
const DAY_MS = 86400000;

// ---------- Statistical helpers ----------

function linearRegression(yValues) {
    const n = yValues.length;
    if (n < 2) return { slope: 0, intercept: yValues[0] || 0, r2: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += yValues[i];
        sumXY += i * yValues[i];
        sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        const predicted = slope * i + intercept;
        ssRes += (yValues[i] - predicted) ** 2;
        ssTot += (yValues[i] - meanY) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2 };
}

function weightedMovingAverage(values, windowSize) {
    if (values.length === 0) return 0;
    const window = values.slice(-windowSize);
    let totalWeight = 0, weightedSum = 0;
    for (let i = 0; i < window.length; i++) {
        const weight = i + 1;
        weightedSum += window[i] * weight;
        totalWeight += weight;
    }
    return weightedSum / totalWeight;
}

// Holt's double exponential smoothing (level + trend).
// Robust for short, noisy retail series; reacts to recent shifts
// without overreacting to single-day spikes.
function holtSmoothing(values, alpha = 0.35, beta = 0.15) {
    if (!values.length) return { level: 0, trend: 0 };
    let level = values[0];
    let trend = values.length > 1 ? values[1] - values[0] : 0;
    for (let i = 1; i < values.length; i++) {
        const prevLevel = level;
        level = alpha * values[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
    return { level, trend };
}

function stdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

// Confidence blends data volume, model fit and demand stability
// (coefficient of variation). Capped at 95 — never claim certainty.
//
// cv is null when nothing sold in the days looked at. There is then no
// steadiness to judge, so that part scores nothing. It used to score full
// marks, because "no sales" was read as "sales that never vary": the only
// products called "high" were the ones that had stopped selling.
function computeConfidence(dataPoints, r2, cv) {
    const dataScore = Math.min(1, dataPoints / 30) * 35;
    const modelScore = r2 * 30;
    const stabilityScore = cv == null ? 0 : (1 - Math.min(1, cv / 2)) * 35;
    return Math.round(Math.min(95, Math.max(5, dataScore + modelScore + stabilityScore)));
}

// Build a continuous calendar-day series (zero-filled for days without
// sales) from the first sale (capped at maxDays) through YESTERDAY.
// Without zero-fill, a product selling weekly looks like a daily seller
// and every downstream number (daily average, stockout, reorder) inflates.
//
// Two things about "a day" here, both of which used to be wrong:
//   - It is the shop's calendar day. Sales are stored in UTC, and bucketing
//     them by UTC date put everything rung up before 8am on the day before.
//   - Today is left out. It is not over yet, so counting it treats a morning's
//     takings as a whole day's — the forecast reads it as a sudden slump, and
//     the accuracy test, which grades the last two weeks, is marked against a
//     day that is still being sold.
function shopDay(offsetDays = 0) {
    return new Date(Date.now() + 8 * 3600e3 + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function buildDailySeries(rows, maxDays = HISTORY_WINDOW_DAYS, lastDay = shopDay(-1), skip = null) {
    const dailyMap = {};
    rows.forEach(r => {
        const date = r.sale_day || new Date(r.sale_date).toISOString().split('T')[0];
        if (date > lastDay) return;
        dailyMap[date] = (dailyMap[date] || 0) + Number(r.quantity);
    });
    const dates = Object.keys(dailyMap).sort();
    if (!dates.length) return [];
    const endMs = Date.parse(lastDay + 'T00:00:00Z');
    const firstMs = Date.parse(dates[0] + 'T00:00:00Z');
    const startMs = Math.max(firstMs, endMs - (maxDays - 1) * DAY_MS);
    const series = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) {
        const d = new Date(t).toISOString().split('T')[0];
        // days the shop has no usable record for are left out, not counted as zero
        if (skip && skip.has(d)) continue;
        series.push({ date: d, quantity: dailyMap[d] || 0 });
    }
    return series;
}

/* The days to leave out of every product's history (utils/forecastGuards.js):
   days with sales recorded but no items, and closures of three days or more.
   Worked out from the sale lines already read, plus how many sales were
   recorded on each day. */
async function findNoDataDays(rows, lastDay = shopDay(-1)) {
    const soldByDay = new Map();
    let firstDay = null;
    rows.forEach(r => {
        const day = r.sale_day || new Date(r.sale_date).toISOString().split('T')[0];
        if (day > lastDay) return;
        soldByDay.set(day, (soldByDay.get(day) || 0) + Number(r.quantity));
        if (!firstDay || day < firstDay) firstDay = day;
    });
    const [saleDays] = await pool.query(`
        SELECT DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+08:00'), '%Y-%m-%d') AS sale_day, COUNT(*) AS sales
        FROM sales s
        WHERE s.payment_status = 'completed'
          AND s.created_at >= DATE_SUB(NOW(), INTERVAL ${HISTORY_WINDOW_DAYS} DAY)
        GROUP BY sale_day`);
    const salesByDay = new Map(saleDays.map(r => [r.sale_day, Number(r.sales)]));
    return noDataDays(soldByDay, salesByDay, firstDay, lastDay);
}

// Multiplicative day-of-week indices (dampened 50%, clamped) so weekend
// peaks / midweek lulls shape the daily forecast.
function dayOfWeekIndices(series) {
    const sums = Array(7).fill(0), counts = Array(7).fill(0);
    series.forEach(pt => {
        const dow = new Date(pt.date + 'T00:00:00Z').getUTCDay();
        sums[dow] += pt.quantity;
        counts[dow]++;
    });
    const overallAvg = series.reduce((a, p) => a + p.quantity, 0) / (series.length || 1);
    if (overallAvg <= 0) return Array(7).fill(1);
    return sums.map((s, i) => {
        if (counts[i] < 2) return 1;
        const raw = (s / counts[i]) / overallAvg;
        const dampened = 1 + (raw - 1) * 0.5;
        return Math.min(2, Math.max(0.3, dampened));
    });
}

/* A product with under two weeks on record (utils/forecastGuards.js): its sales
   so far spread over two weeks, the same every day. No trend, no day-of-week
   shape and no model, because there is nothing yet to fit them to. */
function cautiousForecast(series, days) {
    const rate = cautiousDailyRate(series);
    const lastMs = Date.parse((series.length ? series[series.length - 1].date : shopDay(-1)) + 'T00:00:00Z');
    const total = series.reduce((a, p) => a + p.quantity, 0);
    const predictions = [];
    for (let i = 1; i <= days; i++) {
        predictions.push({
            date: new Date(lastMs + i * DAY_MS).toISOString().split('T')[0],
            predicted_quantity: Math.round(rate * 100) / 100,
            lower_bound: 0,
            upper_bound: Math.round(rate * 2 * 100) / 100,
            day: i
        });
    }
    return {
        predictions,
        sigma: 0,
        trend: 'stable',
        momentum: '0.0',
        historyDays: series.length,
        historyAvg: series.length ? total / series.length : 0,
        parts: { baseline: rate * days, ml: null, rf: null, gb: null },
        confidence: 10,
        basis: 'new'
    };
}

/* Settings of the forecast.

   They were chosen by a walk-forward test on the shop's own sales: for each
   fortnight tested, the settings were picked using only fortnights that had
   already ended, by a rule fixed beforehand (total within 10% of what sold,
   then the smallest error per product). QA/FORECAST-METHOD.md has the figures.

   The share was 0.5. In every period tested the machine-learning ensemble
   alone had the smaller error per product, and each step toward it helped, so
   a product with enough history is now forecast by the ensemble alone. The
   simple trend still forecasts a product with 14 to 41 days on record, which
   is too little to train on, and stands in if the Python model cannot run. */
const TUNING = {
    mlWeight: 1,        // the machine-learning ensemble's share of the final figure; the simple trend has the rest
    floor: 0.55,        // the simple trend never falls below this share of the product's average over its last two weeks
    slowWindow: 28,     // for a product selling under 1 a day: the days its level is averaged over
    slowShare: 0.85     // ... and how much of its simple trend is that average
};

/* The simple trend: the half of the forecast with no machine learning in it.

   It reads the last 8 weeks only, because its job is to follow the current
   level and older months would drag that. Three estimates are mixed: Holt's
   smoothing (level and a damped trend) 50%, a straight line fitted through
   the 8 weeks 30%, and the average of the last 7 days weighted toward the
   most recent 20%. For a product selling under 1 a day those chase noise, so
   most of its figure is its plain average instead. The result is shaped by
   the day of the week.

   Returns one figure per day ahead, with what the caller needs to describe
   the product (its spread, the fitted line, the days used). */
function simpleTrend(series, days, tune = TUNING) {
    const FIT_WINDOW = 56;
    if (series.length > FIT_WINDOW) series = series.slice(-FIT_WINDOW);
    const quantities = series.map(p => p.quantity);
    const n = quantities.length;
    const total = quantities.reduce((a, b) => a + b, 0);
    const avg = n > 0 ? total / n : 0;
    const reg = linearRegression(quantities);
    const holt = holtSmoothing(quantities);
    const wma = weightedMovingAverage(quantities, Math.min(7, n));
    const dowIdx = n >= 14 ? dayOfWeekIndices(series) : Array(7).fill(1);
    const sigma = stdDev(quantities);
    const lastMs = n ? Date.parse(series[n - 1].date + 'T00:00:00Z') : Date.now();

    // Damped trend (Gardner): a fitted decline/incline flattens out instead of
    // extrapolating linearly to zero (or infinity) across the whole horizon.
    const PHI = 0.88;
    const dampSum = (i) => PHI * (1 - Math.pow(PHI, i)) / (1 - PHI);
    // Recent base demand: the figure may fall below it, but never below a set
    // share of it. A product selling all month doesn't drop to literally zero.
    const recent14 = quantities.slice(-14);
    const floorAvg = recent14.length ? recent14.reduce((a, b) => a + b, 0) / recent14.length : 0;
    // For intermittent demand (avg < 1/day) the plain recent mean is the
    // strongest single predictor — trend models mostly chase noise there.
    const slow = quantities.slice(-tune.slowWindow);
    const slowMean = slow.length ? slow.reduce((a, b) => a + b, 0) / slow.length : 0;

    const daily = [];
    for (let i = 1; i <= days; i++) {
        const holtVal = holt.level + holt.trend * dampSum(i);
        const regVal = reg.slope * (n - 1 + Math.min(i, 14)) + reg.intercept; // cap extrapolation
        let base = 0.5 * holtVal + 0.3 * regVal + 0.2 * wma;
        if (avg < 1) base = tune.slowShare * slowMean + (1 - tune.slowShare) * base;
        base = Math.max(base, floorAvg * tune.floor);
        const d = new Date(lastMs + i * DAY_MS);
        daily.push(Math.max(0, base * dowIdx[d.getUTCDay()]));
    }
    return { daily, sigma, n, avg, reg, quantities, lastMs };
}

// Core forecaster shared by /product/:id and /all. In order: freak days are
// capped; a product with under 14 days on record gets the cautious first
// estimate; otherwise the simple trend and (from 42 days on record) the
// machine-learning ensemble are worked out and mixed in the proportion
// TUNING.mlWeight; last, the correction for the forecast's own recent miss.
// QA/FORECAST-METHOD.md describes each step.
function forecastSeries(series, days = FORECAST_DAYS, opts = {}) {
    // Freak days are capped before either model sees them (utils/forecastGuards.js).
    // The cap is worked out from the series given, so a forecast made from part
    // of a history never uses days it has not seen. This replaced a clip at
    // "average + 4 standard deviations" on the baseline only: a single extreme
    // day drags both of those up with it, and the machine-learning model was
    // given the raw series, extreme day included.
    series = capSeries(series, opts.shopTypical).series;
    if (isNewProduct(series)) return cautiousForecast(series, days);
    // The machine-learning model reads the whole history; the simple trend
    // beside it reads only the last 8 weeks (see simpleTrend).
    const tune = opts.tune || TUNING;
    const fullSeries = series;
    const st = simpleTrend(series, days, tune);
    const { sigma, n, avg, reg, quantities } = st;
    const predictions = st.daily.map((val, i) => ({
        date: new Date(st.lastMs + (i + 1) * DAY_MS).toISOString().split('T')[0],
        predicted_quantity: Math.round(val * 100) / 100,
        lower_bound: Math.max(0, Math.round((val - 1.28 * sigma) * 100) / 100),
        upper_bound: Math.round((val + 1.28 * sigma) * 100) / 100,
        day: i + 1
    }));

    // Random Forest + Gradient Boosting ensemble (thesis method), fitted in
    // Python by ml/forecast.py using scikit-learn, and mixed with the simple
    // trend above in the proportion TUNING.mlWeight (now 1: the ensemble
    // alone). Returns null when history is too short to train, or when the
    // Python model could not be reached — in both cases the simple trend
    // stands alone rather than the forecast failing.
    const mlPreds = forecastML(fullSeries, days, opts.compare);
    // For the backtest: what each part would have forecast by itself over the
    // horizon, so the ensemble can be judged against its own ingredients.
    const sumOf = (rows, field) => rows.reduce((a, p) => a + (Number(p[field]) || 0), 0);
    const parts = { baseline: sumOf(predictions, 'predicted_quantity'), ml: null, rf: null, gb: null };
    if (mlPreds) {
        parts.ml = sumOf(mlPreds, 'predicted_quantity');
        if (mlPreds[0] && mlPreds[0].rf !== undefined) { parts.rf = sumOf(mlPreds, 'rf'); parts.gb = sumOf(mlPreds, 'gb'); }
        for (let i = 0; i < predictions.length; i++) {
            const blended = (1 - tune.mlWeight) * predictions[i].predicted_quantity + tune.mlWeight * mlPreds[i].predicted_quantity;
            predictions[i].predicted_quantity = Math.round(blended * 100) / 100;
            predictions[i].lower_bound = Math.max(0, Math.round((blended - 1.28 * sigma) * 100) / 100);
            predictions[i].upper_bound = Math.round((blended + 1.28 * sigma) * 100) / 100;
        }
    }

    // The last step: the correction for how far off the forecast has just
    // been (utils/forecastAdjust.js). 1 when the caller gives none.
    const factor = Number(opts.factor) > 0 ? Number(opts.factor) : 1;
    if (factor !== 1) {
        for (const p of predictions) {
            p.predicted_quantity = Math.round(p.predicted_quantity * factor * 100) / 100;
            p.lower_bound = Math.round(p.lower_bound * factor * 100) / 100;
            p.upper_bound = Math.round(p.upper_bound * factor * 100) / 100;
        }
    }

    const cv = avg > 0 ? sigma / avg : null; // null: nothing sold, so no steadiness to speak of
    const trend = reg.slope > avg * 0.02 ? 'up' : reg.slope < -avg * 0.02 ? 'down' : 'stable';

    const last7 = quantities.slice(-7);
    const prev7 = quantities.slice(-14, -7);
    const recentAvg = last7.reduce((a, b) => a + b, 0) / (last7.length || 1);
    const prevAvg = prev7.length ? prev7.reduce((a, b) => a + b, 0) / prev7.length : recentAvg;
    const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100).toFixed(1) : '0.0';

    return {
        predictions,
        sigma,
        trend,
        momentum,
        historyDays: fullSeries.length,
        historyAvg: avg,
        parts,
        confidence: computeConfidence(n, reg.r2, cv),
        // what the figure rests on: the model, or the simple trend alone
        basis: mlPreds ? 'model' : 'trend',
        factor
    };
}

/* Every series the pipeline below is about to fit, collected up front so the
   Python model runs once for the whole request instead of once per product.
   These must match exactly what forecastSeries and backtestAccuracy later ask
   for, or the warm pass fills the cache with keys nobody looks up.

   Pass series through whole: mlForecast trims them to its own fit window, and
   trimming here as well is what made the warm cache miss every time. */
function mlJobsFor(series, days = FORECAST_DAYS, shop = {}) {
    // capped exactly as forecastSeries will cap them, or the cache keys differ
    const jobs = [{ series: capSeries(series, shop.live).series, days }];
    const split = backtestSplit(series);
    if (split) {
        // the backtest also asks what each learner would have said alone
        jobs.push({ series: capSeries(split.train, shop.back).series, days: split.horizon, compare: true });
        // and the fortnight before that, which says what correction the
        // backtest's own forecast would have carried at the time
        const earlier = backtestSplit(split.train);
        if (earlier) jobs.push({ series: capSeries(earlier.train, shop.earlier).series, days: earlier.horizon });
    }
    return jobs;
}

/* How the accuracy test divides a history: the last 14 days on record are
   hidden (7 when there are under six weeks), and at least 14 must be left to
   forecast from. The forecast then runs from the day after the rest up to the
   last hidden day. That is the same 14 (or 7) days unless days were left out
   in between, in which case it is longer and only the hidden days are scored. */
function backtestSplit(series) {
    const holdout = series.length >= 42 ? 14 : 7;
    if (series.length < holdout + 14) return null;
    const train = series.slice(0, -holdout);
    const test = series.slice(-holdout);
    const horizon = Math.round((Date.parse(test[test.length - 1].date + 'T00:00:00Z') - Date.parse(train[train.length - 1].date + 'T00:00:00Z')) / DAY_MS);
    return { train, test, holdout, horizon };
}

/* The shop-wide "typical selling day" the outlier cap falls back on, for the
   live forecast and for the accuracy test. The test's figure comes only from
   the days the test is allowed to see. */
function shopTypicals(seriesList) {
    const trainParts = seriesList.map(s => { const split = backtestSplit(s); return split ? split.train : []; });
    const earlierParts = trainParts.map(s => { const split = backtestSplit(s); return split ? split.train : []; });
    return { live: shopTypical(seriesList), back: shopTypical(trainParts), earlier: shopTypical(earlierParts) };
}

/* One test of the forecast on days it was not shown: the last 14 days on
   record are hidden (7 when there are under six weeks), forecast from the days
   before them, and both are totalled. Returns null when the history is too
   short to test.

   The total is scored, not each day: for a product that sells now and then,
   WHICH day a sale lands on is noise, and the volume is what an order is
   planned against. Only the hidden days are scored, since a day left out of
   the history has no sales figure to score against.

   `factor` is the correction the forecast would have carried at the time
   (utils/forecastAdjust.js); `rawTotal` is the forecast before it. */
function holdoutTest(series, shopTypicalQty, compare = false, factor = 1) {
    const split = backtestSplit(series);
    if (!split) return null;
    const { train, test, holdout, horizon } = split;
    const fc = forecastSeries(train, horizon, { compare, shopTypical: shopTypicalQty });
    const hidden = new Set(test.map(x => x.date));
    const rawTotal = fc.predictions.reduce((a, p) => a + (hidden.has(p.date) ? p.predicted_quantity : 0), 0);
    const actualTotal = test.reduce((a, x) => a + x.quantity, 0);
    return {
        train,
        rawTotal,
        predTotal: rawTotal * (fc.basis === 'new' ? 1 : factor),
        actualTotal,
        // each method's own total covers the whole run, so they are only
        // like-for-like when no day was left out of it
        parts: horizon === holdout ? fc.parts : null
    };
}

// Backtest: the accuracy shown on the page. Scored with WAPE (weighted
// absolute percentage error) on the total, which is robust to zero-sale days
// where classic MAPE explodes. Returns accuracy 0–100 or null when there
// isn't enough history to validate.
function backtestAccuracy(series, shop = {}, factor = 1) {
    const t = holdoutTest(series, shop.back, true, factor);
    if (!t) return null;
    const { predTotal, actualTotal, rawTotal } = t;
    // Per-product accuracy needs actual sales to compare against, but the
    // holdout totals are ALWAYS returned: excluding zero-actual products from
    // the store-level sums would bias the aggregate score (only "lucky hot"
    // products would count on the actual side).
    const accuracy = actualTotal > 0
        ? Math.round(Math.max(0, Math.min(100, 100 - (Math.abs(predTotal - actualTotal) / actualTotal) * 100)) * 10) / 10
        : null;
    return { accuracy, predTotal, rawTotal, actualTotal, parts: t.parts };
}

// ---------- Routes ----------

router.get('/product/:id', authenticateToken, async (req, res) => {
    try {
        const stock = parseInt(req.query.stock) || 0;
        const reorderLevel = parseInt(req.query.reorder_level) || 10;
        const leadTime = parseInt(req.query.lead_time) || 7;

        const [rows] = await pool.query(`
            SELECT si.product_id, p.name, p.category_id, si.quantity, s.created_at as sale_date,
                   DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+08:00'), '%Y-%m-%d') AS sale_day
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE si.product_id = ? AND s.payment_status = 'completed'
            ORDER BY s.created_at ASC
        `, [req.params.id]);

        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'No sales data' });
        }

        // The model is fitted on all products together, so this product's
        // forecast should come from that same fit — otherwise the chart here
        // and the figure in the list could disagree. Build it if it is not
        // there yet; after that this product's series is already in the cache.
        if (!allCache.payload) await rebuildAllPredictions().catch(() => {});
        // built the same way as in the list: the same days left out, the same cap
        const series = buildDailySeries(rows, HISTORY_WINDOW_DAYS, shopDay(-1), allCache.skip);
        const shop = allCache.shop || {};
        await warmMLCacheAsync(mlJobsFor(series, FORECAST_DAYS, shop));
        const fc = forecastSeries(series, FORECAST_DAYS, { shopTypical: shop.live, factor: factorFor(allCache.adjust, rows[0].category_id) });

        const nextMonthTotal = Math.round(fc.predictions.reduce((a, p) => a + p.predicted_quantity, 0) * 100) / 100;
        const dailyAvg = nextMonthTotal / FORECAST_DAYS;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;

        // Safety stock at ~95% service level: z * sigma_daily * sqrt(lead time)
        const safetyStock = Math.ceil(1.65 * fc.sigma * Math.sqrt(leadTime));
        const reorderPoint = Math.max(reorderLevel, Math.ceil(dailyAvg * leadTime) + safetyStock);
        const reorderTriggered = stock <= reorderPoint;
        const recommendedQty = Math.max(0, Math.ceil(nextMonthTotal + dailyAvg * leadTime - stock));

        return res.json({
            success: true,
            data: {
                product_id: Number(req.params.id),
                product_name: rows[0].name,
                model: 'Random Forest + Gradient Boosting ensemble (scikit-learn, Python), fitted on all products together over calendar and recent-sales features from the last four months, recent days weighted more; corrected by half of its miss on the most recent two weeks, by product category; a Holt/regression simple trend stands in for products with under six weeks of history',
                model_runtime: mlAvailable() ? 'python/scikit-learn' : 'statistical baseline only (Python model unavailable)',
                historical_data: series,
                predictions: fc.predictions,
                next_month_prediction: nextMonthTotal,
                daily_average: Math.round(dailyAvg * 100) / 100,
                confidence_score: fc.confidence,
                basis: fc.basis,
                adjustment: fc.factor,
                trend: fc.trend,
                trend_momentum: `${fc.momentum}%`,
                days_until_stockout: daysUntilStockout,
                reorder_recommendation: {
                    recommended_reorder_point: reorderPoint,
                    recommended_order_quantity: recommendedQty,
                    safety_stock: safetyStock,
                    lead_time_days: leadTime,
                    reorder_triggered: reorderTriggered,
                    days_until_stockout: daysUntilStockout
                }
            }
        });
    } catch (err) {
        console.error('[Predictions] request failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not load forecast data' });
    }
});

/* Fitting every product costs ~14s of Python on a laptop and considerably
   more on a small cloud instance — long enough that whoever opened Analytics
   after the cache expired watched a spinner until the browser gave up.

   So nobody waits on it: a warm copy is rebuilt in the background on boot and
   on a timer, an expired copy is still served immediately while a fresh one is
   computed behind it, and concurrent callers share one rebuild instead of each
   starting their own Python process. */
const ALL_TTL_MS = 5 * 60 * 1000;
let allCache = { at: 0, payload: null, shop: null, skip: null, adjust: null };
let rebuildInFlight = null;

// Fewer items than this sold across the shop in the test fortnight is too
// little to grade a forecast on.
const MIN_TEST_UNITS = 20;

/** 100 minus the percentage error on total volume, floored at 0 — the same score as the headline accuracy. */
function accuracyOf(predicted, actual) {
    if (!(actual > 0)) return null;
    return Math.round(Math.max(0, Math.min(100, 100 - (Math.abs(predicted - actual) / actual) * 100)) * 10) / 10;
}

/* Every product's history as of `lastDay`, with the model fitted for all of
   them in one go. `live` is false when only the accuracy test is wanted (the
   offline script), which saves fitting the 30-day forecast. */
async function prepareShop(byProduct, rows, lastDay = shopDay(-1), live = true) {
    const noData = await findNoDataDays(rows, lastDay);
    const allSeries = {};
    Object.entries(byProduct).forEach(([pid, data]) => { allSeries[pid] = buildDailySeries(data.rows, HISTORY_WINDOW_DAYS, lastDay, noData.days); });
    const shop = shopTypicals(Object.values(allSeries));
    // Fit every product in a single Python process before anything asks.
    const warmJobs = [];
    Object.values(allSeries).forEach(series => { const jobs = mlJobsFor(series, FORECAST_DAYS, shop); warmJobs.push(...(live ? jobs : jobs.slice(1))); });
    await warmMLCacheAsync(warmJobs);
    return { noData, allSeries, shop };
}

/* The accuracy test for the whole shop, and the corrections for recent error
   (utils/forecastAdjust.js). The corrections are worked out twice, each time
   only from days already past:
     - from the fortnight before last, for the accuracy test itself: the
       forecast it scores carries the correction it would have had at the time
     - from the last fortnight, for the live forecast */
function testShop(byProduct, allSeries, shop) {
    const earlierRows = [];
    Object.entries(byProduct).forEach(([pid, data]) => {
        const split = backtestSplit(allSeries[pid]);
        const t = split && holdoutTest(split.train, shop.earlier);
        if (t) earlierRows.push({ group: data.group, forecast: t.rawTotal, sold: t.actualTotal });
    });
    const adjustBack = errorFactors(earlierRows);
    const lastRows = [];
    const tested = Object.entries(byProduct).map(([pid, data]) => {
        const series = allSeries[pid];
        const bt = backtestAccuracy(series, shop, factorFor(adjustBack, data.group));
        if (bt) lastRows.push({ group: data.group, forecast: bt.rawTotal, sold: bt.actualTotal });
        return { pid, data, series, bt };
    });
    return { tested, adjustBack, adjustLive: errorFactors(lastRows) };
}

async function computeAllPredictions() {
        const [rows] = await pool.query(`
            SELECT si.product_id, p.name, p.unit_price, p.stock_quantity, p.reorder_level,
                   p.category_id, c.name AS category_name,
                   si.quantity, s.created_at as sale_date,
                   DATE_FORMAT(CONVERT_TZ(s.created_at,'+00:00','+08:00'), '%Y-%m-%d') AS sale_day
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE s.payment_status = 'completed'
              AND s.created_at >= DATE_SUB(NOW(), INTERVAL ${HISTORY_WINDOW_DAYS} DAY)
            ORDER BY s.created_at ASC
        `);

        const byProduct = {};
        rows.forEach(r => {
            const pid = r.product_id;
            if (!byProduct[pid]) byProduct[pid] = { name: r.name, unit_price: Number(r.unit_price) || 0, stock: Number(r.stock_quantity) || 0, reorder_level: Number(r.reorder_level) || 10, group: r.category_id, category: r.category_name || 'Not set', rows: [] };
            byProduct[pid].rows.push(r);
        });

        // Headline accuracy is scored at STORE level (sum of holdout forecasts
        // vs sum of actuals): per-product counts are tiny and noisy, but the
        // aggregate is what purchasing actually plans against.
        // Fit every product in a single Python process before the loop starts.
        const { noData, allSeries, shop } = await prepareShop(byProduct, rows);
        const groupName = new Map(Object.values(byProduct).map(d => [String(d.group), d.category]));
        const { tested, adjustLive } = testShop(byProduct, allSeries, shop);

        let holdPred = 0, holdActual = 0, backtested = 0;
        // Store-level holdout totals for each way of forecasting, kept only
        // over the products where every one of them produced a figure, so the
        // comparison is like for like.
        const cmp = { actual: 0, baseline: 0, rf: 0, gb: 0, ml: 0, final: 0, products: 0 };
        const result = tested.map(({ pid, data, series, bt }) => {
            const fc = forecastSeries(series, FORECAST_DAYS, { shopTypical: shop.live, factor: factorFor(adjustLive, data.group) });
            const nextMonthTotal = Math.round(fc.predictions.reduce((a, p) => a + p.predicted_quantity, 0) * 100) / 100;
            const dailyAvg = nextMonthTotal / FORECAST_DAYS;
            const accuracy = bt ? bt.accuracy : null;
            if (bt) {
                holdPred += bt.predTotal;
                holdActual += bt.actualTotal;
                backtested++;
                if (bt.parts && bt.parts.rf !== null && bt.parts.ml !== null) {
                    cmp.actual += bt.actualTotal;
                    cmp.baseline += bt.parts.baseline;
                    cmp.rf += bt.parts.rf;
                    cmp.gb += bt.parts.gb;
                    cmp.ml += bt.parts.ml;
                    cmp.final += bt.predTotal;
                    cmp.products++;
                }
            }
            return {
                product_id: Number(pid),
                product_name: data.name,
                unit_price: data.unit_price,
                current_stock: data.stock,
                reorder_level: data.reorder_level,
                next_month_prediction: nextMonthTotal,
                predicted_revenue: Math.round(nextMonthTotal * data.unit_price * 100) / 100,
                daily_average: Math.round(dailyAvg * 100) / 100,
                days_until_stockout: dailyAvg > 0 ? Math.floor(data.stock / dailyAvg) : 999,
                trend: fc.trend,
                trend_momentum: `${fc.momentum}%`,
                confidence_score: fc.confidence,
                backtest_accuracy: accuracy,
                sigma: Math.round(fc.sigma * 1000) / 1000,
                days_of_history: fc.historyDays,
                basis: fc.basis
            };
        });

        result.sort((a, b) => b.next_month_prediction - a.next_month_prediction);
        const payload = {
            success: true,
            data: {
                total_products: result.length,
                window_days: HISTORY_WINDOW_DAYS,
                total_predicted_units: Math.round(result.reduce((a, r) => a + r.next_month_prediction, 0)),
                total_predicted_revenue: Math.round(result.reduce((a, r) => a + r.predicted_revenue, 0) * 100) / 100,
                // A score needs something to be scored against. With only a
                // handful of items sold in the test fortnight the percentage
                // swings between 0 and 100 on one sale and means nothing, so
                // it is withheld rather than shown.
                overall_accuracy: holdActual >= MIN_TEST_UNITS ? accuracyOf(holdPred, holdActual) : null,
                backtested_products: backtested,
                // days left out of every product's history, and why
                excluded: { days: noData.days.size, ranges: noData.ranges },
                model: {
                    runtime: mlAvailable() ? 'python/scikit-learn' : 'statistical baseline only (Python model unavailable)',
                    comparison: cmp.actual >= MIN_TEST_UNITS ? {
                        products: cmp.products,
                        actual_units: Math.round(cmp.actual),
                        random_forest: accuracyOf(cmp.rf, cmp.actual),
                        gradient_boosting: accuracyOf(cmp.gb, cmp.actual),
                        ensemble: accuracyOf(cmp.ml, cmp.actual),
                        statistical_baseline: accuracyOf(cmp.baseline, cmp.actual),
                        system_forecast: accuracyOf(cmp.final, cmp.actual)
                    } : null,
                    // how far back the model reads, and how fast older days fade
                    fit_days: MODEL_DAYS,
                    half_life_days: MODEL_HALF_LIFE,
                    // the correction now applied to the live forecast, and what it was worked out from
                    adjustment: {
                        strength: ADJUST.strength,
                        shop: Math.round(adjustLive.shop * 1000) / 1000,
                        groups: adjustLive.detail.map(d => ({ category: groupName.get(d.group) || 'Not set', factor: d.factor, forecast: d.forecast, sold: d.sold, own: d.own }))
                            .sort((a, b) => b.sold - a.sold)
                    },
                    feature_weights: featureWeights(Object.values(allSeries).map(series => capSeries(series, shop.live).series), FORECAST_DAYS)
                },
                predictions: result
            }
        };
        allCache = { at: Date.now(), payload, shop, skip: noData.days, adjust: adjustLive };
        return payload;
}

/** One rebuild at a time, however many callers ask for it. */
function rebuildAllPredictions() {
    if (!rebuildInFlight) {
        const started = Date.now();
        rebuildInFlight = computeAllPredictions()
            .then(p => { console.log(`[Predictions] forecast cache rebuilt in ${Date.now() - started}ms`); return p; })
            .catch(e => { console.error('[Predictions] rebuild failed:', e.message); throw e; })
            .finally(() => { rebuildInFlight = null; });
    }
    return rebuildInFlight;
}

/** Called on boot and on a timer so the cache is warm before anyone asks. */
function warmAllPredictions() {
    return rebuildAllPredictions().catch(() => {});
}

/* ---------- Stock planning overview ----------

   Everything the Reports → Stock planning screen shows, decided in one place.
   The page used to pull three endpoints and classify products itself, with
   quartiles and thresholds that disagreed between cards (14 days in one, 30 in
   another). The rules are now here, few, and written so they can be read out
   loud to the shop owner:

     Stock      out          nothing left
                reorder_now  at or below its reorder level, or will run out
                             before a new delivery could arrive (lead time)
                reorder_soon will run out within three weeks
                ok           otherwise
     Demand     fast / steady / slow by expected sales, none when nothing sold
                in the last 30 days and nothing is expected

   The forecast itself is the one described at forecastSeries, read from the
   same cache as /all. */
const LEAD_TIME_DAYS = 7;
const REORDER_SOON_DAYS = 21;

function confidenceWord(score) {
    if (score == null) return null;
    return score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
}

const OVERSTOCK_DAYS = 90;       // more than three months of stock is more than the shop needs
const EXPIRY_HORIZON_DAYS = 180; // only worry about expiry dates within six months
const DAY_MS_ = 86400000;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS_).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS_);

/* Pure: (active products, forecast rows, units sold per product in 30 days)
   → rows for the page. `extra` carries what is already on order from
   suppliers and today's date, so the function stays free of the database and
   the clock and can be tested as arithmetic.

   Beyond stock status it answers the questions the study sets for the
   predictive module:
     when to reorder      order_by — the last day an order still arrives in time
     how much             suggested_order, less what is already on order
     reorder point        expected sales during the delivery wait, plus
     and safety stock     a buffer for the days sales run above average
     overstock            stock beyond three months of expected sales
     expiry               stock expected to still be on the shelf on its
                          expiry date */
function planStock(products, forecasts, sold30, extra = {}) {
    const byId = new Map(forecasts.map(f => [Number(f.product_id), f]));
    const onOrder = extra.onOrder || new Map();
    const today = extra.today || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

    const rows = products.map(p => {
        const id = Number(p.id);
        const f = byId.get(id);
        const stock = Number(p.stock_quantity) || 0;
        const reorderLevel = Number(p.reorder_level) || 0;
        const cost = Number(p.cost_price) || 0;
        const expected = f ? Number(f.next_month_prediction) || 0 : 0;
        const daily = expected / FORECAST_DAYS;
        const daysLeft = daily > 0 ? Math.floor(stock / daily) : null;
        const sold = Number(sold30.get(id)) || 0;
        const coming = Number(onOrder.get(id)) || 0;

        let stockStatus = 'ok';
        if (stock <= 0) stockStatus = 'out';
        else if (stock <= reorderLevel || (daysLeft !== null && daysLeft <= LEAD_TIME_DAYS)) stockStatus = 'reorder_now';
        else if (daysLeft !== null && daysLeft <= REORDER_SOON_DAYS) stockStatus = 'reorder_soon';

        // Enough for the coming month plus the wait for delivery, and never
        // less than what brings the shelf back to twice its reorder level —
        // minus anything a supplier is already bringing.
        const need = stockStatus === 'ok' ? 0
            : Math.max(0, Math.ceil(Math.max(expected + daily * LEAD_TIME_DAYS - stock, reorderLevel * 2 - stock)));
        const suggested = Math.max(0, need - coming);

        // Safety stock at about a 95% service level: z × daily spread × √(lead time).
        const sigma = f ? Number(f.sigma) || 0 : 0;
        const safety = daily > 0 ? Math.ceil(1.65 * sigma * Math.sqrt(LEAD_TIME_DAYS)) : 0;
        const reorderPoint = daily > 0 ? Math.ceil(daily * LEAD_TIME_DAYS) + safety : null;

        const runOut = daysLeft !== null && stock > 0 ? addDays(today, daysLeft) : null;
        // At or below the reorder level the trigger has already been reached,
        // so the answer is today however slowly the product sells. Above it,
        // it is the last day an order still arrives before the shelf empties.
        const orderBy = stock <= reorderLevel ? today
            : runOut ? addDays(today, Math.max(0, daysLeft - LEAD_TIME_DAYS)) : null;

        // Overstock: what is left after three months of expected sales. A
        // product with stock and no sales at all is all excess.
        let excess = 0, excessReason = null;
        if (stock > 0 && daily > 0 && daysLeft > OVERSTOCK_DAYS) {
            excess = Math.floor(stock - daily * OVERSTOCK_DAYS);
            excessReason = 'slow';
        } else if (stock > reorderLevel && daily === 0 && sold === 0) {
            excess = stock - reorderLevel;
            excessReason = 'not_selling';
        }

        // Expiry: how much will still be here on the day it expires.
        const expires = p.expires_on || null;
        const daysToExpiry = expires ? daysBetween(today, expires) : null;
        let expiryRisk = 0, expired = 0;
        if (expires && stock > 0) {
            if (daysToExpiry < 0) expired = stock;
            else if (daysToExpiry <= EXPIRY_HORIZON_DAYS) expiryRisk = Math.max(0, Math.ceil(stock - daily * daysToExpiry));
        }

        return {
            product_id: id,
            name: p.name,
            sku: p.sku || null,
            brand: p.brand || null,
            category: p.category || null,
            supplier_id: p.supplier_id ? Number(p.supplier_id) : null,
            supplier_name: p.supplier_name || null,
            unit_price: Number(p.unit_price) || 0,
            stock,
            reorder_level: reorderLevel,
            on_order: coming,
            sold_30d: sold,
            expected_30d: Math.round(expected * 10) / 10,
            per_week: Math.round(daily * 7 * 10) / 10,
            days_left: daysLeft,
            runs_out_on: runOut,
            order_by: stockStatus === 'ok' ? null : (orderBy || today),
            stock_status: stockStatus,
            suggested_order: suggested,
            safety_stock: safety,
            recommended_reorder_point: reorderPoint,
            excess_units: excess,
            excess_value: Math.round(excess * cost * 100) / 100,
            excess_reason: excessReason,
            expires_on: expires,
            days_to_expiry: daysToExpiry,
            expiry_risk_units: expiryRisk,
            expiry_risk_value: Math.round(expiryRisk * cost * 100) / 100,
            expired_units: expired,
            demand: 'none',
            trend: f ? f.trend : 'stable',
            confidence: f ? confidenceWord(f.confidence_score) : null,
            // 'new' while it has under two weeks on record, 'trend' under six, then 'model'
            basis: f ? f.basis || null : null,
            days_on_record: f ? Number(f.days_of_history) || 0 : 0
        };
    });

    // Fast / slow are relative to the shop's own range: top and bottom quarter
    // of the products that are actually expected to sell.
    const selling = rows.filter(r => r.expected_30d >= 0.5).map(r => r.expected_30d).sort((a, b) => a - b);
    const at = f => selling.length ? selling[Math.min(selling.length - 1, Math.floor(selling.length * f))] : 0;
    const fastFrom = at(0.75), slowUpTo = at(0.25);
    rows.forEach(r => {
        if (r.expected_30d < 0.5) r.demand = r.sold_30d > 0 ? 'slow' : 'none';
        else if (selling.length >= 4 && r.expected_30d >= fastFrom) r.demand = 'fast';
        else if (selling.length >= 4 && r.expected_30d <= slowUpTo) r.demand = 'slow';
        else r.demand = 'steady';
    });

    const urgency = { out: 0, reorder_now: 1, reorder_soon: 2, ok: 3 };
    rows.sort((a, b) => urgency[a.stock_status] - urgency[b.stock_status]
        || (a.days_left ?? 9999) - (b.days_left ?? 9999)
        || b.expected_30d - a.expected_30d
        || a.name.localeCompare(b.name));
    return rows;
}

/** Expected and recent sales added up by one field — brand, or category. */
function demandBy(rows, field) {
    const groups = new Map();
    rows.forEach(r => {
        const key = r[field] || 'Not set';
        const g = groups.get(key) || { name: key, products: 0, expected_30d: 0, sold_30d: 0 };
        g.products++;
        g.expected_30d += r.expected_30d;
        g.sold_30d += r.sold_30d;
        groups.set(key, g);
    });
    return [...groups.values()]
        .map(g => ({ ...g, expected_30d: Math.round(g.expected_30d * 10) / 10 }))
        .sort((a, b) => b.expected_30d - a.expected_30d || b.sold_30d - a.sold_30d || a.name.localeCompare(b.name));
}

/* The forecast for a set of products, for callers outside this file (the
   supplier page). Reads the cache; if nothing has been computed yet it starts
   the computation and returns null rather than making the caller wait. */
function peekForecasts() {
    if (!allCache.payload) { rebuildAllPredictions().catch(() => {}); return null; }
    if (Date.now() - allCache.at >= ALL_TTL_MS) rebuildAllPredictions().catch(() => {});
    return new Map(allCache.payload.data.predictions.map(p => [Number(p.product_id), p]));
}

router.get('/overview', authenticateToken, async (req, res) => {
    try {
        // Serve a cached forecast when there is one (refreshing it behind the
        // reply if it has expired); stock levels below are always read live.
        let all = allCache.payload;
        if (!all) all = await rebuildAllPredictions();
        else if (Date.now() - allCache.at >= ALL_TTL_MS) rebuildAllPredictions().catch(() => {});

        const [products] = await pool.query(`
            SELECT p.id, p.name, p.sku, p.brand, p.unit_price, p.cost_price, p.stock_quantity, p.reorder_level,
                   s.id AS supplier_id, c.name AS category, s.name AS supplier_name,
                   DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expires_on
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.is_active = TRUE
            WHERE p.is_active = TRUE`);
        const [soldRows] = await pool.query(`
            SELECT si.product_id, SUM(si.quantity) AS qty
            FROM sale_items si JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
              AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY si.product_id`);
        // Stock a supplier is already bringing: ordering it again would
        // double the shelf. Uses what the supplier confirmed where they have.
        const [orderRows] = await pool.query(`
            SELECT pi.product_id, SUM(COALESCE(pi.confirmed_quantity, pi.quantity)) AS qty
            FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
            WHERE po.status IN ('pending', 'confirmed', 'shipped')
            GROUP BY pi.product_id`);
        const [lastRows] = await pool.query(`
            SELECT COUNT(DISTINCT CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                                       THEN DATE(CONVERT_TZ(created_at,'+00:00','+08:00')) END) AS recent_days,
                   DATE_FORMAT(CONVERT_TZ(MAX(created_at),'+00:00','+08:00'), '%Y-%m-%d') AS last_sale,
                   DATE_FORMAT(CONVERT_TZ(MIN(created_at),'+00:00','+08:00'), '%Y-%m-%d') AS first_sale,
                   DATEDIFF(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')),
                            DATE(CONVERT_TZ(MAX(created_at),'+00:00','+08:00'))) AS days_since
            FROM sales WHERE payment_status = 'completed'`);

        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        const sold30 = new Map(soldRows.map(r => [Number(r.product_id), Number(r.qty)]));
        const onOrder = new Map(orderRows.map(r => [Number(r.product_id), Number(r.qty)]));
        const rows = planStock(products, all.data.predictions, sold30, { onOrder, today });
        const needOrder = rows.filter(r => r.stock_status !== 'ok');
        const sum = (list, field) => Math.round(list.reduce((a, r) => a + (Number(r[field]) || 0), 0) * 100) / 100;
        // How much history the model actually had, in days, capped at the window.
        const historyDays = lastRows[0].first_sale
            ? Math.min(HISTORY_WINDOW_DAYS, daysBetween(lastRows[0].first_sale, today) + 1) : 0;

        res.json({
            success: true,
            data: {
                window_days: HISTORY_WINDOW_DAYS,
                history_days: historyDays,
                // days inside that span the forecast does not read, and why
                excluded: all.data.excluded || { days: 0, ranges: [] },
                forecast_days: FORECAST_DAYS,
                lead_time_days: LEAD_TIME_DAYS,
                overstock_days: OVERSTOCK_DAYS,
                last_sale_date: lastRows[0].last_sale || null,
                days_since_last_sale: lastRows[0].days_since == null ? null : Number(lastRows[0].days_since),
                // on how many of the last 30 days anything was sold at all
                recent_sale_days: Number(lastRows[0].recent_days) || 0,
                totals: {
                    products: rows.length,
                    expected_units: Math.round(rows.reduce((a, r) => a + r.expected_30d, 0)),
                    expected_revenue: Math.round(rows.reduce((a, r) => a + r.expected_30d * r.unit_price, 0) * 100) / 100,
                    to_reorder: needOrder.length,
                    out_of_stock: rows.filter(r => r.stock_status === 'out').length,
                    excess_value: sum(rows, 'excess_value'),
                    expiry_risk_value: sum(rows, 'expiry_risk_value'),
                    accuracy: all.data.overall_accuracy,
                    accuracy_products: all.data.backtested_products
                },
                by_category: demandBy(rows, 'category'),
                by_brand: demandBy(rows, 'brand').slice(0, 10),
                model: all.data.model || null,
                products: rows
            }
        });
    } catch (err) {
        console.error('[Predictions] overview failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not load stock planning data' });
    }
});

router.get('/trends', authenticateToken, async (req, res) => {
    try {
        const [monthlyData] = await pool.query(`
            SELECT MONTH(s.created_at) as month,
                   SUM(si.quantity) as total_qty,
                   COUNT(DISTINCT DATE(s.created_at)) as active_days
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY MONTH(s.created_at)
            ORDER BY month
        `);

        const [dowData] = await pool.query(`
            SELECT DAYOFWEEK(s.created_at) as day_of_week,
                   SUM(si.quantity) as total_qty,
                   COUNT(DISTINCT DATE(s.created_at)) as active_days
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DAYOFWEEK(s.created_at)
            ORDER BY day_of_week
        `);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        const monthly_patterns = monthlyData.map(m => ({
            month: monthNames[m.month - 1] || `Month ${m.month}`,
            avg_daily_sales: m.active_days > 0 ? Math.round((m.total_qty / m.active_days) * 100) / 100 : 0,
            total_sales: Number(m.total_qty)
        }));

        const day_of_week_patterns = dowData.map(d => ({
            day: dowNames[d.day_of_week - 1] || `Day ${d.day_of_week}`,
            avg_daily_sales: d.active_days > 0 ? Math.round((d.total_qty / d.active_days) * 100) / 100 : 0,
            total_sales: Number(d.total_qty)
        }));

        const allMonthlyAvg = monthly_patterns.map(m => m.avg_daily_sales);
        const peakMonth = monthly_patterns.reduce((a, b) => a.avg_daily_sales > b.avg_daily_sales ? a : b, { avg_daily_sales: 0 });
        const lowMonth = monthly_patterns.reduce((a, b) => a.avg_daily_sales < b.avg_daily_sales ? a : b, { avg_daily_sales: Infinity });

        const seasonal_peaks = [];
        if (peakMonth.avg_daily_sales > 0) seasonal_peaks.push({ type: 'peak', month: peakMonth.month, avg_sales: peakMonth.avg_daily_sales });
        if (lowMonth.avg_daily_sales < Infinity && lowMonth.avg_daily_sales >= 0) seasonal_peaks.push({ type: 'low', month: lowMonth.month, avg_sales: lowMonth.avg_daily_sales });

        const avgSales = allMonthlyAvg.reduce((a, b) => a + b, 0) / (allMonthlyAvg.length || 1);
        const trend_summary = {
            average_monthly_sales: Math.round(avgSales * 100) / 100,
            peak_month: peakMonth.month || 'N/A',
            low_month: lowMonth.month || 'N/A',
            seasonal_variance: peakMonth.avg_daily_sales > 0 && lowMonth.avg_daily_sales < Infinity
                ? Math.round(((peakMonth.avg_daily_sales - lowMonth.avg_daily_sales) / avgSales) * 100)
                : 0
        };

        res.json({
            success: true,
            data: { product_id: req.query.product_id || null, seasonality: { monthly_patterns, day_of_week_patterns, seasonal_peaks }, trend_summary }
        });
    } catch (err) {
        console.error('[Predictions] request failed:', err.message);
        res.status(500).json({ success: false, error: 'Could not load forecast data' });
    }
});

// exposed for offline evaluation scripts / tests
router._internals = { forecastSeries, simpleTrend, computeConfidence, TUNING, backtestAccuracy, holdoutTest, backtestSplit, buildDailySeries, findNoDataDays, prepareShop, testShop, planStock, demandBy, mlJobsFor, shopTypicals };
// the supplier page shows each supplier the forecast for its own products
router.peekForecasts = peekForecasts;
// server.js warms this on boot and on a timer so Analytics opens instantly
router.warmAllPredictions = warmAllPredictions;

module.exports = router;
