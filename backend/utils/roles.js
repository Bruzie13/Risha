/* Who may do what.

   admin / manager / viewer work across the back office. Two roles are fenced
   in:

     cashier   the till. The POS screen and nothing else: it can read the
               product list, record a sale, list and reprint its own sales
               for the day, ask for one to be voided, and open and count its
               own cash drawer.
     supplier  an outside company. Its own details, the products it supplies
               and the purchase orders addressed to it: it can confirm one
               with a delivery date and quantities, ship it, leave notes,
               offer an order, and propose a price. Nothing of the shop's
               sales, other suppliers, or the rest of the stock.

   For these two the rule is deny-by-default: anything not listed here is
   refused. A new endpoint added later is therefore closed to them until
   someone opens it on purpose, which is the safe way to be wrong.

   Selling belongs to the cashier. Admins and managers run inventory and do
   not get the POS.

   There used to be a "staff" role: it sold on the POS and could read the
   back office. Cashier took the first half and viewer already covered the
   second, so it was retired and its accounts became cashiers. It is absent
   from ROLES on purpose — an account still carrying it is refused everywhere. */

const ROLES = ['admin', 'manager', 'viewer', 'cashier', 'supplier'];
const SELLING_ROLES = ['cashier'];

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
        ['GET', /^\/api\/sales\/eod$/],     // own drawer, today only — enforced in the controller
        ['POST', /^\/api\/sales\/eod$/],
        ['GET', /^\/api\/sales\/till$/],
        ['POST', /^\/api\/sales\/till\/open$/],
        ['GET', /^\/api\/sales\/mine$/],
        ['POST', /^\/api\/sales\/\d+\/void-request$/],
        ...SELF
    ],
    supplier: [
        ['GET', /^\/api\/supplier-portal\/(me|products|orders|scorecard)$/],
        ['PUT', /^\/api\/supplier-portal\/me$/],
        ['POST', /^\/api\/supplier-portal\/products\/\d+\/price$/],
        ['POST', /^\/api\/supplier-portal\/orders\/\d+\/(confirm|ship)$/],
        ['PUT', /^\/api\/supplier-portal\/orders\/\d+\/promise$/],
        ['GET', /^\/api\/supplier-portal\/orders\/\d+\/messages$/],
        ['POST', /^\/api\/supplier-portal\/orders\/\d+\/messages$/],
        ['POST', /^\/api\/supplier-portal\/offers$/],
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
