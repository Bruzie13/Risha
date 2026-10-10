const test = require('node:test');
const assert = require('node:assert');

const { adminRemovalProblem } = require('../utils/accounts');

const admin = (id, extra = {}) => ({ id, role: 'admin', is_active: 1, ...extra });

test('an administrator cannot delete, deactivate or demote their own account', () => {
    assert.match(adminRemovalProblem(1, admin(1), 3, 'delete'), /your own account/);
    assert.match(adminRemovalProblem(1, admin(1), 3, 'deactivate'), /your own account/);
    assert.match(adminRemovalProblem(1, admin(1), 3, 'demote'), /your own role/);
    assert.match(adminRemovalProblem('1', admin(1), 3, 'delete'), /your own account/, 'the id may arrive as text');
});

test('the only administrator cannot be removed by anyone', () => {
    assert.match(adminRemovalProblem(2, admin(1), 1, 'delete'), /only administrator/);
    assert.match(adminRemovalProblem(2, admin(1), 1, 'deactivate'), /only administrator/);
    assert.match(adminRemovalProblem(2, admin(1), 1, 'demote'), /only administrator/);
    assert.match(adminRemovalProblem(2, admin(1), 0, 'delete'), /only administrator/);
});

test('with another administrator left, one of them can be removed by the other', () => {
    assert.equal(adminRemovalProblem(2, admin(1), 2, 'delete'), null);
    assert.equal(adminRemovalProblem(2, admin(1), 2, 'demote'), null);
});

test('other accounts are not affected by the rule', () => {
    assert.equal(adminRemovalProblem(1, { id: 5, role: 'cashier', is_active: 1 }, 1, 'delete'), null);
    assert.equal(adminRemovalProblem(1, { id: 6, role: 'manager', is_active: 1 }, 1, 'deactivate'), null);
    assert.equal(adminRemovalProblem(1, { id: 7, role: 'admin', is_active: 0 }, 1, 'delete'), null, 'an administrator who is already deactivated is not the last active one');
    assert.equal(adminRemovalProblem(1, null, 1, 'delete'), null);
});
