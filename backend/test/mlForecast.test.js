const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ml = require('../utils/mlForecast');

/** 90 days of a weekly-seasonal series, enough to train on. */
function makeSeries(days = 90) {
    const out = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(Date.UTC(2026, 3, 1 + i));
        out.push({ date: d.toISOString().slice(0, 10), quantity: (i % 7 === 0 ? 6 : 2) + (i % 3) });
    }
    return out;
}

test('forecastML: returns one prediction per requested day', () => {
    ml.clearMLCache();
    const preds = ml.forecastML(makeSeries(), 30);
    assert.ok(preds, 'expected the Python model to return predictions');
    assert.equal(preds.length, 30);
    assert.equal(preds[0].day, 1);
    assert.match(preds[0].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(preds.every(p => p.predicted_quantity >= 0), 'demand can never be negative');
});

test('forecastML: refuses to guess when history is too short to train', () => {
    ml.clearMLCache();
    assert.equal(ml.forecastML(makeSeries(20), 30), null);
});

test('forecastML: the model is deterministic across runs', () => {
    ml.clearMLCache();
    const a = ml.forecastML(makeSeries(), 10);
    ml.clearMLCache();
    const b = ml.forecastML(makeSeries(), 10);
    assert.deepEqual(a.map(p => p.predicted_quantity), b.map(p => p.predicted_quantity),
        'a fixed random_state must reproduce the same forecast');
});

test('warmMLCache: one Python run serves many products', () => {
    ml.clearMLCache();
    const jobs = [
        { series: makeSeries(90), days: 30 },
        { series: makeSeries(70), days: 14 },
        { series: makeSeries(10), days: 30 },   // too short — resolves to null
    ];
    ml.warmMLCache(jobs);
    assert.ok(ml.forecastML(jobs[0].series, 30), 'warmed 30-day forecast');
    assert.ok(ml.forecastML(jobs[1].series, 14), 'warmed 14-day backtest forecast');
    assert.equal(ml.forecastML(jobs[2].series, 30), null);
});

test('the model really is scikit-learn, not a JavaScript reimplementation', () => {
    // The thesis claims Python does the machine learning. Assert that the
    // bridge holds no learner of its own and that the Python module fits with
    // scikit-learn's ensembles.
    const bridge = require('fs').readFileSync(
        path.join(__dirname, '..', 'utils', 'mlForecast.js'), 'utf8');
    assert.ok(!/function buildTree|predictTree|trainForest|trainBoost/.test(bridge),
        'no tree fitting should remain in JavaScript');

    const model = require('fs').readFileSync(
        path.join(__dirname, '..', '..', 'ml', 'forecast.py'), 'utf8');
    assert.match(model, /from sklearn\.ensemble import .*GradientBoostingRegressor/);
    assert.match(model, /from sklearn\.ensemble import .*RandomForestRegressor/);
    assert.match(model, /RandomForestRegressor\(\*\*RF_PARAMS\)\.fit/);
    assert.match(model, /GradientBoostingRegressor\(\*\*GB_PARAMS\)\.fit/);
});

test('the Python model runs and reports its library versions', () => {
    const py = process.env.PYTHON_BIN || 'python3';
    const out = execFileSync(py, ['-c',
        'import sklearn,numpy;print(sklearn.__version__,numpy.__version__)'], { encoding: 'utf8' });
    assert.match(out.trim(), /^\d+\.\d+/);
});
