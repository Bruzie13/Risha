// Transient DB errors: a dropped/idle-killed connection surfaces as one of
// these. Retrying is safe for operations that haven't run yet (connection
// acquire) or are read-only.
const TRANSIENT = new Set([
    'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST',
    'ER_CON_COUNT_ERROR', 'PROTOCOL_SEQUENCE_TIMEOUT'
]);

const isTransient = err => !!err && (TRANSIENT.has(err.code) || err.fatal === true);

// Run fn, retrying on transient errors with a short linear backoff.
// `sleep` is injectable so tests don't actually wait.
async function withRetry(fn, attempts = 3, sleep = ms => new Promise(r => setTimeout(r, ms))) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!isTransient(err) || i === attempts - 1) throw err;
            await sleep(150 * (i + 1));
        }
    }
    throw lastErr;
}

module.exports = { isTransient, withRetry, TRANSIENT };
