/* What arrives in a page address (a search box, a pair of dates), made into
   something a query can be given. Pure functions, so they can be tested
   without a database. */

/* To LIKE, % means "anything" and _ means "any one letter". A search for
   "50%" or "cat_food" has to say they are meant as themselves, or it matches
   every row. The pattern is used with LIKE ? ESCAPE '!', which does not
   depend on how the database is set to read a backslash. */
const LIKE_ESCAPE = "ESCAPE '!'";

function containsPattern(text) {
    return '%' + String(text).replace(/[!%_]/g, c => '!' + c) + '%';
}

/* 'YYYY-MM-DD' for a day that exists, otherwise null. The shape alone is not
   enough: 2026-02-30 and 2026-13-45 have the right shape. */
function realDay(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const day = new Date(Date.UTC(y, mo - 1, d));
    if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null;
    return y >= 1000 ? m[0] : null;
}

const NOT_A_DATE = ' is not a real date. Dates are written year-month-day, like 2026-10-11.';

/* The two ends of a date range.
   Returns { from, to } (null where nothing was given) or { problem } in words
   the person can act on. A range that cannot be read is refused: it used to be
   ignored, and the whole history came back as if it had been asked for.
   needBoth: the report totals a period, so it needs both ends. */
function dayRange(fromValue, toValue, { needBoth = false } = {}) {
    const given = v => v !== undefined && v !== null && String(v).trim() !== '';
    const from = given(fromValue) ? realDay(String(fromValue)) : null;
    const to = given(toValue) ? realDay(String(toValue)) : null;
    if (given(fromValue) && !from) return { problem: 'The start date' + NOT_A_DATE };
    if (given(toValue) && !to) return { problem: 'The end date' + NOT_A_DATE };
    if (needBoth && (from || to) && !(from && to)) return { problem: 'Choose both a start and an end date.' };
    if (from && to && from > to) return { problem: 'The start date is after the end date.' };
    return { from, to };
}

module.exports = { LIKE_ESCAPE, containsPattern, realDay, dayRange };
