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
});

test('28-day average: 14 to 41 days on record are forecast at the average of the last 28 days', () => {
    const { recentAverage, AVERAGE_DAYS } = require('../routes/predictions')._internals;
    assert.equal(AVERAGE_DAYS, 28);
    // two older days of 3 fall outside the 28 days and are not read
    const fc = forecastSeries(series([3, 3, ...rep(1, 28)]), 30, { shopTypical: 4 });
    assert.equal(fc.basis, 'average');
    assert.ok(fc.predictions.every(p => p.predicted_quantity === 1), 'the same figure every day ahead: 1 a day');
    assert.equal(total(fc), 30);
    // under 28 days on record: the average of what there is
    assert.equal(recentAverage(series(rep(2, 20)), 30).rate, 2);
    assert.equal(recentAverage([], 30).rate, 0);
});

test('28-day average: a product that has stopped selling forecasts nothing', () => {
    // sold steadily, then nothing at all for the last 4 weeks (38 days on record,
    // too few for the model, so the average forecasts it)
    const stopped = forecastSeries(series([...rep(3, 10), ...rep(0, 28)]), 30, { shopTypical: 4 });
    assert.equal(stopped.basis, 'average');
    assert.equal(total(stopped), 0);
});

test('28-day average: the range around it is one spread of the last 8 weeks, never below zero', () => {
    const patchy = forecastSeries(series(Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 3 : 0))), 30, { shopTypical: 4 });
    assert.ok(patchy.sigma > 0);
    assert.ok(patchy.predictions.every(p => p.lower_bound >= 0 && p.lower_bound <= p.predicted_quantity && p.upper_bound > p.predicted_quantity));
    const steady = forecastSeries(series(rep(4, 30)), 30, { shopTypical: 4 });
    assert.equal(steady.sigma, 0, 'the same every day: no spread');
    assert.ok(steady.predictions.every(p => p.lower_bound === 4 && p.upper_bound === 4));
});

