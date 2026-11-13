const test = require('node:test');
const assert = require('node:assert');
const { compareSuppliers } = require('../utils/supplierCompare');

const petco = { supplier_id: 10, name: 'PetCo', is_main: true, cost: 579, average_days: 3, on_time_percent: 100, delivered: 4, stars: 4, shelf_days: 360, last_expiry: '2027-11-01' };
const roger = { supplier_id: 6, name: 'Roger Enteria', is_main: false, cost: 560, average_days: 6.4, on_time_percent: 86, delivered: 36, stars: 3, shelf_days: 270, last_expiry: '2027-08-01' };

test('each row marks the better supplier, and the faster one with longer batches is picked', () => {
    const r = compareSuppliers([petco, roger]);
    assert.deepEqual(r.rows[0].best.sort(), ['average_days', 'on_time_percent', 'shelf_days', 'stars']);
    assert.deepEqual(r.rows[1].best, ['cost']);
    assert.equal(r.pick, 10);
    assert.equal(r.verdict, 'Order from PetCo: it delivers in about 3 days instead of 6.4 days, and its last batch lasted 3 months longer. Roger Enteria is ₱19.00 cheaper each.');
});

test('a figure only one supplier has, or a tie, is nobody\'s win', () => {
    const r = compareSuppliers([{ ...petco, average_days: null, shelf_days: null }, { ...roger, cost: 579 }]);
    assert.ok(!r.rows[0].best.includes('average_days'));
    assert.ok(!r.rows[0].best.includes('cost') && !r.rows[1].best.includes('cost'));
});

test('with no orders to compare, the main supplier is suggested and says why', () => {
    const blank = s => ({ ...s, average_days: null, on_time_percent: null, stars: null, shelf_days: null, cost: 500 });
    const r = compareSuppliers([blank(roger), blank(petco)]);
    assert.equal(r.pick, 10);
    assert.match(r.verdict, /Not enough received orders/);
});

test('one supplier needs no comparison', () => {
    const r = compareSuppliers([petco]);
    assert.equal(r.pick, 10);
    assert.equal(r.verdict, null);
});
