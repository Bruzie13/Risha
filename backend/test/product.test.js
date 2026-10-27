const test = require('node:test');
const assert = require('node:assert');

const { barcodeProblem, productProblem, gs1CheckDigit } = require('../utils/product');

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
    assert.equal(productProblem({ barcode: '4800000000002' }, false, suppliers), null, 'the barcode tool sends one field');
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

test('a list is not a value: stock change and product fields', () => {
    // Number([5]) is 5, so a list of one used to pass as a number
    assert.match(stockChangeProblem([5], 'in'), /above zero/);
    assert.match(stockChangeProblem({ n: 5 }, 'out'), /above zero/);
    assert.match(productProblem({ ...good, unit_price: [120] }, true, suppliers), /Unit price has to be a single value/);
    assert.match(productProblem({ ...good, name: ['Dog food'] }, true, suppliers), /Product name has to be a single value/);
    assert.match(productProblem({ ...good, supplier_id: [6] }, true, suppliers), /Supplier has to be a single value/);
    assert.match(productProblem({ stock_quantity: { $gt: 0 } }, false, suppliers), /Stock quantity has to be a single value/);
    assert.match(productProblem({ unit_type: ['kg'] }, false, suppliers), /Unit has to be a single value/);
    // a field this check does not know about is not its business
    assert.equal(productProblem({ barcode: '48000017', allow_same_name: true }, false, suppliers), null);
    assert.equal(productProblem({ ...good, max_stock_level: null }, true, suppliers), null, 'null still means "not set"');
});

test('adding a product: nothing larger or longer than its column can hold', () => {
    assert.match(productProblem({ ...good, unit_price: 1e12 }, true, suppliers), /Unit price is too large \(99,999,999\.99 at most\)/);
    assert.match(productProblem({ ...good, stock_quantity: 99999999999 }, true, suppliers), /Stock quantity is too large/);
    assert.match(productProblem({ ...good, reorder_level: 5000000 }, true, suppliers), /Reorder level is too large/);
    assert.match(productProblem({ ...good, name: 'T'.repeat(300) }, true, suppliers), /Product name is too long \(255 characters at most\)/);
    assert.match(productProblem({ ...good, sku: 'S'.repeat(51) }, true, suppliers), /SKU is too long/);
    assert.match(productProblem({ ...good, barcode: '9'.repeat(101) }, true, suppliers), /Barcode is too long/);
    assert.equal(productProblem({ ...good, unit_price: 99999999.99, stock_quantity: 9999999.999, name: 'T'.repeat(255) }, true, suppliers), null, 'the largest values that fit are accepted');
});

test('adding a product: levels are whole numbers and the unit is from the list', () => {
    assert.match(productProblem({ ...good, reorder_level: 2.5 }, true, suppliers), /Reorder level has to be a whole number/);
    assert.match(productProblem({ ...good, unit_type: 'box' }, true, suppliers), /unit from the list/);
    assert.equal(productProblem({ ...good, unit_type: 'kg', stock_quantity: 12.5, reorder_level: 5 }, true, suppliers), null);
    assert.equal(productProblem({ unit_type: 'box' }, false, suppliers) !== null, true, 'an edit is held to the same list');
});

test('prices, stock levels, SKU and barcode are judged against each other and their pattern', () => {
    const suppliers = new Set([1]);
    const good = { sku: 'DOG-01', name: 'Dog treats', category_id: 1, unit_price: 120, supplier_id: 1 };
    assert.equal(productProblem({ ...good, cost_price: 95, reorder_level: 10, max_stock_level: 100, barcode: '4800000000019' }, true, suppliers), null);
    assert.match(productProblem({ ...good, cost_price: 150 }, true, suppliers), /cost price \(₱150\.00\) is higher than the unit price \(₱120\.00\)/);
    assert.match(productProblem({ ...good, reorder_level: 10, max_stock_level: 10 }, true, suppliers), /max stock level has to be higher than the reorder level \(10\)/);
    assert.match(productProblem({ ...good, sku: 'DOG 01' }, true, suppliers), /SKU can use letters, numbers/);
    assert.equal(productProblem({ sku: 'OLD SKU 1', name: 'x2' }, false, suppliers), null, 'an older SKU is kept as it is on an edit');
    assert.match(productProblem({ ...good, barcode: '48 00' }, true, suppliers), /numbers only/);
    assert.equal(productProblem({ cost_price: 500 }, false, suppliers), null, 'an edit that sends only the cost is not judged against a price it did not send');
});

