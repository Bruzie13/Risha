const test = require('node:test');
const assert = require('node:assert');

const { planStock } = require('../routes/predictions')._internals;

const product = (id, stock, reorder = 10, extra = {}) =>
    ({ id, name: 'P' + id, sku: 'SKU-' + id, unit_price: 100, stock_quantity: stock, reorder_level: reorder, ...extra });
const forecast = (id, next30, extra = {}) =>
    ({ product_id: id, next_month_prediction: next30, trend: 'stable', ...extra });
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

test("planStock: a supplier's own delivery time sets when to order", () => {
    // 2 a day, 30 in stock: lasts 15 days. A 7-day supplier: order in 8 days; a 3-day one: in 12
    const products = [product(1, 30, 5, { supplier_id: 9 }), product(2, 30, 5, { supplier_id: 4 })];
    const r = byId(planStock(products, [forecast(1, 60), forecast(2, 60)], new Map(),
        { today: '2026-11-03', leadTimes: new Map([[4, 3]]) }));
    assert.equal(r[1].lead_time_days, 7, 'no record of supplier 9: the usual 7 days');
    assert.equal(r[1].order_by, '2026-11-11');
    assert.equal(r[2].lead_time_days, 3);
    assert.equal(r[2].order_by, '2026-11-15');
});

test('planStock: the suggested amount includes the safety buffer', () => {
    // 2 a day with a daily spread of 1: buffer = ceil(1.65 × 1 × √7) = 5
    const r = byId(planStock([product(1, 12, 5)], [forecast(1, 60, { sigma: 1 })], new Map()));
    assert.equal(r[1].safety_stock, 5);
    assert.equal(r[1].suggested_order, 67, '30 days + 7 days of wait + 5 buffer - 12 on hand');
});

test('planStock: next month is a range around the forecast', () => {
    // 30 expected, daily spread 1 → about ±5.5 over 30 days
    const r = byId(planStock([product(1, 100, 5)], [forecast(1, 30, { sigma: 1 })], new Map()));
    assert.equal(r[1].expected_low, 24);
    assert.equal(r[1].expected_high, 36);
    const none = byId(planStock([product(2, 5, 1)], [forecast(2, 0)], new Map()));
    assert.equal(none[2].expected_low, 0);
    assert.equal(none[2].expected_high, 0);
});

test('planStock: how sure comes from how close its own last test came', () => {
    const products = [1, 2, 3, 4, 5, 6, 7].map(id => product(id, 50, 5));
    const old = { basis: 'model', days_of_history: 200 };
    const fc = [
        forecast(1, 30, { ...old, test_expected: 12, test_sold: 14 }),   // 2 off 14: within a quarter
        forecast(2, 30, { ...old, test_expected: 6.4, test_sold: 15 }),  // 8.6 off 15: too far
        forecast(3, 4, { ...old, test_expected: 2.5, test_sold: 2 }),    // within 1 item
        forecast(4, 2, { ...old, test_expected: 1, test_sold: 1 }),      // spot on, but sold only 2 in 30 days
        forecast(5, 30, { ...old }),                                     // never tested
        forecast(6, 20, { basis: 'new', days_of_history: 10, test_expected: 5, test_sold: 5 }),
        forecast(7, 20, { basis: 'average', days_of_history: 20, test_expected: 5, test_sold: 5 })
    ];
    const sold = new Map([[1, 30], [2, 30], [3, 4], [4, 2], [5, 30], [6, 5], [7, 10]]);
    const r = byId(planStock(products, fc, sold));
    assert.equal(r[1].how_sure, 'sure', 'its last test came within a quarter of what sold');
    assert.equal(r[2].how_sure, 'rough', 'its last test was more than a quarter off');
    assert.equal(r[3].how_sure, 'sure', 'within 1 item counts as close for a small seller');
    assert.equal(r[4].how_sure, 'rough', 'under 4 sold in 30 days is too little to call sure');
    assert.equal(r[5].how_sure, 'rough', 'no test to go on');
    assert.equal(r[6].how_sure, 'new', 'under two weeks on record');
    assert.equal(r[7].how_sure, 'new', 'under four weeks on record');
});

test('howSure: a slow-selling product can be sure, a fast one can be rough', () => {
    const { howSure } = require('../routes/predictions')._internals;
    const base = { basis: 'model', days_on_record: 120 };
    // it no longer depends on how fast it sells, only on whether the forecast held up
    assert.equal(howSure({ ...base, demand: 'slow', sold_30d: 5, test_expected: 2, test_sold: 2 }), 'sure');
    assert.equal(howSure({ ...base, demand: 'fast', sold_30d: 90, test_expected: 20, test_sold: 45 }), 'rough');
});

