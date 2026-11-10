const express = require('express');
const router = express.Router();
const { forecastML, warmMLCacheAsync, mlAvailable, featureWeights, FIT_WINDOW: MODEL_DAYS, HALF_LIFE: MODEL_HALF_LIFE } = require('../utils/mlForecast');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { shopTypical, capSeries, isNewProduct, cautiousDailyRate, noDataDays, freakDays } = require('../utils/forecastGuards');
const { ADJUST, errorFactors, factorFor } = require('../utils/forecastAdjust');

// Up to twelve months of sales are read to build each product's history, the
// range the study specifies (3–12 months). The model itself learns from the
// last FIT_WINDOW days of it (utils/mlForecast.js).
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

function stdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
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
   days with sales recorded but no items, closures of three days or more, and
   freak days on which the whole shop sold many times its usual busy day.
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
    const out = noDataDays(soldByDay, salesByDay, firstDay, lastDay);
    const freak = freakDays(soldByDay, firstDay, lastDay);
    freak.days.forEach(d => out.days.add(d));
    freak.ranges.forEach(r => {
        let sales = 0;
        salesByDay.forEach((n, day) => { if (day >= r.from && day <= r.to) sales += n; });
        out.ranges.push({ ...r, sales });
    });
    out.ranges.sort((a, b) => a.from.localeCompare(b.from));
    return out;
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
        basis: 'new'
    };
}

/* The forecast without machine learning: the average of the last 28 days on
   record, the same for every day ahead.

   It forecasts a product with 14 to 41 days on record, too little for the
   model to learn from, and every product if the Python model cannot run. It
   replaced a mix of Holt's smoothing (50%), a straight line (30%) and a
   weighted 7-day average (20%), with a floor, a rule for slow sellers and a
   day-of-week factor. On the four held-out fortnights in QA/FORECAST-METHOD.md
   that mix and this plain average had the same error per product (MAE 1.582
   and 1.577 items, RMSE 2.188 and 2.137), and the average can be said in one
   sentence. */
const AVERAGE_DAYS = 28;

function recentAverage(series, days) {
    const last = series.slice(-AVERAGE_DAYS);
    const rate = last.length ? last.reduce((a, p) => a + p.quantity, 0) / last.length : 0;
    return { rate, daily: Array(days).fill(rate) };
}

/* What the page says about a product beside its forecast, read from its last
   8 weeks: the spread of its daily sales (for the range and the safety stock)
   and whether a straight line through those weeks rises or falls ("more
   lately", "fewer lately"). None of it changes the forecast figure. */
const DESCRIBE_DAYS = 56;

function describeRecent(series) {
    const quantities = series.slice(-DESCRIBE_DAYS).map(p => p.quantity);
    const n = quantities.length;
    const avg = n ? quantities.reduce((a, b) => a + b, 0) / n : 0;
    const reg = linearRegression(quantities);
    const trend = reg.slope > avg * 0.02 ? 'up' : reg.slope < -avg * 0.02 ? 'down' : 'stable';
    const last7 = quantities.slice(-7);
    const prev7 = quantities.slice(-14, -7);
    const recentAvg = last7.reduce((a, b) => a + b, 0) / (last7.length || 1);
    const prevAvg = prev7.length ? prev7.reduce((a, b) => a + b, 0) / prev7.length : recentAvg;
    const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100).toFixed(1) : '0.0';
    return { sigma: stdDev(quantities), avg, trend, momentum };
}

