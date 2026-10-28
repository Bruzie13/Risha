const test = require('node:test');
const assert = require('node:assert');
const { tooLong, firstTooLong } = require('../utils/lengths');

test('typed values have a sensible length, with the limit in the reason', () => {
    assert.equal(tooLong('full_name', 'Juan Dela Cruz'), null);
    assert.equal(tooLong('full_name', 'x'.repeat(100)), null);
    assert.equal(tooLong('full_name', 'x'.repeat(101)), 'Full name is too long (100 characters at most).');
    assert.equal(tooLong('username', 'u'.repeat(31)), 'Username is too long (30 characters at most).');
    assert.equal(tooLong('customer_phone', '0'.repeat(21)), 'Customer phone is too long (20 characters at most).');
    assert.equal(tooLong('stock_notes', null), null, 'nothing typed is fine');
    assert.equal(tooLong('customer_name', '  Ana  '), null, 'outer spaces do not count');
});

test('several values: the first one too long is named', () => {
    assert.equal(firstTooLong({ full_name: 'Ana', username: 'ana' }), null);
    assert.match(firstTooLong({ full_name: 'Ana', username: 'a'.repeat(40), email: 'x'.repeat(300) }), /^Username/);
    assert.equal(firstTooLong({ full_name: undefined, email: undefined }), null, 'an edit that leaves them out');
});