test('howSure: sales on a day the forecast leaves out do not make a slow product "sure"', () => {
    const { howSure } = require('../routes/predictions')._internals;
    const base = { basis: 'model', days_on_record: 120, test_expected: 1, test_sold: 1 };
    // 6 sold in the last 30 calendar days, but 5 of them on a freak day: 1 on the days that count
    assert.equal(howSure({ ...base, sold_30d: 6, sold_counted_30d: 1 }), 'rough');
    assert.equal(howSure({ ...base, sold_30d: 6, sold_counted_30d: 6 }), 'sure');
    assert.equal(howSure({ ...base, sold_30d: 6 }), 'sure', 'without the counted figure it falls back on the calendar one');
});

test('planStock: what sold on the counted days is passed on', () => {
    const r = byId(planStock([product(1, 50, 5), product(2, 50, 5)], [forecast(1, 30, { counted_30d: 12, counted_7d: 4 })], new Map()));
    assert.equal(r[1].sold_counted_30d, 12);
    assert.equal(r[1].sold_counted_7d, 4);
    assert.equal(r[2].sold_counted_30d, null, 'no forecast, no counted figure');
});

test('salesCheck: the forecast beside what the last 30 counted days sold', () => {
    const { salesCheck } = require('../routes/predictions')._internals;
    // 656 expected against 416 sold: more, and within double, so it is in line
    const c = salesCheck(656, 416, 222);
    assert.deepEqual([c.direction, c.verdict, c.recent], ['more', 'ok', 'busier']);
    assert.deepEqual([c.expected_units, c.sold_units, c.sold_7d], [656, 416, 222]);
    // 3,262 expected against 416 sold: more than double
    assert.equal(salesCheck(3262, 416, 222).verdict, 'high');
    assert.equal(salesCheck(100, 416, 90).verdict, 'low', 'under half of what sold');
    assert.equal(salesCheck(200, 416, 90).direction, 'less');
    // a tenth either way is about the same
    assert.equal(salesCheck(440, 416, 97).direction, 'same');
    assert.equal(salesCheck(440, 416, 97).recent, 'steady');
    assert.equal(salesCheck(440, 416, 40).recent, 'quieter');
    // too little sold to compare with: no verdict either way
    assert.deepEqual([salesCheck(60, 12, 3).verdict, salesCheck(60, 12, 3).direction], ['none', 'same']);
});

test('checkMark: close within a fifth of what sold, else too high or too low', () => {
    const { checkMark } = require('../routes/predictions')._internals;
    assert.equal(checkMark({ predicted_units: 182, actual_units: 160 }), 'close');
    assert.equal(checkMark({ predicted_units: 305, actual_units: 235 }), 'high');
    assert.equal(checkMark({ predicted_units: 149, actual_units: 213 }), 'low');
    assert.equal(checkMark({ predicted_units: 120, actual_units: 100 }), 'close', 'exactly a fifth over is still close');
    assert.equal(checkMark({ predicted_units: 5, actual_units: 0 }), null);
});

test("planStock: each product's own test result is passed on", () => {
    const r = byId(planStock([product(1, 50, 5)], [forecast(1, 30, { test_expected: 6.4, test_sold: 15 })], new Map()));
    assert.equal(r[1].test_expected, 6.4);
    assert.equal(r[1].test_sold, 15);
});

test('reorderFigures: one set of figures for the list and the one-product forecast', () => {
    const { reorderFigures } = require('../routes/predictions')._internals;
    const today = '2026-11-05';
    // 60 a month, 12 in stock, spread 1 a day, 7-day delivery
    const f = reorderFigures({ expected: 60, sigma: 1, stock: 12, reorderLevel: 5, lead: 7, today });
    assert.equal(f.daily, 2);
    assert.equal(f.daysLeft, 6);
    assert.equal(f.stockStatus, 'reorder_now');
    assert.equal(f.safety, Math.ceil(1.65 * Math.sqrt(7)), 'safety stock 1.65 × spread × √7 = 5');
    assert.equal(f.reorderPoint, 14 + 5, '7 days of sales plus the safety stock');
    assert.equal(f.suggested, 60 + 14 + 5 - 12);
    assert.equal(f.orderBy, today);
    // what a supplier is already bringing comes off the order
    assert.equal(reorderFigures({ expected: 60, sigma: 1, stock: 12, reorderLevel: 5, lead: 7, coming: 20, today }).suggested, 67 - 20);
    // the list gives the same answer for the same product
    const row = planStock([product(1, 12, 5, { supplier_id: 3 })], [forecast(1, 60, { sigma: 1 })], new Map(),
        { today, leadTimes: new Map([[3, 7]]) })[0];
    assert.deepEqual([row.stock_status, row.safety_stock, row.recommended_reorder_point, row.suggested_order, row.order_by],
        [f.stockStatus, f.safety, f.reorderPoint, f.suggested, f.orderBy]);
});
