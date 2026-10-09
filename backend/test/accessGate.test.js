const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

/* Exercises the real middleware and the real supplier-portal router against a
   stand-in database, so the tests prove the wiring — that the gate actually
   runs on a request — and not just the rule table. */

process.env.JWT_SECRET = 'unit-test-secret-not-used-anywhere-else';

// ---- stand-in database ----
const db = {
    users: {
        1: { is_active: 1, role: 'admin', token_version: 0, supplier_id: null },
        2: { is_active: 1, role: 'cashier', token_version: 0, supplier_id: null },
        3: { is_active: 1, role: 'supplier', token_version: 0, supplier_id: 10 },
        4: { is_active: 1, role: 'supplier', token_version: 0, supplier_id: null }
    },
    orders: {
        100: { id: 100, po_number: 'PO-100', supplier_id: 10, status: 'pending' },
        200: { id: 200, po_number: 'PO-200', supplier_id: 20, status: 'pending' },
        300: { id: 300, po_number: 'PO-300', supplier_id: 10, status: 'shipped' }
    },
    statusUpdates: []
};
const run = async (sql, params = []) => {
    if (/FROM users WHERE id/.test(sql)) { const u = db.users[params[0]]; return [u ? [u] : []]; }
    if (/FROM users u JOIN suppliers s/.test(sql)) {
        const u = db.users[params[0]];
        return [u && u.supplier_id ? [{ id: u.supplier_id, name: 'Supplier ' + u.supplier_id }] : []];
    }
    return [[]];
};
const poolPath = require.resolve('../config/database');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: {
    query: run,
    getConnection: async () => ({ execute: run, release() {} })
} };
const stub = (rel, exports) => {
    const p = require.resolve(rel);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('../models/PurchaseOrder', {
    findById: async id => db.orders[id] || null,
    updateStatus: async (id, status) => { db.statusUpdates.push([id, status]); }
});
stub('../services/audit', () => {});
stub('../services/notifier', { notifyPOStatusChanged: async () => {} });

const { authenticateToken } = require('../middleware/auth');
const portal = require('../routes/supplierPortal');

const tokenFor = id => jwt.sign({ id, tv: 0 }, process.env.JWT_SECRET);

function call(handler, { userId, method = 'GET', url, body, params } = {}) {
    return new Promise(resolve => {
        const req = { method, originalUrl: url, url, path: url, body: body || {}, params: params || {}, ip: '127.0.0.1',
            headers: userId ? { authorization: 'Bearer ' + tokenFor(userId) } : {} };
        const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
        handler(req, res, () => resolve({ code: 'next', req }));
    });
}

test('gate: a cashier token is admitted to the till endpoints and nowhere else', async () => {
    assert.equal((await call(authenticateToken, { userId: 2, url: '/api/products?limit=10' })).code, 'next');
    assert.equal((await call(authenticateToken, { userId: 2, method: 'POST', url: '/api/sales' })).code, 'next');
    assert.equal((await call(authenticateToken, { userId: 2, url: '/api/suppliers' })).code, 403);
    assert.equal((await call(authenticateToken, { userId: 2, url: '/api/sales/report?period=daily' })).code, 403);
    assert.equal((await call(authenticateToken, { userId: 2, url: '/api/auth/users' })).code, 403);
});

test('gate: a supplier token cannot read the shop', async () => {
    assert.equal((await call(authenticateToken, { userId: 3, url: '/api/supplier-portal/orders' })).code, 'next');
    assert.equal((await call(authenticateToken, { userId: 3, url: '/api/products' })).code, 403);
    assert.equal((await call(authenticateToken, { userId: 3, url: '/api/purchase-orders/200' })).code, 403);
    assert.equal((await call(authenticateToken, { userId: 3, url: '/api/suppliers/20' })).code, 403);
});

test('gate: the role comes from the database, not from what the token claims', async () => {
    const forged = jwt.sign({ id: 2, tv: 0, role: 'admin' }, process.env.JWT_SECRET);
    const result = await new Promise(resolve => {
        const req = { method: 'GET', originalUrl: '/api/auth/users', headers: { authorization: 'Bearer ' + forged } };
        const res = { code: 200, status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
        authenticateToken(req, res, () => resolve('next'));
    });
    assert.equal(result, 403);
});

test('gate: admin still passes, and no token is still 401', async () => {
    assert.equal((await call(authenticateToken, { userId: 1, url: '/api/suppliers' })).code, 'next');
    assert.equal((await call(authenticateToken, { url: '/api/products' })).code, 401);
});

// Walk the portal router the way Express would, for one route.
async function portalCall(userId, method, path, body) {
    const url = '/api/supplier-portal' + path;
    const req = { method, originalUrl: url, url: path, path, body: body || {}, params: {}, ip: '127.0.0.1',
        headers: { authorization: 'Bearer ' + tokenFor(userId) } };
    return new Promise(resolve => {
        const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
        portal.handle(req, res, () => resolve({ code: 404 }));
    });
}

test('portal: only supplier accounts get in, and only when linked to a supplier', async () => {
    assert.equal((await portalCall(1, 'GET', '/me')).code, 403, 'admin is not a supplier');
    assert.equal((await portalCall(4, 'GET', '/me')).code, 403, 'supplier account with no supplier linked');
    const ok = await portalCall(3, 'GET', '/me');
    assert.equal(ok.code, 200);
    assert.equal(ok.body.data.id, 10);
});

test('portal: a supplier can move its own order forward one step', async () => {
    db.statusUpdates.length = 0;
    const r = await portalCall(3, 'PUT', '/orders/100/status', { status: 'confirmed' });
    assert.equal(r.code, 200);
    assert.deepEqual(db.statusUpdates, [[100, 'confirmed']]);
});

test('portal: another supplier\'s order looks exactly like one that does not exist', async () => {
    db.statusUpdates.length = 0;
    const theirs = await portalCall(3, 'PUT', '/orders/200/status', { status: 'confirmed' });
    const missing = await portalCall(3, 'PUT', '/orders/999/status', { status: 'confirmed' });
    assert.equal(theirs.code, 404);
    assert.deepEqual(theirs.body, missing.body);
    assert.deepEqual(db.statusUpdates, []);
});

test('portal: a supplier cannot skip steps, receive, or cancel', async () => {
    db.statusUpdates.length = 0;
    assert.equal((await portalCall(3, 'PUT', '/orders/100/status', { status: 'shipped' })).code, 400);
    assert.equal((await portalCall(3, 'PUT', '/orders/100/status', { status: 'received' })).code, 400);
    assert.equal((await portalCall(3, 'PUT', '/orders/100/status', { status: 'cancelled' })).code, 400);
    assert.equal((await portalCall(3, 'PUT', '/orders/300/status', { status: 'received' })).code, 400,
        'receiving adds stock, so it stays with the shop');
    assert.deepEqual(db.statusUpdates, []);
});
