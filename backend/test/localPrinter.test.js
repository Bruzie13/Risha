const test = require('node:test');
const assert = require('node:assert');
const { pickCupsPrinter } = require('../utils/localPrinter');

const TWO = 'printer HP_LaserJet is idle.  enabled since Mon\nprinter YICHIP_POS58_Printer is idle.  enabled since Mon';

test('the receipt printer is picked by its name, not the first queue', () => {
    assert.deepStrictEqual(pickCupsPrinter(TWO, ''), { available: true, printer: 'YICHIP_POS58_Printer', reason: null });
});

test('a named queue wins over the guess', () => {
    assert.strictEqual(pickCupsPrinter(TWO, 'HP_LaserJet').printer, 'HP_LaserJet');
});

test('an office printer alone is not used for receipts', () => {
    const r = pickCupsPrinter('printer HP_LaserJet is idle.  enabled since Mon', '');
    assert.strictEqual(r.available, false);
    assert.match(r.reason, /no receipt printer/);
});

test('a paused queue is reported, not printed to', () => {
    const r = pickCupsPrinter('printer POS58 disabled since Mon -', 'POS58');
    assert.strictEqual(r.available, false);
    assert.match(r.reason, /paused or switched off/);
});

test('no queues at all', () => {
    assert.strictEqual(pickCupsPrinter('', '').available, false);
});
