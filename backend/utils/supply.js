/* Rules for what passes between the shop and a supplier, kept free of the
   database so each one can be tested on its own. Dates are the shop's
   calendar days as 'YYYY-MM-DD' strings throughout. */

const DAY_MS = 86400000;
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const dayMs = s => Date.parse(s + 'T00:00:00Z');
const toDay = ms => new Date(ms).toISOString().slice(0, 10);

/** "Net 30" → 30, "Due on Receipt" → 0, anything unreadable → null. */
function termDays(terms) {
    const t = String(terms || '').toLowerCase();
    const net = /(?:net|within)\s*(\d{1,3})/.exec(t) || /(\d{1,3})\s*days?/.exec(t);
    if (net) return Number(net[1]);
    if (/receipt|cod|cash|delivery|immediate/.test(t)) return 0;
    return null;
}

/** When payment for a received order falls due, or null when the terms do not say. */
function dueDate(receivedDay, terms) {
    const days = termDays(terms);
    if (!isDay(receivedDay) || days === null) return null;
    return toDay(dayMs(receivedDay) + days * DAY_MS);
}

/* A delivery date a supplier promises: a real day, not in the past, and not
   so far off that it is plainly a slip of the finger. */
function promiseProblem(day, today) {
    if (!isDay(day)) return 'Choose the date you will deliver.';
    if (dayMs(day) < dayMs(today)) return 'The delivery date cannot be in the past.';
    if (dayMs(day) > dayMs(today) + 365 * DAY_MS) return 'That delivery date is more than a year away.';
    return null;
}

/* What the supplier says they can actually send. Each line may be anything
   from none of it up to what was ordered — never more, since extra stock the
   shop did not ask for is the shop's decision, not the supplier's. A line left
   out means "all of it". At least one line must have something on it, or the
   honest answer is to decline the order rather than confirm it.

   orderItems: [{ id, quantity, unit_price }]   requested: [{ id, quantity }] */
function confirmLines(orderItems, requested) {
    const asked = new Map();
    for (const r of Array.isArray(requested) ? requested : []) asked.set(Number(r.id), r.quantity);
    const lines = [];
    let total = 0, short = 0;
    for (const item of orderItems) {
        const ordered = Number(item.quantity);
        const raw = asked.has(Number(item.id)) ? Number(asked.get(Number(item.id))) : ordered;
        if (!Number.isInteger(raw) || raw < 0 || raw > ordered) {
            return { error: 'Each quantity must be a whole number between 0 and the amount ordered.' };
        }
        if (raw < ordered) short++;
        total += raw * Number(item.unit_price);
        lines.push({ id: Number(item.id), confirmed: raw });
    }
    if (!lines.some(l => l.confirmed > 0)) {
        return { error: 'You cannot confirm an order with nothing on it. Tell the shop in a note if you cannot supply it.' };
    }
    return { lines, total: Math.round(total * 100) / 100, short };
}

/* Lines for an order a supplier offers. Only its own products, sensible
   quantities, each product once. `own` maps product id → cost price. */
function proposalLines(items, own) {
    if (!Array.isArray(items) || !items.length) return { error: 'Add at least one product.' };
    if (items.length > 50) return { error: 'An order can have at most 50 products.' };
    const seen = new Set();
    const lines = [];
    let total = 0;
    for (const it of items) {
        const pid = Number(it.product_id), qty = Number(it.quantity);
        if (!own.has(pid)) return { error: 'You can only offer products you supply.' };
        if (seen.has(pid)) return { error: 'Each product can appear once.' };
        if (!Number.isInteger(qty) || qty < 1 || qty > 10000) return { error: 'Each quantity must be a whole number from 1 to 10,000.' };
        seen.add(pid);
        const price = Number(own.get(pid)) || 0;
        lines.push({ product_id: pid, quantity: qty, unit_price: price, subtotal: Math.round(qty * price * 100) / 100 });
        total += qty * price;
    }
    return { lines, total: Math.round(total * 100) / 100 };
}

/** A price a supplier proposes for one of its products. */
/* A price is a plain amount in pesos: digits, and at most two decimals.
   "+20", "1e3", "20abc" or 12.345 are refused with the reason, not read as
   some other number. */
const PRICE_TEXT = /^\d+(\.\d{1,2})?$/;
function priceProblem(price) {
    if (price === null || price === undefined || price === '' || typeof price === 'boolean') return 'Enter the new price.';
    const text = typeof price === 'number' ? String(price) : String(price).trim();
    if (!PRICE_TEXT.test(text)) return 'Type the price as a number only, like 1250 or 1250.50: no + or - signs, no letters, and at most 2 decimals.';
    const n = Number(text);
    if (n <= 0) return 'Enter a price greater than zero.';
    if (n > 1000000) return 'That price is too large (₱1,000,000 at most).';
    return null;
}

/* Why the shop declined a supplier's price. The supplier reads it on their
   portal, so it has to say something: 3 to 300 characters with a letter. */
