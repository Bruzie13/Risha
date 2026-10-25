const test = require('node:test');
const assert = require('node:assert');

const { asDay, earliestExpiry, expiryProblem } = require('../utils/expiry');

const TODAY = '2026-10-10';

test('expiration date: a week or more ahead is accepted, and no date at all is fine', () => {
    assert.equal(earliestExpiry(TODAY), '2026-10-17');
    assert.equal(earliestExpiry('2026-12-28'), '2027-01-04', 'across the new year');
    assert.equal(expiryProblem('2026-10-17', TODAY), null, 'exactly 7 days ahead');
    assert.equal(expiryProblem('2027-01-01', TODAY), null);
    assert.equal(expiryProblem('', TODAY), null);
    assert.equal(expiryProblem(null, TODAY), null);
    assert.equal(expiryProblem(undefined, TODAY), null);
});

test('expiration date: a day that has already passed is refused', () => {
    assert.equal(expiryProblem('2026-10-10', TODAY), 'The expiration date must be at least 7 days from today: Oct 17, 2026 or later.', 'today');
    assert.match(expiryProblem('2026-10-16', TODAY), /at least 7 days/, '6 days ahead');
    assert.match(expiryProblem('2026-10-09', TODAY), /at least 7 days/, 'yesterday');
    assert.match(expiryProblem('2025-06-01', TODAY), /at least 7 days/, 'the 2025 date that was accepted before');
});

test('expiration date: not a real date is refused', () => {
    assert.match(expiryProblem('soon', TODAY), /real date/);
    assert.match(expiryProblem('2026-02-31', TODAY), /real date/);
    assert.match(expiryProblem('10/10/2027', TODAY), /real date/);
});

test('expiration date: an expired product can still be edited if its date is left alone', () => {
    assert.equal(expiryProblem('2026-08-27', TODAY, '2026-08-27'), null, 'unchanged');
    assert.equal(expiryProblem('2026-08-27', TODAY, new Date(2026, 7, 27)), null, 'unchanged, read from the database as a Date');
    assert.match(expiryProblem('2026-08-26', TODAY, '2026-08-27'), /at least 7 days/, 'changed to another past date');
    assert.equal(expiryProblem('2027-08-27', TODAY, '2026-08-27'), null, 'changed to a future date');
});

test('asDay: text and Date both come out as the same calendar day', () => {
    assert.equal(asDay('2026-10-10'), '2026-10-10');
    assert.equal(asDay('2026-10-10T16:00:00.000Z'), '2026-10-10');
    assert.equal(asDay(new Date(2026, 9, 10)), '2026-10-10', 'a DATE column read at local midnight');
    assert.equal(asDay(null), '');
});
