const test = require('node:test');
const assert = require('node:assert');

const { buildDailySeries } = require('../routes/predictions')._internals;

const row = (sale_day, quantity) => ({ sale_day, quantity });

test('series: days are the shop\'s calendar days, as the query reports them', () => {
    // A 6am sale in Manila is the previous day in UTC. The query hands over the
    // shop's day, and that is the one that must be used.
    const series = buildDailySeries(
        [{ sale_day: '2026-10-07', sale_date: '2026-10-06T22:30:00.000Z', quantity: 3 }], 365, '2026-10-08');
    assert.deepEqual(series, [{ date: '2026-10-07', quantity: 3 }, { date: '2026-10-08', quantity: 0 }]);
});

test('series: the day still in progress is left out', () => {
    // graded against a morning's takings, any forecast would look like an over-forecast
    const series = buildDailySeries([row('2026-10-07', 5), row('2026-10-08', 4), row('2026-10-09', 1)], 365, '2026-10-08');
    assert.equal(series[series.length - 1].date, '2026-10-08');
    assert.equal(series.reduce((a, d) => a + d.quantity, 0), 9);
});

test('series: days with no sales are zeros, not gaps', () => {
    const series = buildDailySeries([row('2026-10-01', 2), row('2026-10-05', 1)], 365, '2026-10-06');
    assert.deepEqual(series.map(d => d.quantity), [2, 0, 0, 0, 1, 0]);
});

test('series: only the last maxDays are kept', () => {
    const series = buildDailySeries([row('2026-01-01', 1), row('2026-10-05', 1)], 30, '2026-10-06');
    assert.equal(series.length, 30);
    assert.equal(series[0].date, '2026-09-07');
});

test('series: nothing on record gives an empty series', () => {
    assert.deepEqual(buildDailySeries([], 365, '2026-10-08'), []);
    assert.deepEqual(buildDailySeries([row('2026-10-09', 4)], 365, '2026-10-08'), [], 'only today has sales');
});
