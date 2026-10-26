const test = require('node:test');
const assert = require('node:assert');

const { NOTES_PER_MINUTE, noteProblem } = require('../utils/notes');

test('note: a new note is accepted', () => {
    assert.equal(noteProblem('Can you deliver on Friday?', []), null);
    assert.equal(noteProblem('Can you deliver on Friday?', [{ body: 'Thanks' }]), null);
});

test('note: the same note again within a minute is refused', () => {
    assert.equal(noteProblem('Thanks', [{ body: 'Thanks' }]), 'That note was just sent.');
    assert.equal(noteProblem('  Thanks ', [{ body: 'Thanks' }]), 'That note was just sent.', 'spaces around it do not make it new');
});

test('note: more than the limit in a minute is refused', () => {
    const recent = Array.from({ length: NOTES_PER_MINUTE }, (_, i) => ({ body: 'note ' + i }));
    assert.match(noteProblem('one more', recent), /5 notes in a minute/);
    assert.equal(noteProblem('one more', recent.slice(1)), null, 'one under the limit is fine');
});
