const { test } = require('node:test');
const assert = require('node:assert');

// Importing the models pulls in config/database, which calls mysql.createPool.
// createPool is lazy (no socket until a query runs), and these _filterWhere /
// _scopeWhere builders are pure string/param functions — no DB is touched.
const Sale = require('../models/Sale');
const Notification = require('../models/Notification');

test('Sale._filterWhere: no filters → empty WHERE, no params', () => {
    const params = [];
    const where = Sale._filterWhere({}, params);
    assert.equal(where, '');
    assert.deepEqual(params, []);
});

test('Sale._filterWhere: date range uses either param spelling', () => {
    const a = [], b = [];
    const w1 = Sale._filterWhere({ date_from: '2026-01-01', date_to: '2026-02-01' }, a);
    const w2 = Sale._filterWhere({ startDate: '2026-01-01', endDate: '2026-02-01' }, b);
    assert.match(w1, /DATE\(CONVERT_TZ\(s\.created_at,'\+00:00','\+08:00'\)\) >= \?/);
    assert.match(w1, /DATE\(CONVERT_TZ\(s\.created_at,'\+00:00','\+08:00'\)\) <= \?/);
    assert.deepEqual(a, ['2026-01-01', '2026-02-01']);
    assert.deepEqual(b, ['2026-01-01', '2026-02-01']); // startDate/endDate alias
});

test('Sale._filterWhere: date range is bounded in Philippine time, not UTC', () => {
    // Timestamps are stored in UTC and the shop opens at 6am Manila. Filtering
    // on the raw column would push the first two hours of trading into the
    // previous day, so a "today" filter would quietly lose the morning rush.
    const where = Sale._filterWhere({ date_from: '2026-01-01' }, []);
    assert.ok(!/DATE\(s\.created_at\)/.test(where),
        'must not compare the raw UTC column');
    assert.ok(where.includes("'+08:00'"), 'must convert to Philippine time');
});

test('Sale._filterWhere: search matches id, sale_number and staff name', () => {
    const params = [];
    const where = Sale._filterWhere({ search: '180' }, params);
    assert.match(where, /s\.id AS CHAR\) LIKE \?/);
    assert.match(where, /s\.sale_number LIKE \?/);
    assert.match(where, /u\.full_name LIKE \?/);
    assert.deepEqual(params, ['%180%', '%180%', '%180%']);
});

test('Notification._scopeWhere: user scope includes global (NULL) rows', () => {
    const params = [];
    const where = Notification._scopeWhere({ user_id: 7 }, params);
    assert.match(where, /n\.user_id = \? OR n\.user_id IS NULL/);
    assert.deepEqual(params, [7]);
});

test('Notification._scopeWhere: status read/unread map to is_read', () => {
    const unread = Notification._scopeWhere({ status: 'unread' }, []);
    const read = Notification._scopeWhere({ status: 'read' }, []);
    assert.match(unread, /n\.is_read = FALSE/);
    assert.match(read, /n\.is_read = TRUE/);
});

test('Notification._scopeWhere: type filter is parameterized', () => {
    const params = [];
    const where = Notification._scopeWhere({ type: 'low_stock' }, params);
    assert.match(where, /n\.type = \?/);
    assert.deepEqual(params, ['low_stock']);
});