// Core forecaster shared by /product/:id and /all. In order:
//   1. freak days are capped (days with no data were already left out when
//      the series was built)
//   2. by days on record: under 14, the cautious first estimate; 14 to 41,
//      the average of the last 28 days; 42 or more, the machine-learning model
//   3. the correction for the forecast's own last miss
// QA/FORECAST-METHOD.md describes each step.
function forecastSeries(series, days = FORECAST_DAYS, opts = {}) {
    // Freak days are capped before anything is fitted (utils/forecastGuards.js).
    // The cap is worked out from the series given, so a forecast made from part
    // of a history never uses days it has not seen.
    series = capSeries(series, opts.shopTypical).series;
    if (isNewProduct(series)) return cautiousForecast(series, days);

    const lastMs = Date.parse(series[series.length - 1].date + 'T00:00:00Z');
    const recent = describeRecent(series);
    const average = recentAverage(series, days);

    // Random Forest + Gradient Boosting, averaged (the thesis method), fitted
    // in Python by ml/forecast.py with scikit-learn. It returns null when the
    // history is too short to train on (under 42 days) or when Python could
    // not be reached; the 28-day average then stands in, so the forecast
    // never fails.
    const mlPreds = forecastML(series, days, opts.compare);
    const daily = mlPreds ? mlPreds.map(p => Number(p.predicted_quantity) || 0) : average.daily;

    // The last step: the correction for how far off the forecast has just
    // been (utils/forecastAdjust.js). 1 when the caller gives none.
    const factor = Number(opts.factor) > 0 ? Number(opts.factor) : 1;
    const r2 = v => Math.round(v * 100) / 100;
    const predictions = daily.map((val, i) => ({
        date: new Date(lastMs + (i + 1) * DAY_MS).toISOString().split('T')[0],
        predicted_quantity: r2(val * factor),
        lower_bound: r2(Math.max(0, val - 1.28 * recent.sigma) * factor),
        upper_bound: r2((val + 1.28 * recent.sigma) * factor),
        day: i + 1
    }));

    // For the accuracy test: what each method would have forecast by itself,
    // before the correction, so the model can be judged against the average
    // and Random Forest and Gradient Boosting against each other.
    const sumOf = (rows, field) => rows.reduce((a, p) => a + (Number(p[field]) || 0), 0);
    const num = v => v === undefined ? null : Number(v) || 0;
    const parts = { baseline: average.rate * days, ml: null, rf: null, gb: null };
    parts.daily = predictions.map((p, i) => ({
        date: p.date,
        baseline: average.rate,
        ml: mlPreds ? num(mlPreds[i] && mlPreds[i].predicted_quantity) : null,
        rf: mlPreds ? num(mlPreds[i] && mlPreds[i].rf) : null,
        gb: mlPreds ? num(mlPreds[i] && mlPreds[i].gb) : null
    }));
    if (mlPreds) {
        parts.ml = sumOf(mlPreds, 'predicted_quantity');
        if (mlPreds[0] && mlPreds[0].rf !== undefined) { parts.rf = sumOf(mlPreds, 'rf'); parts.gb = sumOf(mlPreds, 'gb'); }
    }

    return {
        predictions,
        sigma: recent.sigma,
        trend: recent.trend,
        momentum: recent.momentum,
        historyDays: series.length,
        historyAvg: recent.avg,
        parts,
        // what the figure rests on: the model, or the 28-day average
        basis: mlPreds ? 'model' : 'average',
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
        // each method scored on the hidden days only, as the forecast itself
        // is above. Totals over the whole run would count days that were left
        // out between the two (a closed fortnight), so they are used only
        // when the run is exactly the hidden days.
        parts: fc.parts && fc.parts.daily ? hiddenParts(fc.parts.daily, hidden) : (horizon === holdout ? fc.parts : null)
    };
}

/* What each method forecast for the hidden days alone. A method that did not
   run (no model for a short history) stays null. */
