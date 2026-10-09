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
    orders: {},
    products: { 50: { id: 50, supplier_id: 10, cost_price: 100 }, 60: { id: 60, supplier_id: 20, cost_price: 70 } },
    writes: []
};
function resetOrders() {
    db.orders = {
        100: { id: 100, po_number: 'PO-100', supplier_id: 10, status: 'pending' },
        200: { id: 200, po_number: 'PO-200', supplier_id: 20, status: 'pending' },
        300: { id: 300, po_number: 'PO-300', supplier_id: 10, status: 'shipped' },
        400: { id: 400, po_number: 'PO-400', supplier_id: 10, status: 'confirmed' }
    };
    db.writes = [];
}
resetOrders();
const run = async (sql, params = []) => {
    if (/FROM users WHERE id/.test(sql)) { const u = db.users[params[0]]; return [u ? [u] : []]; }
    if (/FROM users u JOIN suppliers s/.test(sql)) {
        const u = db.users[params[0]];
        return [u && u.supplier_id ? [{ id: u.supplier_id, name: 'Supplier ' + u.supplier_id, payment_terms: 'Net 30' }] : []];
    }
    if (/^\s*UPDATE purchase_orders/.test(sql)) {
        const id = params[params.length - 1] in db.orders ? params[params.length - 1] : params[params.length - 2];
        const order = db.orders[id];
        const need = /status = 'pending'\s*$/.test(sql.trim()) ? 'pending' : /AND status = 'confirmed'/.test(sql) ? 'confirmed' : null;
        if (!order || (need && order.status !== need)) return [{ affectedRows: 0 }];
        const to = /SET status = '(\w+)'/.exec(sql);
        if (to) order.status = to[1];
        db.writes.push(['order', id, to ? to[1] : 'fields']);
        return [{ affectedRows: 1 }];
    }
    if (/^\s*UPDATE po_items/.test(sql)) { db.writes.push(['line', params[1], params[0]]); return [{ affectedRows: 1 }]; }
    if (/FROM products WHERE supplier_id/.test(sql)) {
        return [Object.values(db.products).filter(p => p.supplier_id === params[0])];
    }
    if (/FROM products WHERE id = \? AND supplier_id/.test(sql)) {
        const p = db.products[params[0]];
        return [p && p.supplier_id === params[1] ? [p] : []];
    }
    if (/COUNT\(\*\) AS c FROM purchase_orders/.test(sql)) return [[{ c: 0 }]];
    if (/^\s*(INSERT|DELETE)/.test(sql)) { db.writes.push([sql.trim().split(/\s+/).slice(0, 3).join(' ')]); return [{ affectedRows: 1, insertId: 1 }]; }
    return [[]];
};
const poolPath = require.resolve('../config/database');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: {
    query: run,
    getConnection: async () => ({ execute: run, query: run, release() {}, async beginTransaction() {}, async commit() {}, async rollback() {} })
} };
const stub = (rel, exports) => {
    const p = require.resolve(rel);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
};
stub('../models/PurchaseOrder', {
    findById: async id => db.orders[id] || null,
    getPOItems: async () => [{ id: 1, quantity: 10, unit_price: 100 }, { id: 2, quantity: 5, unit_price: 40 }],
    create: async data => { db.writes.push(['offer', data.status, data.items.length, data.total_amount]); return { id: 900, po_number: 'PO-900' }; }
});
stub('../models/Notification', { create: async () => {} });
stub('../services/audit', () => {});

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

const TOMORROW = new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10);

test('portal: confirming an order records the date and what is really coming', async () => {
    resetOrders();
    const r = await portalCall(3, 'POST', '/orders/100/confirm', { promised_date: TOMORROW, items: [{ id: 1, quantity: 6 }] });
    assert.equal(r.code, 200);
    assert.equal(db.orders[100].status, 'confirmed');
    assert.deepEqual(db.writes.filter(w => w[0] === 'line'), [['line', 1, 6], ['line', 2, 5]]);
});

