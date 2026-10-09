const test = require('node:test');
const assert = require('node:assert');

const { maxDiscountFrom, checkDiscount, drawerExpected, discrepancy, voidRequestProblem, cashMoveProblem, DEFAULT_MAX_DISCOUNT } = require('../utils/till');

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

test('drawer: cash put in is added and cash taken out is subtracted', () => {
    assert.equal(drawerExpected(2000, 3000, 0, 3000), 2000, 'the owner collected the takings; the float is what is left');
    assert.equal(drawerExpected(5000, 0, 5000, 0), 10000, 'no sales, but 5,000 was added for change');
    assert.equal(drawerExpected(1000, 500.5, 200, 100.25), 1600.25);
    assert.equal(drawerExpected(1000, 500), 1500, 'with nothing moved it is unchanged');
});

test('cash in or out: needs a kind, a real amount and a reason', () => {
    assert.ok(cashMoveProblem('sideways', 100, 'owner', 5000));
    assert.ok(cashMoveProblem('out', 0, 'owner collected', 5000));
    assert.ok(cashMoveProblem('out', -50, 'owner collected', 5000));
    assert.ok(cashMoveProblem('out', 'abc', 'owner collected', 5000));
    assert.ok(cashMoveProblem('in', 2000000, 'change fund', 5000));
    assert.ok(cashMoveProblem('out', 100, '', 5000), 'no reason');
    assert.ok(cashMoveProblem('in', 100, '  x ', 5000), 'a one-letter reason is not a reason');
    assert.equal(cashMoveProblem('out', 100, 'Owner collected', 5000), null);
    assert.equal(cashMoveProblem('in', 100, 'Coins for change', 0), null);
});

test('cash out: cannot take out more than the drawer should hold; putting in has no such limit', () => {
    assert.equal(cashMoveProblem('out', 5000, 'Owner collected', 5000), null, 'all of it is allowed');
    assert.ok(cashMoveProblem('out', 5000.01, 'Owner collected', 5000));
    assert.ok(cashMoveProblem('out', 1, 'Owner collected', 0), 'an empty drawer has nothing to take');
    assert.equal(cashMoveProblem('in', 99999, 'Owner added cash', 0), null);
});
