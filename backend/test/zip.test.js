const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { zipSingleFile, crc32 } = require('../utils/zip');

test('crc32 matches the reference value for "123456789"', () => {
    // The canonical CRC-32 check value, so a broken table is caught immediately.
    assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('zipSingleFile produces an archive with the ZIP magic number', () => {
    const zip = zipSingleFile('a.json', Buffer.from('{"x":1}'));
    assert.equal(zip[0], 0x50);   // P
    assert.equal(zip[1], 0x4B);   // K
    assert.equal(zip[2], 0x03);
    assert.equal(zip[3], 0x04);
});

test('the stored entry round-trips back to the original bytes', () => {
    const original = Buffer.from(JSON.stringify({ rows: Array.from({ length: 500 }, (_, i) => ({ i })) }));
    const zip = zipSingleFile('backup.json', original);

    // Walk the archive the way a reader would, rather than trusting our own offsets.
    const nameLen = zip.readUInt16LE(26);
    const extraLen = zip.readUInt16LE(28);
    const compressedSize = zip.readUInt32LE(18);
    const uncompressedSize = zip.readUInt32LE(22);
    const start = 30 + nameLen + extraLen;

    assert.equal(zip.subarray(30, 30 + nameLen).toString(), 'backup.json');
    assert.equal(uncompressedSize, original.length);
    assert.equal(zip.readUInt32LE(14), crc32(original), 'stored CRC must match the payload');

    const body = zip.subarray(start, start + compressedSize);
    assert.deepEqual(zlib.inflateRawSync(body), original);
});

test('a backup-sized payload actually compresses', () => {
    const repetitive = Buffer.from(JSON.stringify(
        Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'PEDIGREE ADULT', qty: 1 }))));
    const zip = zipSingleFile('backup.json', repetitive);
    assert.ok(zip.length < repetitive.length / 4,
        `expected real compression, got ${zip.length} from ${repetitive.length}`);
});

test('the daily backup is a .zip, because Brevo rejects .gz', () => {
    // Brevo answers "Unsupported file format: gz" and the email silently fails,
    // so the attachment name must not drift back to a gzip.
    const mailer = require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'mailer.js'), 'utf8');
    const fn = mailer.match(/const filename = [^\n]+/)[0];
    assert.ok(fn.includes(".zip'"), `attachment must be a .zip, got: ${fn}`);
    assert.ok(!/\.json\.gz/.test(fn));
});
