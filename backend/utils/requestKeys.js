/* One action, one write.

   A button pressed twice, an answer lost on a slow connection, the same page
   open in two tabs: each can send the same action to the server twice. The
   page marks an action with a reference it makes once, and the server makes
   sure a reference is only ever acted on once.

     Sale    The till makes a reference when a cart is first charged and keeps
             it until that cart is sold or cleared. It becomes the sale number
             (SALE-<reference>), which the database keeps unique, so a second
             request for the same cart can only be answered with the sale that
             already exists.

     Stock   The stock window makes a number each time it is opened. It is
             stored on the stock-movement row the change writes, and a request
             carrying a number that already has a row changes nothing.

   An action with no reference still works (an older copy of the page, or a
   direct call): it just has no protection against being repeated. */

const SALE_REF = /^[0-9A-Z]{13}$/;
const MAX_STOCK_KEY = 2147483647;      // what the reference_id column holds

/** A fresh sale reference: 8 characters of time and 5 at random, 13 in all. */
function newSaleRef(now = Date.now(), random = Math.random) {
    const time = now.toString(36).padStart(8, '0').slice(-8);
    let tail = '';
    while (tail.length < 5) tail += Math.floor(random() * 36).toString(36);
    return (time + tail).toUpperCase();
}

/**
 * The sale reference a request carries.
 * Returns null when none was sent, false when what was sent is not one,
 * otherwise the reference in capitals.
 */
function saleRef(value) {
    if (value === undefined || value === null || value === '') return null;
    const ref = String(value).toUpperCase();
    return SALE_REF.test(ref) ? ref : false;
}

/**
 * The request number a stock change carries: null when none was sent, false
 * when it is not a whole number the column can hold, otherwise the number.
 */
function stockRequestKey(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= MAX_STOCK_KEY ? n : false;
}

module.exports = { newSaleRef, saleRef, stockRequestKey, MAX_STOCK_KEY };