test('portal: a confirmation needs a real future date and sane quantities', async () => {
    resetOrders();
    assert.equal((await portalCall(3, 'POST', '/orders/100/confirm', { items: [] })).code, 400, 'no date');
    assert.equal((await portalCall(3, 'POST', '/orders/100/confirm', { promised_date: '2020-01-01' })).code, 400, 'past date');
    assert.equal((await portalCall(3, 'POST', '/orders/100/confirm', { promised_date: TOMORROW, items: [{ id: 1, quantity: 99 }] })).code, 400, 'more than ordered');
    assert.equal(db.orders[100].status, 'pending');
    assert.deepEqual(db.writes, []);
});

test('portal: another supplier\'s order looks exactly like one that does not exist', async () => {
    resetOrders();
    for (const [method, path, body] of [
        ['POST', '/confirm', { promised_date: TOMORROW }], ['POST', '/ship', {}],
        ['PUT', '/promise', { promised_date: TOMORROW, note: 'delay' }],
        ['GET', '/messages'], ['POST', '/messages', { body: 'hello' }]
    ]) {
        const theirs = await portalCall(3, method, '/orders/200' + path, body);
        const missing = await portalCall(3, method, '/orders/999' + path, body);
        assert.equal(theirs.code, 404, `${method} ${path}`);
        assert.deepEqual(theirs.body, missing.body);
    }
    assert.equal(db.orders[200].status, 'pending');
    assert.deepEqual(db.writes, []);
});

test('portal: steps cannot be skipped, and receiving is not offered at all', async () => {
    resetOrders();
    assert.equal((await portalCall(3, 'POST', '/orders/100/ship', {})).code, 400, 'ship before confirming');
    assert.equal((await portalCall(3, 'POST', '/orders/300/confirm', { promised_date: TOMORROW })).code, 400, 'confirm a shipped order');
    // not on the supplier's list at all, so the gate refuses before any route is tried
    assert.equal((await portalCall(3, 'POST', '/orders/300/receive', {})).code, 403);
    assert.equal((await portalCall(3, 'PUT', '/orders/300/status', { status: 'received' })).code, 403, 'the old status route is gone');
    assert.deepEqual(db.writes, []);
});

test('portal: shipping takes a receipt number but not markup', async () => {
    resetOrders();
    assert.equal((await portalCall(3, 'POST', '/orders/400/ship', { delivery_ref: '<img src=x onerror=alert(1)>' })).code, 400);
    assert.equal(db.orders[400].status, 'confirmed');
    assert.equal((await portalCall(3, 'POST', '/orders/400/ship', { delivery_ref: 'DR-10452' })).code, 200);
    assert.equal(db.orders[400].status, 'shipped');
});

test('portal: an offer can only contain the supplier\'s own products', async () => {
    resetOrders();
    const theirs = await portalCall(3, 'POST', '/offers', { promised_date: TOMORROW, items: [{ product_id: 60, quantity: 5 }] });
    assert.equal(theirs.code, 400);
    assert.deepEqual(db.writes, []);
    const mine = await portalCall(3, 'POST', '/offers', { promised_date: TOMORROW, items: [{ product_id: 50, quantity: 5 }] });
    assert.equal(mine.code, 201);
    assert.deepEqual(db.writes[0], ['offer', 'proposed', 1, 500], 'priced by the shop\'s cost, not by the request');
});

test('portal: a price can only be proposed for the supplier\'s own product', async () => {
    resetOrders();
    assert.equal((await portalCall(3, 'POST', '/products/60/price', { price: 1 })).code, 404);
    assert.equal((await portalCall(3, 'POST', '/products/50/price', { price: -5 })).code, 400);
    assert.deepEqual(db.writes, []);
    assert.equal((await portalCall(3, 'POST', '/products/50/price', { price: 120 })).code, 200);
});