const { SKU_TYPES, SKU_PATTERN, skuTypeProblem, skuFor } = require('../utils/sku');

test('the SKU pattern: a product type and the shop running number', () => {
    assert.equal(skuFor('DRY', 121), 'DRY-121');
    assert.equal(skuFor('WET', 7), 'WET-007', 'the number has at least three digits');
    assert.equal(skuFor('SUP', 1250), 'SUP-1250');
    assert.ok(SKU_PATTERN.test('DRY-121') && SKU_PATTERN.test('CAT-117'), 'the SKUs already on record follow it');
    assert.ok(!SKU_PATTERN.test('WET - 005') && !SKU_PATTERN.test('220003'));
    assert.match(skuTypeProblem(''), /Choose the product type/);
    assert.match(skuTypeProblem('XYZ'), /from the list/);
    assert.equal(skuTypeProblem('GRO'), null);
    assert.equal(SKU_TYPES.length, 8);
});

test('barcode: 8, 12 or 13 digits; a barcode left as it is may stay', () => {
    assert.equal(barcodeProblem('', null), null, 'no barcode is fine');
    assert.equal(barcodeProblem('48000017'), null, 'EAN-8');
    assert.equal(barcodeProblem('202300001149'), null, 'UPC-A');
    assert.equal(barcodeProblem(' 4800361000017 '), null, 'EAN-13, spaces around it trimmed');
    assert.equal(barcodeProblem('1111'), 'A barcode is 8, 12 or 13 digits. This one has 4.');
    assert.match(barcodeProblem('48003610000171'), /This one has 14/);
    assert.match(barcodeProblem('BARCODE001'), /numbers only/);
    assert.match(barcodeProblem('4800-361'), /numbers only/);
    assert.equal(barcodeProblem('1111a', '1111a'), null, 'an older code left unchanged');
    assert.match(barcodeProblem('1112', '1111a'), /This one has 4/, 'changed: judged like a new one');
    assert.match(productProblem({ barcode: '1111' }, false, suppliers, { barcode: '9999' }), /This one has 4/);
    assert.equal(productProblem({ barcode: 'arstarst' }, false, suppliers, { barcode: 'arstarst' }), null);
});

test('barcode: the last digit is the GS1 check digit', () => {
    // worked example from the GS1 check digit sheet: 629104150021 -> 3
    assert.equal(gs1CheckDigit('629104150021'), 3);
    assert.equal(gs1CheckDigit('480652562134'), 0, 'a barcode on record');
    assert.equal(gs1CheckDigit('4800001'), 7, 'EAN-8');
    assert.equal(barcodeProblem('6291041500213'), null);
    assert.equal(barcodeProblem('4801234567897'), null);
    assert.equal(barcodeProblem('4801234567890'),
        'The last digit of a barcode is a check digit; for this one it should be 7, not 0. A digit was probably typed wrong: scan the barcode or type it again.');
    assert.match(barcodeProblem('4806525621304'), /should be/, 'two digits swapped');
    assert.match(barcodeProblem('250000000127'), /should be 2, not 7/, 'the old Generate codes have no real check digit');
    assert.equal(barcodeProblem('250000000003', '250000000003'), null, 'but one already saved may stay');
    assert.equal(barcodeProblem('2000000001272'), null, 'the new Generate code for product 127');
});

