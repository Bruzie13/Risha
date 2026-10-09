const test = require('node:test');
const assert = require('node:assert');

const { maxDiscountFrom, checkDiscount, drawerExpected, discrepancy, voidRequestProblem, DEFAULT_MAX_DISCOUNT } = require('../utils/till');

test('discount limit: falls back to the default until an admin sets one', () => {
    assert.equal(maxDiscountFrom(null), DEFAULT_MAX_DISCOUNT);
    assert.equal(maxDiscountFrom('not a number'), DEFAULT_MAX_DISCOUNT);
    assert.equal(maxDiscountFrom('15'), 15);
    assert.equal(maxDiscountFrom('0'), 0, 'zero means no discounts, not "unset"');
    assert.equal(maxDiscountFrom('250'), 100);
    assert.equal(maxDiscountFrom('-5'), 0);
});

test('discount: within the limit is applied, over it is refused rather than lowered', () => {
    assert.deepEqual(checkDiscount(5, 10), { percent: 5 });
    assert.deepEqual(checkDiscount(10, 10), { percent: 10 });
    assert.ok(checkDiscount(10.01, 10).error);
    assert.ok(checkDiscount(100, 10).error);
    assert.ok(checkDiscount(1, 0).error, 'a limit of zero allows no discount at all');
});

test('discount: nothing, nonsense and negatives all mean no discount', () => {
    for (const v of [undefined, null, '', 'abc', 0, -20, NaN]) {
        assert.deepEqual(checkDiscount(v, 10), { percent: 0 });
    }
});

test('drawer: expected is the starting cash plus the cash taken', () => {
    assert.equal(drawerExpected(1000, 1340), 2340);
    assert.equal(drawerExpected(0, 1340), 1340);
    assert.equal(drawerExpected('500.50', '99.50'), 600);
    assert.equal(drawerExpected(0.1, 0.2), 0.3, 'no floating-point crumbs');
});

test('drawer: over is positive, short is negative, to the centavo', () => {
    assert.equal(discrepancy(2340, 2340), 0);
    assert.equal(discrepancy(2350, 2340), 10);
    assert.equal(discrepancy(2300.25, 2340), -39.75);
});

const sale = extra => ({ id: 7, created_by: 2, payment_status: 'completed', void_requested_at: null, ...extra });

test('void request: allowed for your own standing sale from today', () => {
    assert.equal(voidRequestProblem(sale(), 2, '2026-10-09', '2026-10-09'), null);
});

test('void request: someone else\'s sale reads the same as a missing one', () => {
    assert.equal(voidRequestProblem(sale({ created_by: 3 }), 2, '2026-10-09', '2026-10-09'), 'Sale not found');
    assert.equal(voidRequestProblem(undefined, 2, undefined, '2026-10-09'), 'Sale not found');
});

test('void request: not for a voided sale, an old sale, or twice', () => {
    assert.match(voidRequestProblem(sale({ payment_status: 'voided' }), 2, '2026-10-09', '2026-10-09'), /already been voided/);
    assert.match(voidRequestProblem(sale(), 2, '2026-10-08', '2026-10-09'), /Only today/);
    assert.match(voidRequestProblem(sale({ void_requested_at: new Date() }), 2, '2026-10-09', '2026-10-09'), /already been requested/);
});
