const test = require('node:test');
const assert = require('node:assert');

const { supplierProblem, fieldProblem, nameKey } = require('../utils/supplier');

const good = { name: 'Roger Enteria', contact_person: 'Roger', email: 'roger@example.com', phone: '0917 123 4567' };

test('supplier: a complete one is accepted', () => {
    assert.equal(supplierProblem(good, true), null);
    assert.equal(supplierProblem({ ...good, phone: '+63 (2) 8123-4567' }, true), null);
});

test('supplier: a new one needs name, contact person, email and phone', () => {
    assert.equal(supplierProblem({ name: 'Only a name' }, true), 'Enter the contact person.');
    assert.equal(supplierProblem({ ...good, email: null }, true), 'Enter the email address.');
    assert.equal(supplierProblem({ ...good, phone: '' }, true), 'Enter the phone number.');
    assert.equal(supplierProblem({ ...good, phone: '' }, false), 'Enter the phone number.', 'an edit cannot empty it');
});

test('supplier: the name has to be there and not just spaces', () => {
    assert.equal(supplierProblem({}, true), 'Enter the supplier name.');
    assert.equal(supplierProblem({ ...good, name: '   ' }, true), 'Enter the supplier name.');
    assert.equal(supplierProblem({ name: '' }, false), 'Enter the supplier name.', 'an edit cannot blank it');
    assert.equal(supplierProblem({ phone: '09171234567' }, false), null, 'an edit that does not touch the name is fine');
});

test('supplier: an email or phone that is given has to be one', () => {
    assert.match(supplierProblem({ ...good, email: 'abc' }, true), /email address in full/);
    assert.match(supplierProblem({ ...good, email: 'a@b' }, true), /email address in full/);
    assert.match(supplierProblem({ ...good, phone: 'abc' }, true), /digits, spaces and \+ \( \) - only/);
    assert.match(supplierProblem({ ...good, phone: '12345' }, true), /at least 7 digits/);
    assert.match(supplierProblem({ ...good, phone: '0917-CALL-NOW' }, true), /digits, spaces/);
    assert.match(supplierProblem({ ...good, phone: '0917 123 4567 8901 2' }, true), /too many digits/);
});

test('supplier: nothing longer than its column', () => {
    assert.match(supplierProblem({ ...good, name: 'x'.repeat(101) }, true), /Supplier name is too long \(100 characters at most\)/);
    assert.match(supplierProblem({ ...good, phone: '0'.repeat(21) }, true), /Phone number is too long/);
    assert.equal(supplierProblem({ ...good, name: 'x'.repeat(100) }, true), null);
    assert.match(supplierProblem({ ...good, address: 'x'.repeat(256) }, true), /Address is too long/);
});

test('supplier: names are compared without regard to capitals or spacing', () => {
    assert.equal(nameKey('  Roger   Enteria '), nameKey('roger enteria'));
    assert.notEqual(nameKey('Roger Enteria'), nameKey('Roger Enteria Jr'));
    assert.equal(nameKey(null), '');
});

test('supplier: the name, contact person and city say what they may hold', () => {
    assert.equal(fieldProblem('name', 'Señor Pet & Co. (PH)'), null);
    assert.equal(fieldProblem('name', 'Supplier 1'), null, 'numbers next to letters are fine');
    assert.match(fieldProblem('name', 'P'), /too short/);
    assert.match(fieldProblem('name', '098'), /at least one letter/);
    assert.match(fieldProblem('name', 'Pets!!! <b>'), /letters, numbers, spaces and/);
    assert.equal(fieldProblem('contact_person', "Ma. Ana O'Neil-Cruz"), null);
    assert.match(fieldProblem('contact_person', 'Juan 2'), /no numbers/);
    assert.match(fieldProblem('contact_person', 'J'), /too short/);
    assert.equal(fieldProblem('city', 'Caloocan City'), null);
    assert.match(fieldProblem('city', 'Zone 3'), /no numbers/);
    assert.equal(fieldProblem('city', ''), null, 'the city is optional');
});

test('supplier: a value saved before the rules may stay when it is not changed', () => {
    const old = { name: '098', contact_person: '098', email: 'x@example.com', phone: '0000000000', city: 'oienoien' };
    assert.equal(supplierProblem({ ...old }, false, old), null);
    assert.match(supplierProblem({ ...old, name: '099' }, false, old), /at least one letter/, 'a changed one is judged');
    assert.equal(supplierProblem({ ...old, name: '' }, false, old), 'Enter the supplier name.', 'but it cannot be emptied');
});

test('supplier phone: a real number for its country, kept one way', () => {
    const { phoneForStorage } = require('../utils/supplier');
    for (const fake of ['0000000000', '1234567', '+6300000000', '0917 000 000']) {
        assert.match(supplierProblem({ ...good, phone: fake }, true), /Enter a real phone number/, fake);
    }
    for (const real of ['09171234567', '0917 123 4567', '+63 917 123 4567', '(02) 8123 4567', '+1 212 555 0123']) {
        assert.equal(supplierProblem({ ...good, phone: real }, true), null, real);
    }
    assert.equal(phoneForStorage('0917 123 4567'), '+639171234567');
    assert.equal(phoneForStorage('+1 (212) 555-0123'), '+12125550123');
    assert.equal(phoneForStorage('0000000000'), null);
    assert.equal(supplierProblem({ phone: '0000000000' }, false, { phone: '0000000000' }), null, 'an older number may stay as it is');
});
