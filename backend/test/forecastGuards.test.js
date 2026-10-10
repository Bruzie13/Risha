const test = require('node:test');
const assert = require('node:assert');

const { shopTypical, dailyCap, capSeries } = require('../utils/forecastGuards');

const DAY = 86400000;
const series = (quantities, last = '2026-10-10') => quantities.map((q, i) => ({
    date: new Date(Date.parse(last + 'T00:00:00Z') - (quantities.length - 1 - i) * DAY).toISOString().slice(0, 10),
    quantity: q
}));
const rep = (v, n) => Array(n).fill(v);

test('outliers: a freak day is brought down to the cap', () => {
    const s = series([...rep(1, 119), 10000]);
    const capped = capSeries(s, 4);
    assert.equal(capped.cap, 5, 'sells 1 on a typical day: the cap is the floor of 5');
    assert.equal(capped.clipped, 1);
    assert.equal(capped.series[119].quantity, 5);
    assert.equal(capped.series[0].quantity, 1, 'ordinary days are untouched');
    assert.equal(s[119].quantity, 10000, 'the series passed in is not changed');
});

test('outliers: a spike on the last day is capped by the days before it', () => {
    const capped = capSeries(series([...rep(2, 119), 40]), 4);
    assert.equal(capped.cap, 8);
    assert.equal(capped.series[119].quantity, 8);
});

test('outliers: a lasting change of level is not an outlier', () => {
    const s = series([...rep(10, 60), ...rep(2, 60)]);
    const capped = capSeries(s, 4);
    assert.equal(capped.clipped, 0);
    assert.equal(capped.series, s, 'nothing over the cap: the same series comes back');
});

test('outliers: a product with too little history is judged by the shop', () => {
    assert.equal(dailyCap(series([10000]), 4), 16, 'one selling day cannot say what is typical');
    assert.equal(dailyCap(series([1, 1, 1, 300]), 4), 16, 'nor can four');
    assert.equal(dailyCap(series([1, 1, 1, 1, 300]), 4), 5, 'five can: three in four of them are 1');
    assert.equal(capSeries(series([0, 0, 10000, 0]), 4).series[2].quantity, 16);
});

test('outliers: days with no sale do not count toward what is typical', () => {
    const s = series([...rep(0, 100), 6, 0, 6, 0, 6, 0, 6, 0, 6, 0, 90]);
    assert.equal(dailyCap(s, 4), 24, 'typical selling day is 6');
    assert.equal(capSeries(s, 4).series[s.length - 1].quantity, 24);
});

test('outliers: the cap comes only from the days given', () => {
    const whole = series([...rep(2, 100), ...rep(30, 20)]);
    assert.equal(capSeries(whole.slice(0, 100), 4).cap, 8, 'the first 100 days know nothing of the 30s');
    assert.equal(capSeries(whole, 4).cap, 8, '20 selling days in 120 is under a quarter: still not typical');
    assert.equal(capSeries(series([...rep(2, 60), ...rep(30, 60)]), 4).cap, 120, 'half the days at 30 is the new typical');
});

test('outliers: the shop-wide typical day', () => {
    assert.equal(shopTypical([series([1, 0, 2, 0]), series([4, 4, 0, 9])]), 4);
    assert.equal(shopTypical([series([0, 0]), []]), 1, 'nothing sold anywhere');
    assert.equal(shopTypical([]), 1);
});

const { isNewProduct, cautiousDailyRate, MIN_HISTORY_DAYS } = require('../utils/forecastGuards');
const { forecastSeries } = require('../routes/predictions')._internals;
const total = fc => fc.predictions.reduce((a, p) => a + p.predicted_quantity, 0);

test('new product: under 14 days on record is "new"', () => {
    assert.equal(MIN_HISTORY_DAYS, 14);
    assert.equal(isNewProduct(series([])), true);
    assert.equal(isNewProduct(series(rep(1, 13))), true);
    assert.equal(isNewProduct(series(rep(1, 14))), false);
});

test('new product: sales so far are spread over 14 days, not over the days it has existed', () => {
    assert.equal(cautiousDailyRate(series([5])), 5 / 14);
    assert.equal(cautiousDailyRate(series([5, 0, 0])), 5 / 14, 'the same sale three days later is the same estimate');
    assert.equal(cautiousDailyRate(series(rep(2, 13))), 26 / 14);
    assert.equal(cautiousDailyRate(series([])), 0);
});

test('new product: one sale of 5 on the first day is not forecast as 5 a day', () => {
    const fc = forecastSeries(series([5]), 30, { shopTypical: 4 });
    assert.equal(fc.basis, 'new');
    assert.ok(total(fc) > 10 && total(fc) < 11.5, `about 11 in 30 days, got ${total(fc)}`);
    assert.equal(fc.predictions.length, 30);
    assert.ok(fc.predictions.every(p => p.predicted_quantity === fc.predictions[0].predicted_quantity), 'the same every day: no shape is fitted');
    assert.ok(fc.predictions.every(p => p.lower_bound === 0 && p.upper_bound >= p.predicted_quantity));
    assert.equal(fc.parts.ml, null, 'no model');
    assert.ok(fc.confidence < 45, 'confidence reads low');
});

test('new product: the estimate grows with what is sold and meets the plain average at 14 days', () => {
    const day1 = total(forecastSeries(series([1]), 30, { shopTypical: 4 }));
    const day13 = total(forecastSeries(series(rep(2, 13)), 30, { shopTypical: 4 }));
    const day14 = forecastSeries(series(rep(2, 14)), 30, { shopTypical: 4 });
    assert.ok(day1 > 1.5 && day1 < 2.5, `one sale of 1: about 2 in 30 days, got ${day1}`);
    assert.ok(day13 > 54 && day13 < 57, `13 days at 2 a day: about 56, got ${day13}`);
    assert.equal(day14.basis, 'trend', 'from day 14 the ordinary forecast takes over');
    assert.ok(total(day14) > 50 && total(day14) < 70, `14 days at 2 a day: about 60, got ${total(day14)}`);
});

test('new product: a freak first day is capped before it is spread', () => {
    const fc = forecastSeries(series([10000]), 30, { shopTypical: 4 });
    assert.ok(total(fc) < 40, `capped at 16, spread over 14 days: about 34, got ${total(fc)}`);
});

test('new product: nothing on record yet forecasts nothing', () => {
    const fc = forecastSeries([], 30, { shopTypical: 4 });
    assert.equal(total(fc), 0);
    assert.equal(fc.basis, 'new');
    assert.equal(fc.predictions.length, 30);
});
