/* Expiration dates for stock that is being added.

   A batch that is put into stock (a new product, a received order, an
   imported row, an edited date) cannot carry a date that has already passed:
   it would go on the shelf already expired, and the till would refuse to sell
   it. "Today" is the shop's day, Philippine time. */

const shopToday = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** A date as YYYY-MM-DD, whether it came as text or as a Date from the database. */
function asDay(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) {
        if (isNaN(value)) return '';
        const two = n => String(n).padStart(2, '0');
        return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`;
    }
    return String(value).slice(0, 10);
}

/**
 * May this expiration date be saved?
 * `today` is the shop's day as YYYY-MM-DD. `previous` is the date the product
 * already has: leaving it as it is stays allowed, so a product that has
 * already expired can still have its other details edited.
 * No date at all is allowed (not everything expires).
 * Returns the reason it is refused, or null.
 */
function expiryProblem(value, today, previous) {
    if (value == null || value === '') return null;
    const day = asDay(value);
    const real = /^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day + 'T00:00:00Z'))
        && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;      // rejects 2026-02-31
    if (!real) return 'Enter the expiration date as a real date.';
    if (previous && asDay(previous) === day) return null;
    if (day < today) return 'The expiration date cannot be earlier than today.';
    return null;
}

module.exports = { shopToday, asDay, expiryProblem };
