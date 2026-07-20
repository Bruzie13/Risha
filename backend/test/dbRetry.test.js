const { test } = require('node:test');
const assert = require('node:assert');
const { isTransient, withRetry } = require('../utils/dbRetry');

test('isTransient flags dropped-connection error codes', () => {
    assert.equal(isTransient({ code: 'ETIMEDOUT' }), true);
    assert.equal(isTransient({ code: 'PROTOCOL_CONNECTION_LOST' }), true);
    assert.equal(isTransient({ fatal: true }), true);
});

test('isTransient ignores ordinary application errors', () => {
    assert.equal(isTransient({ code: 'ER_DUP_ENTRY' }), false);
    assert.equal(isTransient(new Error('bad SQL')), false);
    assert.equal(isTransient(null), false);
});

test('withRetry returns immediately on success (no retry)', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return 'ok'; }, 3, async () => {});
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
});

test('withRetry retries a transient failure then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
        calls++;
        if (calls < 2) throw { code: 'ETIMEDOUT' };
        return 'recovered';
    }, 3, async () => {}); // no-op sleep so the test is instant
    assert.equal(result, 'recovered');
    assert.equal(calls, 2);
});

test('withRetry does NOT retry a non-transient error', async () => {
    let calls = 0;
    await assert.rejects(
        () => withRetry(async () => { calls++; throw { code: 'ER_DUP_ENTRY' }; }, 3, async () => {}),
        e => e.code === 'ER_DUP_ENTRY'
    );
    assert.equal(calls, 1);
});

test('withRetry gives up after the attempt limit', async () => {
    let calls = 0;
    await assert.rejects(
        () => withRetry(async () => { calls++; throw { code: 'ECONNRESET' }; }, 3, async () => {}),
        e => e.code === 'ECONNRESET'
    );
    assert.equal(calls, 3);
});
