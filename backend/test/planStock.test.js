const test = require('node:test');
const assert = require('node:assert');

const { planStock } = require('../routes/predictions')._internals;

const product = (id, stock, reorder = 10, extra = {}) =>
    ({ id, name: 'P' + id, sku: 'SKU-' + id, unit_price: 100, stock_quantity: stock, reorder_level: reorder, ...extra });
const forecast = (id, next30, extra = {}) =>
    ({ product_id: id, next_month_prediction: next30, trend: 'stable', confidence_score: 80, ...extra });
const byId = rows => Object.fromEntries(rows.map(r => [r.product_id, r]));

test('planStock: nothing left is out of stock, whatever the forecast says', () => {
    const r = byId(planStock([product(1, 0)], [forecast(1, 0)], new Map()));
    assert.equal(r[1].stock_status, 'out');
    assert.equal(r[1].suggested_order, 20, 'brings the shelf back to twice the reorder level');
});

test('planStock: at or below the reorder level means reorder now', () => {
    const r = byId(planStock([product(1, 10), product(2, 11)], [], new Map()));
    assert.equal(r[1].stock_status, 'reorder_now');
    assert.equal(r[2].stock_status, 'ok');
    assert.equal(r[2].suggested_order, 0);
});

test('planStock: stock that runs out before a delivery arrives is reorder now', () => {
    // 60 a month is 2 a day; 12 in stock lasts 6 days, under the 7-day lead time
    const r = byId(planStock([product(1, 12, 5)], [forecast(1, 60)], new Map()));
    assert.equal(r[1].days_left, 6);
    assert.equal(r[1].stock_status, 'reorder_now');
    assert.equal(r[1].suggested_order, 62, '30 days of sales + 7 days of lead time - 12 on hand');
});

test('planStock: running out within three weeks is reorder soon, later is ok', () => {
    const r = byId(planStock(
        [product(1, 30, 5), product(2, 80, 5)],
        [forecast(1, 60), forecast(2, 60)], new Map()));
    assert.equal(r[1].stock_status, 'reorder_soon');   // 15 days of cover
    assert.equal(r[2].stock_status, 'ok');             // 40 days of cover
});

test('planStock: a product with no forecast and no recent sales is not selling', () => {
    const r = byId(planStock([product(1, 50), product(2, 50)], [forecast(2, 0)], new Map([[2, 3]])));
    assert.equal(r[1].demand, 'none');
    assert.equal(r[1].days_left, null, 'no demand means no run-out date, not a made-up one');
    assert.equal(r[2].demand, 'slow', 'sold a little recently but nothing is expected');
});

test('planStock: fast and slow are the top and bottom quarter of what is selling', () => {
    const products = [1, 2, 3, 4, 5, 6, 7, 8].map(i => product(i, 500));
    const forecasts = [1, 2, 3, 4, 5, 6, 7, 8].map(i => forecast(i, i * 10));
    const r = byId(planStock(products, forecasts, new Map()));
    assert.equal(r[8].demand, 'fast');
    assert.equal(r[1].demand, 'slow');
    assert.equal(r[4].demand, 'steady');
});

test('planStock: the most urgent products come first', () => {
    const rows = planStock(
        [product(1, 500), product(2, 0), product(3, 30, 5), product(4, 8)],
        [forecast(3, 60)], new Map());
    assert.deepEqual(rows.map(r => r.stock_status), ['out', 'reorder_now', 'reorder_soon', 'ok']);
});

test('planStock: confidence is reported as a word', () => {
    const r = byId(planStock([product(1, 50), product(2, 50), product(3, 50)],
        [forecast(1, 5, { confidence_score: 80 }), forecast(2, 5, { confidence_score: 50 }), forecast(3, 5, { confidence_score: 20 })], new Map()));
    assert.deepEqual([r[1].confidence, r[2].confidence, r[3].confidence], ['high', 'medium', 'low']);
});
