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

// ---- what the study's predictive module is meant to answer ----
const TODAY = '2026-10-09';
const plan = (products, forecasts, extra = {}) =>
    byId(planStock(products, forecasts, extra.sold || new Map(), { today: TODAY, onOrder: extra.onOrder }));

test('when to reorder: the order-by date is the run-out date less the delivery wait', () => {
    // 60 a month is 2 a day; 30 in stock runs out in 15 days, so order within 8
    const r = plan([product(1, 30, 5)], [forecast(1, 60)]);
    assert.equal(r[1].runs_out_on, '2026-10-24');
    assert.equal(r[1].order_by, '2026-10-17');
});

test('when to reorder: already too late to arrive in time means order today', () => {
    const r = plan([product(1, 6, 5), product(2, 0, 5)], [forecast(1, 60), forecast(2, 60)]);
    assert.equal(r[1].order_by, TODAY, '3 days of stock against a 7-day wait');
    assert.equal(r[2].order_by, TODAY, 'nothing left');
});

test('stock already on order is not ordered twice', () => {
    const r = plan([product(1, 0), product(2, 0)], [], { onOrder: new Map([[1, 20], [2, 5]]) });
    assert.equal(r[1].suggested_order, 0, 'the 20 needed are already coming');
    assert.equal(r[1].on_order, 20);
    assert.equal(r[2].suggested_order, 15, 'only the shortfall');
    assert.equal(r[1].stock_status, 'out', 'it is still out of stock until the delivery lands');
});

test('reorder point is expected sales during the delivery wait plus safety stock', () => {
    // 2 a day × 7 days = 14, plus 1.65 × 3 × √7 = 13.1 → 14
    const r = plan([product(1, 100, 5)], [forecast(1, 60, { sigma: 3 })]);
    assert.equal(r[1].safety_stock, 14);
    assert.equal(r[1].recommended_reorder_point, 28);
    const steady = plan([product(1, 100, 5)], [forecast(1, 60, { sigma: 0 })]);
    assert.equal(steady[1].safety_stock, 0, 'perfectly regular sales need no buffer');
    assert.equal(steady[1].recommended_reorder_point, 14);
});

test('at or below the reorder level the trigger is already reached: order today', () => {
    // sells one a month, so it would last for ages — but it is under its level
    const r = plan([product(1, 8, 10)], [forecast(1, 1)]);
    assert.equal(r[1].stock_status, 'reorder_now');
    assert.equal(r[1].order_by, TODAY);
});

test('a product with no expected sales gets no made-up reorder point', () => {
    const r = plan([product(1, 50)], [forecast(1, 0)]);
    assert.equal(r[1].recommended_reorder_point, null);
    assert.equal(r[1].order_by, null);
});

test('overstock is what is left after three months of expected sales, at cost', () => {
    // 30 a month is 1 a day; 200 in stock is 110 more than 90 days need
    const r = plan([product(1, 200, 5, { cost_price: 50 })], [forecast(1, 30)]);
    assert.equal(r[1].excess_units, 110);
    assert.equal(r[1].excess_value, 5500);
    assert.equal(r[1].excess_reason, 'slow');
    const fine = plan([product(1, 60, 5)], [forecast(1, 30)]);
    assert.equal(fine[1].excess_units, 0, 'two months of stock is not overstock');
});

test('stock that is not selling at all is excess above its reorder level', () => {
    const r = plan([product(1, 40, 10, { cost_price: 20 })], []);
    assert.equal(r[1].excess_reason, 'not_selling');
    assert.equal(r[1].excess_units, 30);
    const sold = plan([product(1, 40, 10)], [], { sold: new Map([[1, 2]]) });
    assert.equal(sold[1].excess_units, 0, 'it sold something recently');
});

test('expiry: what will still be on the shelf on the expiry date', () => {
    // 1 a day, expires in 20 days, 50 in stock → 30 left over
    const r = plan([product(1, 50, 5, { expires_on: '2026-10-29', cost_price: 10 })], [forecast(1, 30)]);
    assert.equal(r[1].days_to_expiry, 20);
    assert.equal(r[1].expiry_risk_units, 30);
    assert.equal(r[1].expiry_risk_value, 300);
    const sells = plan([product(1, 15, 5, { expires_on: '2026-10-29' })], [forecast(1, 30)]);
    assert.equal(sells[1].expiry_risk_units, 0, 'it will sell out first');
});

test('expiry: already expired stock is reported as expired, not as a forecast', () => {
    const r = plan([product(1, 12, 5, { expires_on: '2026-10-01' })], [forecast(1, 30)]);
    assert.equal(r[1].expired_units, 12);
    assert.equal(r[1].expiry_risk_units, 0);
    const far = plan([product(1, 500, 5, { expires_on: '2027-10-01' })], [forecast(1, 30)]);
    assert.equal(far[1].expiry_risk_units, 0, 'a date a year away is not worth a warning yet');
});
