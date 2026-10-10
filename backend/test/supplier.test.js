const test = require('node:test');
const assert = require('node:assert');

const { supplierProblem, nameKey } = require('../utils/supplier');

const good = { name: 'Roger Enteria', contact_person: 'Roger', email: 'roger@example.com', phone: '0917 123 4567' };

test('supplier: a complete one is accepted', () => {
    assert.equal(supplierProblem(good, true), null);
    assert.equal(supplierProblem({ name: 'Only a name' }, true), null, 'email and phone are not required');
    assert.equal(supplierProblem({ ...good, phone: '+63 (2) 8123-4567' }, true), null);
    assert.equal(supplierProblem({ ...good, email: null, phone: '' }, true), null);
});

test('supplier: the name has to be there and not just spaces', () => {
    assert.match(supplierProblem({}, true), /name is required/);
    assert.match(supplierProblem({ ...good, name: '   ' }, true), /name is required/);
    assert.match(supplierProblem({ name: '' }, false), /name is required/, 'an edit cannot blank it');
    assert.equal(supplierProblem({ phone: '09171234567' }, false), null, 'an edit that does not touch the name is fine');
});

test('supplier: an email or phone that is given has to be one', () => {
    assert.match(supplierProblem({ ...good, email: 'abc' }, true), /email address in full/);
    assert.match(supplierProblem({ ...good, email: 'a@b' }, true), /email address in full/);
    assert.match(supplierProblem({ ...good, phone: 'abc' }, true), /phone number in digits/);
    assert.match(supplierProblem({ ...good, phone: '12345' }, true), /phone number in digits/, 'too few digits');
    assert.match(supplierProblem({ ...good, phone: '0917-CALL-NOW' }, true), /phone number in digits/);
});

test('supplier: nothing longer than its column', () => {
    assert.match(supplierProblem({ ...good, name: 'x'.repeat(256) }, true), /Supplier name is too long/);
    assert.match(supplierProblem({ ...good, phone: '0'.repeat(21) }, true), /Phone number is too long/);
    assert.equal(supplierProblem({ ...good, name: 'x'.repeat(255) }, true), null);
});

test('supplier: names are compared without regard to capitals or spacing', () => {
    assert.equal(nameKey('  Roger   Enteria '), nameKey('roger enteria'));
    assert.notEqual(nameKey('Roger Enteria'), nameKey('Roger Enteria Jr'));
    assert.equal(nameKey(null), '');
});
