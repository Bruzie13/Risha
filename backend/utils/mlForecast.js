/**
 * Ensemble machine-learning demand forecaster: Random Forest + Gradient
 * Boosting over engineered calendar/lag features, implemented from scratch
 * (CART regression trees) so the pipeline is fully inspectable.
 *
 * Features per day: day-of-week, weekend flag, lag-1/7/14 sales,
 * 7- and 28-day rolling means, and a linear time index.
 * Multi-step forecasts are produced recursively: each predicted day is
 * appended to the history so the next day's lags include it.
 */

// ---------- CART regression tree ----------

function variance(idx, y) {
    if (idx.length === 0) return 0;
    let sum = 0, sum2 = 0;
    for (const i of idx) { sum += y[i]; sum2 += y[i] * y[i]; }
    const mean = sum / idx.length;
    return sum2 / idx.length - mean * mean;
}

function mean(idx, y) {
    let s = 0;
    for (const i of idx) s += y[i];
    return idx.length ? s / idx.length : 0;
}

function buildTree(X, y, idx, opts, depth, rng) {
    const node = { value: mean(idx, y) };
    if (depth >= opts.maxDepth || idx.length < opts.minSplit) return node;

    const parentVar = variance(idx, y);
    if (parentVar < 1e-9) return node;

    // random feature subset (Random Forest de-correlation)
    const nFeat = X[0].length;
    const featIdx = [...Array(nFeat).keys()];
    for (let i = featIdx.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [featIdx[i], featIdx[j]] = [featIdx[j], featIdx[i]];
    }
    const tryFeats = featIdx.slice(0, opts.maxFeatures || nFeat);

    let best = null;
    for (const f of tryFeats) {
        const values = [...new Set(idx.map(i => X[i][f]))].sort((a, b) => a - b);
        if (values.length < 2) continue;
        // candidate thresholds: midpoints (cap at 12 per feature for speed)
        const step = Math.max(1, Math.floor(values.length / 12));
        for (let v = 0; v < values.length - 1; v += step) {
            const thr = (values[v] + values[v + 1]) / 2;
            const left = [], right = [];
            for (const i of idx) (X[i][f] <= thr ? left : right).push(i);
            if (left.length < opts.minLeaf || right.length < opts.minLeaf) continue;
            const score = (left.length * variance(left, y) + right.length * variance(right, y)) / idx.length;
            if (!best || score < best.score) best = { f, thr, left, right, score };
        }
    }
    if (!best || parentVar - best.score < 1e-9) return node;

    node.feature = best.f;
    node.threshold = best.thr;
    node.left = buildTree(X, y, best.left, opts, depth + 1, rng);
    node.right = buildTree(X, y, best.right, opts, depth + 1, rng);
    return node;
}

function predictTree(node, x) {
    while (node.feature !== undefined) {
        node = x[node.feature] <= node.threshold ? node.left : node.right;
    }
    return node.value;
}

// deterministic RNG so forecasts are reproducible run to run
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ---------- Random Forest ----------

function trainForest(X, y, { nTrees = 40, maxDepth = 6, minLeaf = 3, seed = 7 } = {}) {
    const rng = mulberry32(seed);
    const maxFeatures = Math.max(2, Math.round(Math.sqrt(X[0].length)));
    const trees = [];
    for (let t = 0; t < nTrees; t++) {
        const idx = Array.from({ length: X.length }, () => Math.floor(rng() * X.length)); // bootstrap
        trees.push(buildTree(X, y, idx, { maxDepth, minLeaf, minSplit: minLeaf * 2, maxFeatures }, 0, rng));
    }
    return x => trees.reduce((a, tr) => a + predictTree(tr, x), 0) / trees.length;
}

// ---------- Gradient Boosting ----------

function trainBoost(X, y, { nRounds = 60, lr = 0.08, maxDepth = 3, minLeaf = 4, seed = 11 } = {}) {
    const rng = mulberry32(seed);
    const base = y.reduce((a, b) => a + b, 0) / y.length;
    const models = [];
    const pred = new Array(y.length).fill(base);
    const all = [...Array(X.length).keys()];
    for (let r = 0; r < nRounds; r++) {
        const residual = y.map((v, i) => v - pred[i]);
        // stochastic boosting: 80% row subsample each round
        const idx = all.filter(() => rng() < 0.8);
        const tree = buildTree(X, residual, idx.length >= minLeaf * 2 ? idx : all,
            { maxDepth, minLeaf, minSplit: minLeaf * 2, maxFeatures: X[0].length }, 0, rng);
        models.push(tree);
        for (let i = 0; i < X.length; i++) pred[i] += lr * predictTree(tree, X[i]);
    }
    return x => base + models.reduce((a, tr) => a + lr * predictTree(tr, x), 0);
}

// ---------- Feature engineering ----------

const WARMUP = 28; // days of history needed before the first training row

function featuresFor(t, qty, dowOf) {
    const roll = (from, len) => {
        let s = 0;
        for (let k = from - len; k < from; k++) s += qty[k];
        return s / len;
    };
    const dow = dowOf(t);
    return [
        dow,                       // day of week 0-6
        dow === 0 || dow === 6 ? 1 : 0, // weekend flag
        qty[t - 1],                // lag 1
        qty[t - 7],                // lag 7
        qty[t - 14],               // lag 14
        roll(t, 7),                // 7-day rolling mean
        roll(t, 28),               // 28-day rolling mean
        t                          // linear time index (trend)
    ];
}

/**
 * series: [{ date: 'YYYY-MM-DD', quantity }] — continuous calendar days.
 * Returns daily predictions or null when history is too short to train.
 */
function forecastML(series, days) {
    if (series.length < WARMUP + 14) return null; // need 14+ training rows

    const qty = series.map(p => p.quantity);
    const firstDow = new Date(series[0].date + 'T00:00:00Z').getUTCDay();
    const dowOf = t => (firstDow + t) % 7;

    const X = [], y = [];
    for (let t = WARMUP; t < qty.length; t++) {
        X.push(featuresFor(t, qty, dowOf));
        y.push(qty[t]);
    }

    const rf = trainForest(X, y);
    const gb = trainBoost(X, y);

    // recursive multi-step: predicted days feed the next day's lag features
    const extended = qty.slice();
    const preds = [];
    const DAY_MS = 86400000;
    const lastMs = Date.parse(series[series.length - 1].date + 'T00:00:00Z');
    for (let i = 1; i <= days; i++) {
        const t = extended.length;
        const x = featuresFor(t, extended, dowOf);
        const val = Math.max(0, (rf(x) + gb(x)) / 2); // RF + GBM ensemble
        extended.push(val);
        preds.push({ date: new Date(lastMs + i * DAY_MS).toISOString().split('T')[0], predicted_quantity: Math.round(val * 100) / 100, day: i });
    }
    return preds;
}

module.exports = { forecastML, trainForest, trainBoost, WARMUP };