function hiddenParts(daily, hidden) {
    const days = daily.filter(d => hidden.has(d.date));
    const total = field => days.some(d => d[field] === null) ? null : days.reduce((a, d) => a + d[field], 0);
    return { baseline: total('baseline'), ml: total('ml'), rf: total('rf'), gb: total('gb') };
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
        const leadTime = parseInt(req.query.lead_time) || LEAD_TIME_DAYS;
        const coming = parseInt(req.query.on_order) || 0;

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
        // the same arithmetic as the Stock planning list, so the two cannot disagree
        const r = reorderFigures({ expected: nextMonthTotal, sigma: fc.sigma, stock, reorderLevel, lead: leadTime, coming, today: shopDay(0) });
        const dailyAvg = r.daily;
        const daysUntilStockout = r.daysLeft ?? 999;

        return res.json({
            success: true,
            data: {
                product_id: Number(req.params.id),
                product_name: rows[0].name,
                model: 'Random Forest + Gradient Boosting ensemble (scikit-learn, Python), fitted on all products together over calendar and recent-sales features from the last four months, recent days weighted more; corrected by half of its miss on the most recent two weeks, by product category; the average of the last 28 days stands in for products with under six weeks of history',
                model_runtime: mlAvailable() ? 'python/scikit-learn' : 'average of the last 28 days only (Python model unavailable)',
                historical_data: series,
                predictions: fc.predictions,
                next_month_prediction: nextMonthTotal,
                daily_average: Math.round(dailyAvg * 100) / 100,
                basis: fc.basis,
                adjustment: fc.factor,
                trend: fc.trend,
                trend_momentum: `${fc.momentum}%`,
                days_until_stockout: daysUntilStockout,
                reorder_recommendation: {
                    stock_status: r.stockStatus,
                    recommended_reorder_point: r.reorderPoint,
                    recommended_order_quantity: r.suggested,
                    safety_stock: r.safety,
                    lead_time_days: leadTime,
                    on_order: coming,
                    reorder_triggered: r.stockStatus !== 'ok',
                    order_by: r.orderBy,
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
// "The last 30 days counted": the forecast's own days, with those left out skipped.
const COUNTED_DAYS = 30;
// A check hides this many days on record (see backtestSplit).
const CHECK_DAYS = 14;

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
                backtest_accuracy: accuracy,
                // what it expected and what sold in the hidden fortnight (Did it guess right?)
                test_expected: bt ? Math.round(bt.predTotal * 10) / 10 : null,
                test_sold: bt ? bt.actualTotal : null,
                sigma: Math.round(fc.sigma * 1000) / 1000,
                days_of_history: fc.historyDays,
                basis: fc.basis,
                // sold on the last 30 and the last 7 days the forecast counts
                // (days left out are skipped, so a freak day is not in them)
                counted_30d: series.slice(-COUNTED_DAYS).reduce((a, x) => a + x.quantity, 0),
                counted_7d: series.slice(-7).reduce((a, x) => a + x.quantity, 0)
            };
        });

        result.sort((a, b) => b.next_month_prediction - a.next_month_prediction);
        // the fortnight the test hid, as dates (every product's series ends on the same day)
        const anySplit = Object.values(allSeries).map(backtestSplit).find(Boolean);
        const testWindow = anySplit ? { from: anySplit.test[0].date, to: anySplit.test[anySplit.test.length - 1].date } : null;
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
                // what the accuracy figure is worked out from (UAT part 4, A15)
                accuracy_test: { predicted_units: Math.round(holdPred), actual_units: Math.round(holdActual), min_units: MIN_TEST_UNITS, ...(testWindow || {}) },
                // days left out of every product's history, and why
                excluded: { days: noData.days.size, ranges: noData.ranges },
                // the first of the last 30 days the forecast counts (earlier than 30 days ago when days were left out)
                counted_from: (Object.values(allSeries).reduce((a, x) => (x.length > a.length ? x : a), []).slice(-COUNTED_DAYS)[0] || {}).date || null,
                model: {
                    runtime: mlAvailable() ? 'python/scikit-learn' : 'average of the last 28 days only (Python model unavailable)',
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
        // the five checks before this one, worked out behind the reply
        refreshPastChecks(byProduct, rows, allSeries).catch(e => console.error('[Predictions] past checks failed:', e.message));
        return payload;
}

/* ---------- The forecast's last checks ----------

   "Did it guess right?" used to rest on one fortnight, and one fortnight can
   come close by luck. The same test is therefore repeated on the five
   fortnights before it: for each, the 14 days are hidden, every product is
   forecast from the days before them (with the correction it would have
   carried at the time), and the total is compared with what sold. Nothing
   from the hidden days, or after them, is used.

   Each of the five costs one fit of the model, so they are worked out once
   behind the reply and kept until the sales they rest on change (a new day,
   or a sale added to an old one). The newest check is the page's own accuracy
   test and is added when the overview is sent. */
const PAST_CHECKS = 5;
let pastChecks = { key: null, checks: [], running: null };

async function refreshPastChecks(byProduct, rows, allSeries) {
    const record = Object.values(allSeries).reduce((a, s) => (s.length > a.length ? s : a), []).map(x => x.date);
    const ends = [];
    for (let k = 1; k <= PAST_CHECKS; k++) { const end = record[record.length - 1 - CHECK_DAYS * k]; if (end) ends.push(end); }
    if (!ends.length) { pastChecks = { key: null, checks: [], running: null }; return; }
    const key = ends[0] + ':' + rows.filter(r => r.sale_day <= ends[0]).length;
    if (pastChecks.key === key || pastChecks.running === key) return;
    pastChecks.running = key;
    try {
        const checks = [];
        for (const end of ends) {
            const { allSeries: then, shop } = await prepareShop(byProduct, rows, end, false);
            const { tested } = testShop(byProduct, then, shop);
            let expected = 0, sold = 0;
            tested.forEach(t => { if (t.bt) { expected += t.bt.predTotal; sold += t.bt.actualTotal; } });
            const split = Object.values(then).map(backtestSplit).find(Boolean);
            // too little sold to grade a forecast on, or too little history before it: not a check
            if (!split || sold < MIN_TEST_UNITS) continue;
            checks.push({ from: split.test[0].date, to: split.test[split.test.length - 1].date, predicted_units: Math.round(expected), actual_units: Math.round(sold) });
        }
        pastChecks = { key, checks: checks.reverse(), running: null };
    } finally {
        if (pastChecks.running === key) pastChecks.running = null;
    }
}

/* How a check came out: close when the forecast total was within a fifth of
   what sold, the same line the overview draws for "Close last time". */
function checkMark(check) {
    const ratio = check.actual_units > 0 ? check.predicted_units / check.actual_units : null;
    return ratio == null ? null : ratio > 1.2 ? 'high' : ratio < 0.8 ? 'low' : 'close';
}

/* The forecast for the next 30 days against what the last 30 counted days
   sold, in words the page can show first:
     direction  more / less / same   (a tenth either way is "about the same")
     verdict    ok, or high / low when the forecast is more than double, or
                under half, of what sold; none when too little sold to compare
     recent     busier / quieter / steady: the last 7 counted days against the
                23 before them, per day (a fifth either way is "steady") */
function salesCheck(expected, sold30, sold7) {
    const check = { expected_units: Math.round(expected), sold_units: Math.round(sold30), sold_7d: Math.round(sold7), direction: 'same', verdict: 'none', recent: 'steady' };
    if (!(sold30 >= MIN_TEST_UNITS)) return check;
    const ratio = expected / sold30;
    check.direction = ratio >= 1.1 ? 'more' : ratio <= 0.9 ? 'less' : 'same';
    check.verdict = ratio > 2 ? 'high' : ratio < 0.5 ? 'low' : 'ok';
    const late = sold7 / 7, early = (sold30 - sold7) / (COUNTED_DAYS - 7);
    check.recent = !(early > 0) || late >= early * 1.2 ? 'busier' : late <= early * 0.8 ? 'quieter' : 'steady';
    return check;
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

const OVERSTOCK_DAYS = 90;       // more than three months of stock is more than the shop needs
const EXPIRY_HORIZON_DAYS = 180; // only worry about expiry dates within six months
const DAY_MS_ = 86400000;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS_).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS_);

/* When and how much to reorder one product. The one place this arithmetic
   lives: the Stock planning list (planStock) and the single-product forecast
   (/product/:id) both call it, so they cannot disagree.

     daily          the 30-day forecast ÷ 30
     reorder now    stock at or below the reorder level, or lasting no longer
                    than the supplier takes to deliver
     reorder soon   lasting 21 days or less
     safety stock   1.65 × the daily spread × √(delivery days): about a 95%
                    chance of not running out while waiting
     reorder point  the sales expected while waiting, plus the safety stock
     order          the next 30 days, plus the wait, plus the safety stock,
                    less what is on the shelf; never less than what brings the
                    shelf back to twice its reorder level; less what a supplier
                    is already bringing
     order by       today at or below the reorder level; otherwise the run-out
                    date less the delivery days */
function reorderFigures({ expected, sigma = 0, stock, reorderLevel, lead = LEAD_TIME_DAYS, coming = 0, today }) {
    const daily = expected / FORECAST_DAYS;
    const daysLeft = daily > 0 ? Math.floor(stock / daily) : null;

    let stockStatus = 'ok';
    if (stock <= 0) stockStatus = 'out';
    else if (stock <= reorderLevel || (daysLeft !== null && daysLeft <= lead)) stockStatus = 'reorder_now';
    else if (daysLeft !== null && daysLeft <= REORDER_SOON_DAYS) stockStatus = 'reorder_soon';

    const safety = daily > 0 ? Math.ceil(1.65 * sigma * Math.sqrt(lead)) : 0;
    const reorderPoint = daily > 0 ? Math.ceil(daily * lead) + safety : null;
    const need = stockStatus === 'ok' ? 0
        : Math.max(0, Math.ceil(Math.max(expected + daily * lead + safety - stock, reorderLevel * 2 - stock)));
    const suggested = Math.max(0, need - coming);

    const runOut = daysLeft !== null && stock > 0 ? addDays(today, daysLeft) : null;
    const orderBy = stockStatus === 'ok' ? null
        : stock <= reorderLevel ? today
        : runOut ? addDays(today, Math.max(0, daysLeft - lead)) : today;

    return { daily, daysLeft, stockStatus, safety, reorderPoint, suggested, runOut, orderBy };
}

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
/* How far to trust one product's forecast, in one word, from what it did
   last time. Each refresh hides the last 14 days, forecasts them and compares
   with what sold (test_expected, test_sold); "Did it guess right?" shows the
   same test.

     new     under 28 days on record: too new to tell
     sure    sold 4 or more in the last 30 days, and its last test came within
             a quarter of what sold, or within 1 item
     rough   anything else: it sells too little to test, or its last test was
             further off

   It replaced a 0-100 score built from the days on record, the R² of a
   straight line and the steadiness of sales. With sales as thin as this
   shop's every product scored "low", so "sure" could never appear. */
const SURE_MIN_SOLD = 4;

function guessedClose(expected, sold) {
    return Math.abs(expected - sold) <= Math.max(1, sold * 0.25);
}

function howSure(r) {
    if (r.basis === 'new' || r.days_on_record < 28) return 'new';
    const tested = r.test_expected != null && r.test_sold != null;
    // what it sold on the days that count: a freak day's sales must not make a slow product look tested
    const sold = r.sold_counted_30d != null ? r.sold_counted_30d : r.sold_30d;
    return tested && sold >= SURE_MIN_SOLD && guessedClose(r.test_expected, r.test_sold) ? 'sure' : 'rough';
}

function planStock(products, forecasts, sold30, extra = {}) {
    const byId = new Map(forecasts.map(f => [Number(f.product_id), f]));
    const onOrder = extra.onOrder || new Map();
    // each supplier's own average delivery time where the shop has a record of it
    const leadTimes = extra.leadTimes || new Map();
    const today = extra.today || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

    const rows = products.map(p => {
        const id = Number(p.id);
        const f = byId.get(id);
        const stock = Number(p.stock_quantity) || 0;
        const reorderLevel = Number(p.reorder_level) || 0;
        const cost = Number(p.cost_price) || 0;
        const expected = f ? Number(f.next_month_prediction) || 0 : 0;
        const sigma = f ? Number(f.sigma) || 0 : 0;
        const sold = Number(sold30.get(id)) || 0;
        const coming = Number(onOrder.get(id)) || 0;
        const lead = Number(leadTimes.get(Number(p.supplier_id))) || LEAD_TIME_DAYS;
        const { daily, daysLeft, stockStatus, safety, reorderPoint, suggested, runOut, orderBy } =
            reorderFigures({ expected, sigma, stock, reorderLevel, lead, coming, today });

        // Next month as a range rather than one exact figure: about one
        // spread either side (the daily spread grown to 30 days).
        const spread = sigma * Math.sqrt(FORECAST_DAYS);
        const low = Math.max(0, Math.floor(expected - spread)), high = Math.max(low, Math.ceil(expected + spread));

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
            cost_price: cost,
            stock,
            reorder_level: reorderLevel,
            on_order: coming,
            sold_30d: sold,
            expected_30d: Math.round(expected * 10) / 10,
            expected_low: low,
            expected_high: high,
            lead_time_days: lead,
            per_week: Math.round(daily * 7 * 10) / 10,
            days_left: daysLeft,
            runs_out_on: runOut,
            order_by: orderBy,
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
            // 'new' while it has under two weeks on record, 'average' under six, then 'model'
            basis: f ? f.basis || null : null,
            days_on_record: f ? Number(f.days_of_history) || 0 : 0,
            test_expected: f && f.test_expected != null ? Number(f.test_expected) : null,
            test_sold: f && f.test_sold != null ? Number(f.test_sold) : null,
            // sold on the last 30 and 7 days the forecast counts; null when it has no forecast
            sold_counted_30d: f && f.counted_30d != null ? Number(f.counted_30d) : null,
            sold_counted_7d: f && f.counted_7d != null ? Number(f.counted_7d) : null
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
        r.how_sure = howSure(r);
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

        // all five asked together rather than one after another: each trip to
        // the database is long (speed fix, 3 Nov). orderRows is stock a
        // supplier is already bringing (what they confirmed where they have);
        // leadRows each supplier's average days from order to delivery over
        // the last year, at least two deliveries.
        const [[products], [soldRows], [orderRows], [lastRows], [leadRows]] = await Promise.all([
            pool.query(`
            SELECT p.id, p.name, p.sku, p.brand, p.unit_price, p.cost_price, p.stock_quantity, p.reorder_level,
                   s.id AS supplier_id, c.name AS category, s.name AS supplier_name,
                   DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expires_on
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.is_active = TRUE
            WHERE p.is_active = TRUE`),
            pool.query(`
            SELECT si.product_id, SUM(si.quantity) AS qty
            FROM sale_items si JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
              AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY si.product_id`),
            pool.query(`
            SELECT pi.product_id, SUM(COALESCE(pi.confirmed_quantity, pi.quantity)) AS qty
            FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
            WHERE po.status IN ('pending', 'confirmed', 'shipped')
            GROUP BY pi.product_id`),
            pool.query(`
            SELECT COUNT(DISTINCT CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                                       THEN DATE(CONVERT_TZ(created_at,'+00:00','+08:00')) END) AS recent_days,
                   DATE_FORMAT(CONVERT_TZ(MAX(created_at),'+00:00','+08:00'), '%Y-%m-%d') AS last_sale,
                   DATE_FORMAT(CONVERT_TZ(MIN(created_at),'+00:00','+08:00'), '%Y-%m-%d') AS first_sale,
                   DATEDIFF(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')),
                            DATE(CONVERT_TZ(MAX(created_at),'+00:00','+08:00'))) AS days_since
            FROM sales WHERE payment_status = 'completed'`),
            pool.query(`
            SELECT supplier_id, AVG(DATEDIFF(received_at, created_at)) AS days, COUNT(*) AS n
            FROM purchase_orders
            WHERE status = 'received' AND received_at IS NOT NULL AND received_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY supplier_id HAVING n >= 2`)
        ]);
        const leadTimes = new Map(leadRows.map(r => [Number(r.supplier_id), Math.min(30, Math.max(1, Math.ceil(Number(r.days) || 0)))]));

        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        const sold30 = new Map(soldRows.map(r => [Number(r.product_id), Number(r.qty)]));
        const onOrder = new Map(orderRows.map(r => [Number(r.product_id), Number(r.qty)]));
        const rows = planStock(products, all.data.predictions, sold30, { onOrder, today, leadTimes });
        const needOrder = rows.filter(r => r.stock_status !== 'ok');
        const sum = (list, field) => Math.round(list.reduce((a, r) => a + (Number(r[field]) || 0), 0) * 100) / 100;
        const expectedUnits = rows.reduce((a, r) => a + r.expected_30d, 0);
        // the last checks, oldest first: the five before, then the page's own test
        const lastTest = all.data.accuracy_test;
        const checks = pastChecks.checks.concat(lastTest && lastTest.actual_units >= MIN_TEST_UNITS && lastTest.from ? [lastTest] : [])
            .map(c => ({ from: c.from, to: c.to, predicted_units: c.predicted_units, actual_units: c.actual_units, mark: checkMark(c) }));
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
                    accuracy_products: all.data.backtested_products,
                    accuracy_test: all.data.accuracy_test || null,
                    // the forecast beside what the last 30 counted days sold, and what that says
                    sales_check: { ...salesCheck(expectedUnits, sum(rows, 'sold_counted_30d'), sum(rows, 'sold_counted_7d')), from: all.data.counted_from || null },
                    // how the forecast did on its last checks (up to six fortnights), oldest first
                    checks
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

        // By the shop's own calendar day, and without the days the forecast
        // leaves out: one freak Saturday (7 Nov 2026, 618 items) had made
        // "weekends sell 99% more" out of an ordinary week. The forecast is
        // built first so the days it leaves out are known.
        if (!allCache.payload) await rebuildAllPredictions().catch(() => {});
        const skip = allCache.skip && allCache.skip.size ? [...allCache.skip] : null;
        const shopDate = "DATE(CONVERT_TZ(s.created_at,'+00:00','+08:00'))";
        const [dowData] = await pool.query(`
            SELECT DAYOFWEEK(${shopDate}) as day_of_week,
                   SUM(si.quantity) as total_qty,
                   COUNT(DISTINCT ${shopDate}) as active_days
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            ${skip ? `AND ${shopDate} NOT IN (?)` : ''}
            GROUP BY day_of_week
            ORDER BY day_of_week
        `, skip ? [skip] : []);

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
router._internals = { forecastSeries, recentAverage, describeRecent, reorderFigures, howSure, guessedClose, AVERAGE_DAYS, backtestAccuracy, holdoutTest, backtestSplit, buildDailySeries, findNoDataDays, prepareShop, testShop, planStock, demandBy, mlJobsFor, shopTypicals, salesCheck, checkMark };
// the supplier page shows each supplier the forecast for its own products
router.peekForecasts = peekForecasts;
// server.js warms this on boot and on a timer so Analytics opens instantly
router.warmAllPredictions = warmAllPredictions;

module.exports = router;