test('new product: the estimate grows with what is sold and meets the plain average at 14 days', () => {
    const day1 = total(forecastSeries(series([1]), 30, { shopTypical: 4 }));
    const day13 = total(forecastSeries(series(rep(2, 13)), 30, { shopTypical: 4 }));
    const day14 = forecastSeries(series(rep(2, 14)), 30, { shopTypical: 4 });
    assert.ok(day1 > 1.5 && day1 < 2.5, `one sale of 1: about 2 in 30 days, got ${day1}`);
    assert.ok(day13 > 54 && day13 < 57, `13 days at 2 a day: about 56, got ${day13}`);
    assert.equal(day14.basis, 'average', 'from day 14 the 28-day average takes over');
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

const { noDataDays } = require('../utils/forecastGuards');
const dayMap = (obj) => new Map(Object.entries(obj));

test('days without data: sales recorded with no items are left out', () => {
    const sold = dayMap({ '2026-05-08': 90, '2026-05-09': 87, '2026-06-01': 20, '2026-06-02': 25 });
    const sales = dayMap({ '2026-05-08': 10, '2026-05-09': 9, '2026-05-10': 12, '2026-05-11': 11, '2026-05-27': 8, '2026-06-01': 9, '2026-06-02': 11 });
    const r = noDataDays(sold, sales, '2026-05-08', '2026-06-02');
    assert.equal(r.days.size, 22, '10 to 31 May');
    assert.ok(r.days.has('2026-05-10') && r.days.has('2026-05-31'));
    assert.ok(!r.days.has('2026-05-09') && !r.days.has('2026-06-01'));
    assert.deepEqual(r.ranges, [{ from: '2026-05-10', to: '2026-05-31', days: 22, sales: 31, reason: 'no_items' }]);
});

test('days without data: one or two quiet days are real zeros', () => {
    const sold = dayMap({ '2026-04-05': 5, '2026-04-07': 6, '2026-04-10': 4 });
    const r = noDataDays(sold, dayMap({ '2026-04-05': 2, '2026-04-07': 2, '2026-04-10': 1 }), '2026-04-05', '2026-04-10');
    assert.equal(r.days.size, 0, 'the 6th alone, and the 8th and 9th together, stay in');
    assert.deepEqual(r.ranges, []);
});

test('days without data: three empty days in a row with no sale at all is a closure', () => {
    const sold = dayMap({ '2026-04-01': 5, '2026-04-05': 6 });
    const r = noDataDays(sold, dayMap({ '2026-04-01': 1, '2026-04-05': 1 }), '2026-04-01', '2026-04-05');
    assert.deepEqual(r.ranges, [{ from: '2026-04-02', to: '2026-04-04', days: 3, sales: 0, reason: 'closed' }]);
});

test('days without data: empty days up to the last day on record are kept', () => {
    const sold = dayMap({ '2026-04-01': 5, '2026-04-02': 5 });
    const r = noDataDays(sold, dayMap({ '2026-04-01': 1, '2026-04-02': 1 }), '2026-04-01', '2026-04-10');
    assert.equal(r.days.size, 0, 'recent silence may be real');
});

test('days without data: nothing to look at gives nothing', () => {
    assert.equal(noDataDays(new Map(), new Map(), null, '2026-04-10').days.size, 0);
    assert.equal(noDataDays(new Map(), new Map(), '2026-04-11', '2026-04-10').days.size, 0);
});

const { freakDays } = require('../utils/forecastGuards');
/** A shop's days in a row from `first`, one figure a day. */
const shopDays = (quantities, first = '2026-10-01') => new Map(quantities.map((q, i) =>
    [new Date(Date.parse(first + 'T00:00:00Z') + i * DAY).toISOString().slice(0, 10), q]));
const lastOf = (map) => [...map.keys()].pop();

test('freak day: one day far above the usual busy day is left out', () => {
    // 30 ordinary days of 10 to 17 items, then 618 in one day, then ordinary again
    const usual = [12, 15, 10, 17, 14, 13, 16, 11, 12, 15];
    const sold = shopDays([...usual, ...usual, ...usual, 618, 8, 14]);
    const r = freakDays(sold, '2026-10-01', lastOf(sold));
    assert.deepEqual([...r.days], ['2026-10-31']);
    assert.equal(r.ranges.length, 1);
    assert.deepEqual(r.ranges[0], { from: '2026-10-31', to: '2026-10-31', days: 1, items: 618, typical: 15, reason: 'freak' });
});

test('freak day: a busy day within four times the usual is kept', () => {
    const usual = [12, 15, 10, 17, 14, 13, 16, 11, 12, 15];
    // usual busy day 15, so the line is 60: a payday of 58 stays, 61 does not
    assert.equal(freakDays(shopDays([...usual, ...usual, 58, 12]), '2026-10-01', '2026-10-22').days.size, 0);
    assert.equal(freakDays(shopDays([...usual, ...usual, 61, 12]), '2026-10-01', '2026-10-22').days.size, 1);
});

test('freak day: a small shop is not judged below 20 items', () => {
    // sells 1 or 2 a day: four times its usual is 8, but 18 in a day is a good day, not a freak
    const sold = shopDays([...rep(1, 10), ...rep(2, 10), 18, 1]);
    assert.equal(freakDays(sold, '2026-10-01', lastOf(sold)).days.size, 0);
    const big = shopDays([...rep(1, 10), ...rep(2, 10), 21, 1]);
    assert.equal(freakDays(big, '2026-10-01', lastOf(big)).days.size, 1);
});

test('freak day: nothing is judged before the shop has 14 selling days', () => {
    const sold = shopDays([...rep(3, 13), 500]);
    assert.equal(freakDays(sold, '2026-10-01', lastOf(sold)).days.size, 0);
});

test('freak day: two in a row are left out, three in a row are a new level and are kept', () => {
    const two = shopDays([...rep(10, 20), 200, 220, 11]);
    const r2 = freakDays(two, '2026-10-01', lastOf(two));
    assert.deepEqual([...r2.days], ['2026-10-21', '2026-10-22']);
    assert.equal(r2.ranges[0].items, 420);
    const three = shopDays([...rep(10, 20), 200, 220, 210, 11]);
    assert.equal(freakDays(three, '2026-10-01', lastOf(three)).days.size, 0, 'the forecast has to learn a lasting rise');
});

test('freak day: days with no sale between them do not split a run', () => {
    // high Friday and Saturday, closed Sunday, high Monday: three selling days in a row
    const sold = shopDays([...rep(10, 20), 200, 220, 0, 210, 11]);
    assert.equal(freakDays(sold, '2026-10-01', lastOf(sold)).days.size, 0);
});

test('freak day: a freak on the last day on record is left out at once', () => {
    const sold = shopDays([...rep(10, 20), 300]);
    assert.deepEqual([...freakDays(sold, '2026-10-01', lastOf(sold)).days], ['2026-10-21']);
});

test('freak day: only the days before a day say what is usual', () => {
    // judged as of 20 Oct, the busy days that come after cannot make 15 Oct look ordinary
    const sold = shopDays([...rep(5, 14), 90, ...rep(5, 5), ...rep(90, 10)]);
    assert.deepEqual([...freakDays(sold, '2026-10-01', '2026-10-20').days], ['2026-10-15']);
});

test('freak day: nothing to look at gives nothing', () => {
    assert.equal(freakDays(new Map(), null, '2026-10-10').days.size, 0);
    assert.equal(freakDays(new Map(), '2026-10-11', '2026-10-10').days.size, 0);
});

test('accuracy test: a closed fortnight inside the hidden days does not drop the method comparison', () => {
    const { holdoutTest, backtestSplit, forecastSeries: fs } = require('../routes/predictions')._internals;
    // sells about 3 a day; nothing recorded Oct 11 to 25 (left out), sales again Oct 26 to 28
    const days = [];
    for (let t = Date.parse('2026-06-01T00:00:00Z'); t <= Date.parse('2026-10-28T00:00:00Z'); t += DAY) {
        const date = new Date(t).toISOString().slice(0, 10);
        if (date >= '2026-10-11' && date <= '2026-10-25') continue;
        days.push({ date, quantity: 2 + (days.length % 3) });
    }
    const split = backtestSplit(days);
    assert.ok(split.horizon > split.holdout, 'the hidden days straddle the gap');
    const t = holdoutTest(days, 4, true);
    assert.ok(t.parts, 'each method still gets a score');
    // scored on the 14 hidden days only, not the 30-day run with the gap in it
    const whole = fs(split.train, split.horizon, { compare: true, shopTypical: 4 }).parts.baseline;
    assert.ok(t.parts.baseline < whole * 0.6, `hidden days only: ${t.parts.baseline} against ${whole} for the whole run`);
    if (t.parts.ml !== null) assert.ok(Math.abs(t.parts.ml - t.rawTotal) < 0.5, 'the model alone is what the forecast used');
});
