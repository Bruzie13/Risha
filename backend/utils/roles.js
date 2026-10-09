/* Who may do what.

   admin / manager / staff / viewer work across the back office, as before.
   Two roles are fenced in:

     cashier   the till. The POS screen and nothing else: it can read the
               product list, record a sale, and reprint a sale it made.
     supplier  an outside company. Its own details, the products it supplies
               and the purchase orders addressed to it — nothing of the shop's
               sales, other suppliers, or the rest of the stock.

   For these two the rule is deny-by-default: anything not listed here is
   refused. A new endpoint added later is therefore closed to them until
   someone opens it on purpose, which is the safe way to be wrong.

   Selling belongs to the till accounts. Admins and managers run inventory and
   do not get the POS. */

const ROLES = ['admin', 'manager', 'staff', 'viewer', 'cashier', 'supplier'];
const SELLING_ROLES = ['cashier', 'staff'];

// Every signed-in account may check its session and manage its own profile.
const SELF = [
    ['GET', /^\/api\/auth\/verify$/],
    ['PUT', /^\/api\/auth\/profile$/],
    ['PUT', /^\/api\/auth\/change-password$/]
];

const API_ALLOW = {
    cashier: [
        ['GET', /^\/api\/products$/],
        ['GET', /^\/api\/products\/(stock-levels|categories|barcode)$/],
        ['POST', /^\/api\/sales$/],
        ['GET', /^\/api\/sales\/\d+$/],   // own sales only — enforced in the controller
        ...SELF
    ],
    supplier: [
        ['GET', /^\/api\/supplier-portal\/(me|products|orders)$/],
        ['PUT', /^\/api\/supplier-portal\/orders\/\d+\/status$/],
        ...SELF
    ]
};

const PAGE_ALLOW = {
    cashier: ['/pos.html', '/settings.html'],
    supplier: ['/supplier.html', '/settings.html']
};

const isRestricted = role => Object.prototype.hasOwnProperty.call(API_ALLOW, role);

/** May this role call this API? `path` is the request path without its query string. */
function apiAllowed(role, method, path) {
    if (!isRestricted(role)) return ROLES.includes(role);
    const clean = String(path || '').replace(/\/+$/, '');
    return API_ALLOW[role].some(([m, re]) => m === method && re.test(clean));
}

/** May this role open this page? */
function pageAllowed(role, path) {
    if (isRestricted(role)) return PAGE_ALLOW[role].includes(path);
    if (path === '/pos.html') return SELLING_ROLES.includes(role);
    if (path === '/supplier.html') return false;
    return true;
}

function homePage(role) {
    if (role === 'cashier') return '/pos.html';
    if (role === 'supplier') return '/supplier.html';
    return '/dashboard.html';
}

module.exports = { ROLES, SELLING_ROLES, isRestricted, apiAllowed, pageAllowed, homePage };
