const test = require('node:test');
const assert = require('node:assert');

const { newSaleRef, saleRef, stockRequestKey, MAX_STOCK_KEY } = require('../utils/requestKeys');

test('a sale reference is 13 capitals and digits, and passes its own check', () => {
    for (let i = 0; i < 200; i++) {
        const ref = newSaleRef();
        assert.match(ref, /^[0-9A-Z]{13}$/);
        assert.equal(saleRef(ref), ref);
    }
    assert.equal(newSaleRef(0, () => 0), '0000000000000', 'the smallest values still give 13 characters');
    assert.equal(newSaleRef(Date.UTC(2026, 9, 11), () => 0.999999).length, 13);
});

test('two carts started in the same instant get different references', () => {
    const now = Date.now();
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(newSaleRef(now));
    assert.ok(seen.size > 495, 'the random part separates them');
});

test('a sale reference from the page is taken, tidied or refused', () => {
    assert.equal(saleRef(undefined), null, 'none sent');
    assert.equal(saleRef(null), null);
    assert.equal(saleRef(''), null);
    assert.equal(saleRef('mg3k2x9qab12c'), 'MG3K2X9QAB12C', 'small letters are accepted');
    assert.equal(saleRef('MG3K2X9QAB12'), false, 'too short');
    assert.equal(saleRef('MG3K2X9QAB12CD'), false, 'too long');
    assert.equal(saleRef("MG3K2' OR '1'='"), false, 'nothing but letters and digits');
    assert.equal(saleRef('<b>TEST_xss</b>'), false);
    assert.equal(saleRef({ a: 1 }), false);
});

test('a stock request number is a whole number the column can hold', () => {
    assert.equal(stockRequestKey(undefined), null, 'none sent');
    assert.equal(stockRequestKey(''), null);
    assert.equal(stockRequestKey(1), 1);
    assert.equal(stockRequestKey('123456'), 123456, 'arrives as text from some callers');
    assert.equal(stockRequestKey(MAX_STOCK_KEY), MAX_STOCK_KEY);
    assert.equal(stockRequestKey(MAX_STOCK_KEY + 1), false);
    assert.equal(stockRequestKey(0), false);
    assert.equal(stockRequestKey(-5), false);
    assert.equal(stockRequestKey(1.5), false);
    assert.equal(stockRequestKey('abc'), false);
});