const DECLINE_REASON_MAX = 300;
function declineReasonProblem(reason) {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text) return 'Type why you are declining this price. The supplier will see it.';
    if (text.length < 3 || !/[A-Za-z]/.test(text)) return 'Write the reason in words, like "Too high compared with other suppliers".';
    if (text.length > DECLINE_REASON_MAX) return 'Keep the reason to ' + DECLINE_REASON_MAX + ' characters or fewer.';
    return null;
}

/* How a supplier has done on the orders the shop has received.
   on time   arrived on or before the date promised (or, where the supplier
             never promised one, the date the shop asked for). Orders with
             neither date are left out of the on-time figure rather than
             counted as a pass.
   complete  every line arrived in the quantity ordered.

   orders: [{ ordered_day, received_day, target_day, short_lines }] */
function scorecard(orders) {
    const done = orders.filter(o => isDay(o.received_day));
    const dated = done.filter(o => isDay(o.target_day));
    const onTime = dated.filter(o => dayMs(o.received_day) <= dayMs(o.target_day)).length;
    const complete = done.filter(o => !Number(o.short_lines)).length;
    const waits = done.filter(o => isDay(o.ordered_day)).map(o => (dayMs(o.received_day) - dayMs(o.ordered_day)) / DAY_MS);
    const pct = (n, of) => of ? Math.round(n / of * 100) : null;
    return {
        delivered: done.length,
        on_time_percent: pct(onTime, dated.length),
        on_time_of: dated.length,
        complete_percent: pct(complete, done.length),
        average_days: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length * 10) / 10 : null
    };
}

/* May a purchase order be raised for this product? Only when it has a supplier
   who is still on the shop's list. Deleting a supplier leaves its products
   pointing at it, so "has a supplier id" is not enough: the order would be
   addressed to someone who can no longer sign in or be emailed.
   `activeSupplierIds` is a Set of the ids of suppliers that have not been
   deleted. Returns the reason it may not be ordered, or null. */
function reorderSupplierProblem(product, activeSupplierIds) {
    if (!product || !product.supplier_id) return 'no supplier assigned';
    if (!activeSupplierIds || !activeSupplierIds.has(Number(product.supplier_id))) {
        return 'its supplier has been deleted, so assign a current supplier first';
    }
    return null;
}

/* A supplier's star rating, from the scorecard above (orders received in the
   last 12 months). One rule, shown to the shop and to the supplier alike:

     1 star   at least one order received
     +1 star  at least 75% of orders arrived by the promised date
     +1 star  at least 90% of orders arrived by the promised date
     +1 star  at least 90% of orders arrived in full
     +1 star  on average, orders arrived within 7 days of being placed
              (the delivery time Stock planning plans with)

   A supplier MEETS THE STANDARD at 4 stars or more. A figure that cannot be
   worked out (no order had a promised date) earns no star, and says so. */
const STAR_RULE = { onTimeOne: 75, onTimeTwo: 90, inFull: 90, maxDays: 7, standard: 4 };

function starRating(score, rule = STAR_RULE) {
    if (!score || !score.delivered) {
        return { stars: 0, rated: false, meets_standard: false, standard: rule.standard,
            summary: 'Not rated yet: no order from this supplier was received in the last 12 months.', checks: [] };
    }
    const pct = v => (v == null ? 'not measured' : v + '%');
    const checks = [
        { label: 'At least one order received in the last 12 months', met: true, value: score.delivered + ' received' },
        { label: 'At least ' + rule.onTimeOne + '% of orders arrived by the promised date', met: score.on_time_percent != null && score.on_time_percent >= rule.onTimeOne, value: score.on_time_of ? pct(score.on_time_percent) + ' of ' + score.on_time_of : 'no order had a promised date' },
        { label: 'At least ' + rule.onTimeTwo + '% of orders arrived by the promised date', met: score.on_time_percent != null && score.on_time_percent >= rule.onTimeTwo, value: score.on_time_of ? pct(score.on_time_percent) + ' of ' + score.on_time_of : 'no order had a promised date' },
        { label: 'At least ' + rule.inFull + '% of orders arrived in full', met: score.complete_percent != null && score.complete_percent >= rule.inFull, value: pct(score.complete_percent) },
        { label: 'Orders arrive within ' + rule.maxDays + ' days on average', met: score.average_days != null && score.average_days <= rule.maxDays, value: score.average_days != null ? score.average_days + ' days' : 'not measured' }
    ];
    const stars = checks.filter(c => c.met).length;
    const meets = stars >= rule.standard;
    return { stars, rated: true, meets_standard: meets, standard: rule.standard, checks,
        summary: stars + ' of 5 stars. ' + (meets ? 'Meets the standard (' + rule.standard + ' stars or more).' : 'Below the standard: it needs ' + rule.standard + ' stars or more.') };
}

module.exports = { termDays, dueDate, promiseProblem, confirmLines, proposalLines, priceProblem, declineReasonProblem, DECLINE_REASON_MAX, scorecard, starRating, STAR_RULE, reorderSupplierProblem };
