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

test('warmMLCacheAsync: fits without blocking the event loop', async () => {
    ml.clearMLCache();
    const jobs = [
        { series: makeSeries(90), days: 30 },
        { series: makeSeries(70), days: 14 },
    ];
    // A blocked loop cannot run timers; a free one ticks throughout the fit.
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 20);
    await ml.warmMLCacheAsync(jobs);
    clearInterval(timer);
    assert.ok(ticks >= 3, `event loop should keep turning during the fit (ticked ${ticks}x)`);
    assert.ok(ml.forecastML(jobs[0].series, 30), 'warmed 30-day forecast');
    assert.ok(ml.forecastML(jobs[1].series, 14), 'warmed 14-day backtest forecast');
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

/** The same series with a stretch of days removed, as when the shop has no record for them. */
function withDaysLeftOut(series, from, count) {
    return series.filter((_, i) => i < from || i >= from + count);
}

test('forecastML: a history with days left out still forecasts the days after its last day', () => {
    ml.clearMLCache();
    const series = withDaysLeftOut(makeSeries(120), 40, 22);
    assert.equal(series.length, 98);
    const preds = ml.forecastML(series, 30);
    assert.ok(preds, 'expected predictions');
    assert.equal(preds.length, 30);
    const last = Date.parse(series[series.length - 1].date + 'T00:00:00Z');
    assert.equal(preds[0].date, new Date(last + 86400000).toISOString().slice(0, 10), 'the first forecast day is the day after the last day on record');
    assert.ok(preds.every(p => p.predicted_quantity >= 0));
    ml.clearMLCache();
    assert.deepEqual(ml.forecastML(series, 30), preds, 'and the same input gives the same forecast');
});

test('the Python model works out real dates when days are left out, and never forecasts across a long break', () => {
    const py = process.env.PYTHON_BIN || 'python3';
    const script = [
        'import sys, json',
        `sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..', '..', 'ml'))})`,
        'from datetime import date',
        'import forecast as f',
        'd = f._dates(date(2026, 5, 8), 5, [[2, 22]])',
        'rows = f._rows([1.0] * 60, f._dates(date(2026, 4, 1), 60, [[40, 22]]), 0)[0]',
        'far = f._rows([1.0] * 60, f._dates(date(2026, 4, 1), 60, [[40, 45]]), 0)[0]',
        'plain = f._rows([1.0] * 60, f._dates(date(2026, 4, 1), 60), 0)[0]',
        'print(json.dumps({"dates": [x.isoformat() for x in d], "max_ahead": max(r[-1] for r in rows), "rows": len(rows), "rows_far": len(far), "max_ahead_far": max(r[-1] for r in far), "rows_plain": len(plain)}))',
    ].join('\n');
    const out = JSON.parse(execFileSync(py, ['-c', script], { encoding: 'utf8' }));
    assert.deepEqual(out.dates, ['2026-05-08', '2026-05-09', '2026-06-01', '2026-06-02', '2026-06-03']);
    assert.ok(out.max_ahead <= 30, `no training row looks more than 30 real days ahead (got ${out.max_ahead})`);
    assert.equal(out.rows, out.rows_plain, 'a 22-day break loses no rows: the first day back is forecast from 23 days before');
    assert.equal(out.rows_far, out.rows_plain - 1, 'after a 45-day break the first day back has nothing recent to go on and is dropped');
    assert.ok(out.max_ahead_far <= 30);
});
