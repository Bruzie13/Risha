const test = require('node:test');
const assert = require('node:assert');

const { apiAllowed, pageAllowed, homePage, SELLING_ROLES } = require('../utils/roles');

test('cashier: can reach exactly what the till needs', () => {
    assert.ok(apiAllowed('cashier', 'GET', '/api/products'));
    assert.ok(apiAllowed('cashier', 'GET', '/api/products/categories'));
    assert.ok(apiAllowed('cashier', 'GET', '/api/products/stock-levels'));
    assert.ok(apiAllowed('cashier', 'POST', '/api/sales'));
    assert.ok(apiAllowed('cashier', 'GET', '/api/sales/42'));
    assert.ok(apiAllowed('cashier', 'PUT', '/api/auth/change-password'));
});

test('cashier: everything else is refused', () => {
    for (const [method, path] of [
        ['GET', '/api/sales'], ['GET', '/api/sales/report'], ['POST', '/api/sales/42/void'],
        ['DELETE', '/api/sales/42'], ['PUT', '/api/sales/42'], ['POST', '/api/sales/eod'],
        ['POST', '/api/products'], ['PUT', '/api/products/3'], ['DELETE', '/api/products/3'],
        ['PUT', '/api/products/3/stock'], ['GET', '/api/products/3'], ['GET', '/api/products/suppliers'],
        ['GET', '/api/suppliers'], ['GET', '/api/purchase-orders'], ['GET', '/api/dashboard/stats'],
        ['GET', '/api/predictions/overview'], ['GET', '/api/auth/users'], ['POST', '/api/auth/register'],
        ['GET', '/api/audit-logs'], ['GET', '/api/backup'], ['POST', '/api/assistant/ask'],
        ['GET', '/api/notifications'], ['GET', '/api/supplier-portal/orders']
    ]) {
        assert.equal(apiAllowed('cashier', method, path), false, `${method} ${path} should be refused`);
    }
});

test('supplier: only its own portal and its own profile', () => {
    assert.ok(apiAllowed('supplier', 'GET', '/api/supplier-portal/me'));
    assert.ok(apiAllowed('supplier', 'GET', '/api/supplier-portal/products'));
    assert.ok(apiAllowed('supplier', 'GET', '/api/supplier-portal/orders'));
    assert.ok(apiAllowed('supplier', 'PUT', '/api/supplier-portal/orders/7/status'));
    for (const [method, path] of [
        ['GET', '/api/products'], ['GET', '/api/suppliers'], ['GET', '/api/suppliers/2'],
        ['GET', '/api/purchase-orders'], ['GET', '/api/purchase-orders/7'], ['PUT', '/api/purchase-orders/7/status'],
        ['POST', '/api/sales'], ['GET', '/api/sales'], ['GET', '/api/dashboard/stats'],
        ['GET', '/api/auth/users'], ['DELETE', '/api/supplier-portal/orders/7'], ['GET', '/api/backup']
    ]) {
        assert.equal(apiAllowed('supplier', method, path), false, `${method} ${path} should be refused`);
    }
});

test('fenced roles: odd spellings of an allowed path do not slip through', () => {
    assert.equal(apiAllowed('cashier', 'GET', '/API/products'), false);
    assert.equal(apiAllowed('cashier', 'GET', '/api/products/../suppliers'), false);
    assert.equal(apiAllowed('cashier', 'GET', '/api/products%2f..%2fsuppliers'), false);
    assert.equal(apiAllowed('supplier', 'GET', '/api/supplier-portal/orders/7/status/../../..'), false);
    assert.ok(apiAllowed('cashier', 'GET', '/api/products/'), 'a trailing slash is the same route');
});

test('back-office roles are unaffected, and an unknown role gets nothing', () => {
    for (const role of ['admin', 'manager', 'staff', 'viewer']) {
        assert.ok(apiAllowed(role, 'GET', '/api/suppliers'));
        assert.ok(apiAllowed(role, 'GET', '/api/predictions/overview'));
    }
    assert.equal(apiAllowed('intruder', 'GET', '/api/products'), false);
    assert.equal(apiAllowed(undefined, 'GET', '/api/products'), false);
});

test('pages: each account lands on, and is kept to, its own screens', () => {
    assert.equal(homePage('cashier'), '/pos.html');
    assert.equal(homePage('supplier'), '/supplier.html');
    assert.equal(homePage('admin'), '/dashboard.html');

    assert.ok(pageAllowed('cashier', '/pos.html'));
    assert.ok(pageAllowed('cashier', '/settings.html'));
    assert.equal(pageAllowed('cashier', '/inventory.html'), false);
    assert.equal(pageAllowed('cashier', '/dashboard.html'), false);

    assert.ok(pageAllowed('supplier', '/supplier.html'));
    assert.equal(pageAllowed('supplier', '/suppliers.html'), false);
    assert.equal(pageAllowed('supplier', '/pos.html'), false);
});

test('the point of sale belongs to the till accounts, not to admin or manager', () => {
    assert.deepEqual(SELLING_ROLES, ['cashier', 'staff']);
    assert.equal(pageAllowed('admin', '/pos.html'), false);
    assert.equal(pageAllowed('manager', '/pos.html'), false);
    assert.equal(pageAllowed('viewer', '/pos.html'), false);
    assert.ok(pageAllowed('staff', '/pos.html'));
    assert.ok(pageAllowed('admin', '/inventory.html'));
    assert.equal(pageAllowed('admin', '/supplier.html'), false);
});
