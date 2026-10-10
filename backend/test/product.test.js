const test = require('node:test');
const assert = require('node:assert');

const { productProblem } = require('../utils/product');

const suppliers = new Set([6, 7]);
const good = { sku: 'DRY-100', name: 'Dog food 1kg', category_id: 1, unit_price: 120, supplier_id: 6 };

test('adding a product: with everything important filled in, it is accepted', () => {
    assert.equal(productProblem(good, true, suppliers), null);
    assert.equal(productProblem({ ...good, unit_price: '120.50', supplier_id: '7', category_id: '2' }, true, suppliers), null, 'values arrive as text from a form');
    assert.equal(productProblem({ ...good, cost_price: 0, stock_quantity: 0, reorder_level: 0, max_stock_level: null }, true, suppliers), null);
});

test('adding a product: what is missing is named', () => {
    assert.match(productProblem({}, true, suppliers), /SKU, Product name, Category, Unit price, Supplier/);
    assert.match(productProblem({ ...good, supplier_id: null }, true, suppliers), /Fill in this first: Supplier\./);
    assert.match(productProblem({ ...good, name: '   ' }, true, suppliers), /Product name/, 'spaces are not a name');
    assert.match(productProblem({ ...good, supplier_id: '' }, true, suppliers), /Supplier/);
});

test('adding a product: the supplier has to be one still on the list', () => {
    assert.match(productProblem({ ...good, supplier_id: 2 }, true, suppliers), /Choose a supplier from the list/, 'a deleted supplier');
    assert.match(productProblem({ ...good, supplier_id: 6 }, true, new Set()), /Choose a supplier from the list/, 'no suppliers at all');
    assert.match(productProblem({ ...good, supplier_id: 6 }, true, null), /Choose a supplier from the list/);
});

test('adding a product: numbers have to make sense', () => {
    assert.match(productProblem({ ...good, unit_price: 0 }, true, suppliers), /more than zero/);
    assert.match(productProblem({ ...good, unit_price: -5 }, true, suppliers), /more than zero/);
    assert.match(productProblem({ ...good, unit_price: 'abc' }, true, suppliers), /more than zero/);
    assert.match(productProblem({ ...good, stock_quantity: -1 }, true, suppliers), /Stock quantity cannot be less than zero/);
    assert.match(productProblem({ ...good, cost_price: -1 }, true, suppliers), /Cost price cannot be less than zero/);
    assert.match(productProblem({ ...good, category_id: 'food' }, true, suppliers), /Choose a category/);
});

test('editing a product: only what the edit carries is checked', () => {
    assert.equal(productProblem({ barcode: '4800000000001' }, false, suppliers), null, 'the barcode tool sends one field');
    assert.equal(productProblem({ image_url: 'images/products/x.jpg' }, false, suppliers), null, 'so does the picture tool');
    assert.match(productProblem({ ...good, supplier_id: null }, false, suppliers), /Supplier/, 'the edit form cannot clear the supplier');
    assert.match(productProblem({ name: '' }, false, suppliers), /Product name/);
    assert.match(productProblem({ unit_price: 0 }, false, suppliers), /more than zero/);
    assert.equal(productProblem({ ...good, unit_price: 130 }, false, suppliers), null);
});

const { stockChangeProblem } = require('../utils/product');

test('stock change: the kind has to be one of the four, and only "in" adds', () => {
    for (const kind of ['in', 'out', 'adjustment', 'damage']) assert.equal(stockChangeProblem(5, kind), null);
    assert.match(stockChangeProblem(5, 'nonsense'), /what kind of change/);
    assert.match(stockChangeProblem(5, undefined), /what kind of change/, 'no kind is not quietly taken as a removal');
});

test('stock change: the quantity is a number above zero that the column can hold', () => {
    assert.equal(stockChangeProblem(0.25, 'in'), null, 'part of a kilo is fine');
    assert.equal(stockChangeProblem('12', 'in'), null, 'a number sent as text');
    assert.match(stockChangeProblem(0, 'in'), /above zero/);
    assert.match(stockChangeProblem(-5, 'in'), /above zero/);
    assert.match(stockChangeProblem('abc', 'in'), /above zero/);
    assert.match(stockChangeProblem('5abc', 'in'), /above zero/);
    assert.match(stockChangeProblem(Infinity, 'in'), /above zero/);
    assert.match(stockChangeProblem(undefined, 'in'), /Enter the quantity/);
    assert.match(stockChangeProblem('', 'out'), /Enter the quantity/);
    assert.match(stockChangeProblem(1e12, 'in'), /larger than the system can hold/);
});
