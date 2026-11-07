/* On vacation or Inactive, the supplier portal is read-only (Carlo, 7 Nov 2026).
   The real portal routes are loaded with the database, sign-in, audit and
   notices replaced by stand-ins, so nothing is written anywhere. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const supplier = { id: 7, name: 'Test Supplier', status: 'active' };
const writes = [];

function stub(rel, exports) {
    const file = require.resolve(path.join('..', rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub('config/database', {
    query: async (sql) => {
        if (/^\s*SELECT/i.test(sql)) return [/FROM users u JOIN suppliers/.test(sql) ? [{ ...supplier }] : []];
        writes.push(sql);
        return [{ affectedRows: 1, insertId: 1 }];
    },
    execute: async () => [[]],
    getConnection: async () => { throw new Error('no connections in this test'); }
});
stub('middleware/auth', {
    authenticateToken: (req, res, next) => { req.user = { id: 99, role: 'supplier' }; next(); },
    authorizeRole: () => (req, res, next) => next()
});
stub('services/audit', () => {});
stub('models/Notification', { create: async () => ({}) });
stub('models/PurchaseOrder', { findById: async () => null });

const app = express();
app.use(express.json());
app.use('/api/supplier-portal', require('../routes/supplierPortal'));

function call(server, method, url, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const req = http.request({ port: server.address().port, method, path: '/api/supplier-portal' + url,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
            let text = '';
            res.on('data', c => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        req.end(data);
    });
}

// every portal change a supplier can make, except the status and contact details
const ACTIONS = [
    ['POST', '/orders/1/confirm', { promised_date: '2099-01-01', lines: [] }],
    ['POST', '/orders/1/ship', { delivery_ref: 'DR-1' }],
    ['PUT', '/orders/1/promise', { promised_date: '2099-01-01', note: 'late truck' }],
    ['POST', '/orders/1/messages', { body: 'hello' }],
    ['POST', '/products/1/price', { price: '100' }],
    ['POST', '/products/1/price/cancel'],
    ['POST', '/offers', { lines: [] }],
    ['POST', '/offers/1/cancel', { reason: 'none' }],
    ['POST', '/new-products', { name: 'X' }],
    ['POST', '/new-products/1/cancel']
];

test('On vacation or Inactive: every portal change is refused with the reason', async () => {
    const server = app.listen(0);
    try {
        for (const status of ['vacation', 'inactive']) {
            supplier.status = status;
            const say = status === 'vacation' ? 'On vacation' : 'Inactive';
            for (const [method, url, body] of ACTIONS) {
                writes.length = 0;
                const r = await call(server, method, url, body);
                assert.strictEqual(r.status, 403, `${status} ${method} ${url}`);
                assert.strictEqual(r.body.message, `Your status is ${say}, so the portal is locked. Change Your status to Active: taking orders to use it again.`);
                assert.strictEqual(writes.length, 0, `${status} ${method} ${url} wrote nothing`);
            }
        }
    } finally { server.close(); supplier.status = 'active'; }
});

test('On vacation or Inactive: looking around still works', async () => {
    const server = app.listen(0);
    try {
        supplier.status = 'vacation';
        const r = await call(server, 'GET', '/me');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.data.status, 'vacation');
    } finally { server.close(); supplier.status = 'active'; }
});

test('On vacation or Inactive: the status can still be changed back to Active', async () => {
    const server = app.listen(0);
    try {
        for (const status of ['vacation', 'inactive']) {
            supplier.status = status;
            writes.length = 0;
            const r = await call(server, 'PUT', '/me/status', { status: 'active' });
            assert.strictEqual(r.status, 200, status);
            assert.strictEqual(r.body.message, 'Your status is now Active. The shop has been told.');
            assert.ok(writes.some(sql => /UPDATE suppliers SET status/.test(sql)));
        }
    } finally { server.close(); supplier.status = 'active'; }
});

test('Active: the same actions are not locked', async () => {
    const server = app.listen(0);
    try {
        supplier.status = 'active';
        for (const [method, url, body] of ACTIONS) {
            const r = await call(server, method, url, body);
            assert.notStrictEqual(r.body && r.body.message, 'Your status is Active, so the portal is locked. Change Your status to Active: taking orders to use it again.');
            assert.ok(!(r.status === 403 && /portal is locked/.test(r.body.message)), `${method} ${url} answered ${r.status} ${r.body && r.body.message}`);
        }
    } finally { server.close(); }
});
