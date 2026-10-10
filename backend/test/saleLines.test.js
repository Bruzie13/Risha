const test = require('node:test');
const assert = require('node:assert');

const { lineProblem, mergeLines } = require('../utils/saleLines');

test('sale lines: a product and a quantity above zero', () => {
    assert.equal(lineProblem({ product_id: 3, quantity: 2 }), null);
    assert.equal(lineProblem({ product_id: '3', quantity: '0.5' }), null, 'numbers may arrive as text');
    assert.match(lineProblem({ product_id: 3, quantity: 0 }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: -1 }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: 'abc' }), /quantity above zero/, 'letters are not a quantity');
    assert.match(lineProblem({ product_id: 3, quantity: '' }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: Infinity }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3 }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 'abc', quantity: 1 }), /valid product/);
    assert.match(lineProblem({ quantity: 1 }), /valid product/);
    assert.match(lineProblem(null), /product and a quantity/);
});

test('sale lines: a list or a true/false is not a number', () => {
    // Number([3]) is 3 and Number(true) is 1, so these used to be sold
    assert.match(lineProblem({ product_id: 3, quantity: [3] }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: ['3'] }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: true }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: {} }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: null }), /quantity above zero/);
    assert.match(lineProblem({ product_id: 3, quantity: '   ' }), /quantity above zero/);
    assert.match(lineProblem({ product_id: [3], quantity: 1 }), /valid product/);
    assert.match(lineProblem({ product_id: true, quantity: 1 }), /valid product/);
    assert.match(lineProblem([{ product_id: 3, quantity: 1 }]), /product and a quantity/, 'a list in place of a line');
    assert.match(lineProblem('3x1'), /product and a quantity/);
});

test('sale lines: the same product on two lines is one line', () => {
    const merged = mergeLines([{ product_id: 2, quantity: 16 }, { product_id: 5, quantity: 1 }, { product_id: '2', quantity: 16 }]);
    assert.deepEqual(merged.map(l => [l.product_id, l.quantity]), [[2, 32], [5, 1]]);
});

test('sale lines: quantities by weight add up without rounding noise', () => {
    const merged = mergeLines([{ product_id: 8, quantity: 0.1 }, { product_id: 8, quantity: 0.2 }]);
    assert.equal(merged[0].quantity, 0.3);
});

test('sale lines: lines for different products are left as they are', () => {
    const items = [{ product_id: 1, quantity: 2, unit_price: 10 }, { product_id: 2, quantity: 1, unit_price: 5 }];
    assert.deepEqual(mergeLines(items), items);
});
