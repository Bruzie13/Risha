/* Rules for the till, kept free of the database so they can be tested as
   plain arithmetic. */

const DEFAULT_MAX_DISCOUNT = 10;   // percent, until an admin sets another

/** A stored setting → a usable discount ceiling between 0 and 100. */
function maxDiscountFrom(stored) {
    const n = parseFloat(stored);
    if (!isFinite(n)) return DEFAULT_MAX_DISCOUNT;
    return Math.min(100, Math.max(0, n));
}

/* Decide the discount for a sale. A request over the ceiling is refused
   outright rather than quietly lowered: the cashier has already told the
   customer a price, and a silent change would make the receipt disagree with
   what was said at the counter. */
function checkDiscount(requested, maxPercent) {
    const pct = parseFloat(requested);
    if (!isFinite(pct) || pct <= 0) return { percent: 0 };
    if (pct > maxPercent) {
        return { error: `The largest discount allowed at the till is ${maxPercent}%. Ask a manager to change the limit.` };
    }
    return { percent: Math.round(pct * 100) / 100 };
}

/** What a cashier's drawer should hold: what it started with, plus the cash
    they took in sales, plus cash put in, minus cash taken out. */
function drawerExpected(openingCash, cashSales, cashIn = 0, cashOut = 0) {
    const n = v => Number(v) || 0;
    return Math.round((n(openingCash) + n(cashSales) + n(cashIn) - n(cashOut)) * 100) / 100;
}

/* Cash that moves in or out of the drawer for a reason other than a sale:
   the owner collecting the takings, paying a supplier, adding change. May
   this one be recorded? `kind` is 'out' or 'in'; `inDrawer` is what the
   drawer should hold right now. Returns the reason it may not, or null. */
function cashMoveProblem(kind, amount, reason, inDrawer) {
    if (kind !== 'out' && kind !== 'in') return 'Say whether the cash was taken out or put in.';
    const n = Number(amount);
    if (!isFinite(n) || n <= 0) return 'Enter the amount as a number above zero.';
    if (n > 1000000) return 'That amount is too large.';
    if (String(reason || '').trim().length < 3) {
        return kind === 'out' ? 'Say who took the cash and what for.' : 'Say who put the cash in and why.';
    }
    if (kind === 'out' && n > (Number(inDrawer) || 0) + 0.004) return 'That is more cash than the drawer should hold.';
    return null;
}

/* The cash counted at the end of the day, as typed. A plain amount only:
   "+20", "20abc" or "1e3" used to be read as 20 or 1000 and saved. The page
   (auth.js countedCashProblem) has the same rule. Returns the reason, or null. */
const MAX_COUNTED = 1000000;
function countedCashProblem(value) {
    const text = value == null ? '' : String(value).trim();
    if (!text) return 'Enter the cash counted in the drawer.';
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        return 'Type the cash counted as a number only, like 1500 or 1500.50: no + or - signs, no letters, and at most 2 decimals.';
    }
    if (Number(text) > MAX_COUNTED) return 'That amount is too large (₱1,000,000 at most).';
    return null;
}

/** Counted minus expected, to the centavo. Positive is over, negative is short. */
function discrepancy(counted, expected) {
    return Math.round((Number(counted) - Number(expected)) * 100) / 100;
}

/* May this cashier ask for this sale to be voided? Only their own, only
   today's, only while it still stands, and only once. `saleDay` and `today`
   are the shop's calendar days as 'YYYY-MM-DD'. */
function voidRequestProblem(sale, cashierId, saleDay, today) {
    if (!sale || Number(sale.created_by) !== Number(cashierId)) return 'Sale not found';
    if (sale.payment_status === 'voided') return 'That sale has already been voided.';
    if (sale.payment_status !== 'completed') return 'That sale cannot be voided.';
    if (saleDay !== today) return "Only today's sales can be sent for voiding from the till. Ask a manager about older ones.";
    if (sale.void_requested_at) return 'A void has already been requested for that sale.';
    return null;
}

module.exports = { DEFAULT_MAX_DISCOUNT, maxDiscountFrom, checkDiscount, drawerExpected, discrepancy, voidRequestProblem, cashMoveProblem, countedCashProblem };
