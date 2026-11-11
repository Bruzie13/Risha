const test = require('node:test');
const assert = require('node:assert');
const { planVoid } = require('../utils/saleVoid');

const items = [
    { id: 1, product_id: 10, product_name: 'AOZI CAT CAN', quantity: 2, unit_price: 70 },
    { id: 2, product_id: 11, product_name: 'WHISKAS KITTEN', quantity: 1, unit_price: 150 }
];

test('voiding one of two products leaves the other, and lowers the sale', () => {
    const p = planVoid(items, [{ id: 2, quantity: 1 }]);
    assert.equal(p.whole, false);
    assert.deepEqual(p.lines.map(l => [l.product_name, l.quantity, l.left, l.amount]), [['WHISKAS KITTEN', 1, 0, 150]]);
    assert.equal(p.removed, 150);
    assert.equal(p.total, 140);
    assert.equal(p.final, 140);
});

test('part of one line, with the sale\'s discount', () => {
    const p = planVoid(items, [{ id: 1, quantity: '1' }, { id: 2, quantity: 0 }], 10);
    assert.equal(p.lines[0].left, 1);
    assert.equal(p.total, 220, '70 + 150 left');
    assert.equal(p.final, 198, '10% off 220');
});

test('every item chosen is the whole sale', () => {
    assert.equal(planVoid(items, [{ id: 1, quantity: 2 }, { id: 2, quantity: 1 }]).whole, true);
});

test('what cannot be voided is refused with the reason', () => {
    assert.match(planVoid(items, [{ id: 1, quantity: 3 }]).error, /Only 2 of AOZI CAT CAN were sold/);
    assert.match(planVoid(items, [{ id: 1, quantity: 0 }, { id: 2, quantity: 0 }]).error, /at least one/);
    assert.match(planVoid(items, [{ id: 1, quantity: 1.5 }]).error, /whole number/);
    assert.match(planVoid(items, [{ id: 1, quantity: -1 }]).error, /whole number/);
    assert.match(planVoid(items, [{ id: 9, quantity: 1 }]).error, /not on this sale/);
    assert.match(planVoid(items, []).error, /Choose how many/);
    assert.match(planVoid([], [{ id: 1, quantity: 1 }]).error, /no items/);
});
