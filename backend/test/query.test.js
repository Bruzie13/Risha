const { test } = require('node:test');
const assert = require('node:assert');
const { LIKE_ESCAPE, containsPattern, realDay, dayRange } = require('../utils/query');

test('containsPattern: ordinary text is looked for anywhere in the column', () => {
    assert.equal(containsPattern('dog'), '%dog%');
    assert.equal(containsPattern('TEST-A01'), '%TEST-A01%');
});

test('containsPattern: % and _ are looked for as themselves, not as "anything"', () => {
    assert.equal(containsPattern('%'), '%!%%');
    assert.equal(containsPattern('_'), '%!_%');
    assert.equal(containsPattern('50%_off'), '%50!%!_off%');
    // the mark that does the escaping has to be escaped too
    assert.equal(containsPattern('wow!'), '%wow!!%');
    assert.equal(LIKE_ESCAPE, "ESCAPE '!'");
});

test('containsPattern: a backslash or a quote is left as typed (the value is a bound parameter)', () => {
    assert.equal(containsPattern('a\\b'), '%a\\b%');
    assert.equal(containsPattern("o'neil"), "%o'neil%");
});

test('realDay: only a day that exists', () => {
    assert.equal(realDay('2026-10-11'), '2026-10-11');
    assert.equal(realDay('2024-02-29'), '2024-02-29', 'a leap day');
    assert.equal(realDay('2026-02-29'), null, 'not a leap year');
    assert.equal(realDay('2026-02-30'), null);
    assert.equal(realDay('2026-13-45'), null);
    assert.equal(realDay('2026-00-10'), null);
    assert.equal(realDay('0000-01-01'), null);
    assert.equal(realDay('11/10/2026'), null);
    assert.equal(realDay('2026-10-11T00:00:00Z'), null);
    assert.equal(realDay("2026-10-11' OR 1=1"), null);
    assert.equal(realDay(''), null);
    assert.equal(realDay(undefined), null);
    assert.equal(realDay(20261011), null);
    assert.equal(realDay(['2026-10-11']), null, 'a repeated address field arrives as a list');
});

test('dayRange: nothing given is no range, and is not a problem', () => {
    assert.deepEqual(dayRange(undefined, undefined), { from: null, to: null });
    assert.deepEqual(dayRange('', '  '), { from: null, to: null });
    assert.deepEqual(dayRange(undefined, undefined, { needBoth: true }), { from: null, to: null });
});

test('dayRange: a good range, and one end alone', () => {
    assert.deepEqual(dayRange('2026-09-01', '2026-10-01'), { from: '2026-09-01', to: '2026-10-01' });
    assert.deepEqual(dayRange('2026-10-01', '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' }, 'one day');
    assert.deepEqual(dayRange('2026-09-01', undefined), { from: '2026-09-01', to: null });
    assert.deepEqual(dayRange(undefined, '2026-10-01'), { from: null, to: '2026-10-01' });
});

test('dayRange: a date that cannot be read is refused, not ignored', () => {
    assert.match(dayRange('abc', '2026-10-01').problem, /^The start date is not a real date/);
    assert.match(dayRange('2026-09-01', '2026-99-99').problem, /^The end date is not a real date/);
    assert.match(dayRange('2026-02-30', '2026-03-01').problem, /^The start date is not a real date/);
    assert.match(dayRange(['2026-09-01', '2026-09-02'], '2026-10-01').problem, /^The start date/);
    // what was typed is not repeated back
    assert.ok(!dayRange('<script>', '2026-10-01').problem.includes('<'));
});

test('dayRange: the wrong way round is refused', () => {
    assert.deepEqual(dayRange('2026-10-01', '2026-09-01'), { problem: 'The start date is after the end date.' });
});

test('dayRange: a report needs both ends', () => {
    assert.deepEqual(dayRange('2026-10-01', undefined, { needBoth: true }), { problem: 'Choose both a start and an end date.' });
    assert.deepEqual(dayRange(undefined, '2026-10-01', { needBoth: true }), { problem: 'Choose both a start and an end date.' });
    assert.deepEqual(dayRange('2026-09-01', '2026-10-01', { needBoth: true }), { from: '2026-09-01', to: '2026-10-01' });
});
