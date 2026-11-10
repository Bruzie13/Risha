/* Guards between a product's sales and the forecast.

   The models learn from whatever they are shown, and one model is fitted for
   all products together. A single freak day in one product (a mistyped
   quantity, a one-off bulk purchase) therefore used to bend the forecast of
   every product. What a model must not learn from is dealt with here, before
   any model sees it.

   OUTLIERS
   A day counts for no more than a cap worked out from the product's own
   history:

       cap = the larger of 5, and 4 x its typical selling day

   where "typical" is the quantity the product reaches or stays under on three
   of every four days it sells (the 75th percentile of its selling days). A
   product with fewer than 5 selling days cannot say what is typical for it,
   so it is judged by the same figure taken across the whole shop.

   The rule was chosen on the shop's own sales: it clips 6 of 3,971 selling
   days (0.3% of the items sold), leaves a lasting change of level alone, and
   brings a day of 10,000 in a product that sells 1 a day down to 5. The
   percentile is used instead of the average because a single extreme day
   drags an average, and a standard deviation, up with it.

   NEW PRODUCTS
   A daily rate cannot be read from a handful of days. A product that sold 5
   on its first day used to be forecast at 5 a day: 150 in the next 30 days,
   with an order suggested for 165.

   Until a product has 14 days on record, counted from its first sale, no
   trend, day-of-week pattern or model is fitted to it. What it has sold so
   far is spread over 14 days, not over the days it has existed:

       daily rate = items sold so far / 14

   One sale of 5 gives 0.36 a day, about 11 in 30 days. The estimate rises as
   more is sold and meets the plain average on day 14, when the ordinary
   forecast takes over. Such a forecast is marked "new" so the page can say
   it is a first estimate.

   DAYS WITHOUT DATA
   A day on which no item was sold is normally a real zero, and the forecast
   should learn from it. Two kinds of empty day are not evidence of demand:

     - days on which sales were recorded but none of them has its items
       (the records are incomplete: money was taken, nobody knows for what)
     - three or more empty days in a row with no sale at all (the shop was
       closed, or nothing was being recorded)

   A run of empty days is left out when it holds either. The days are dropped
   from every product's history before any model sees them, so the forecast
   neither learns "nothing sells" from them nor counts them when it measures
   recent sales. A run that reaches the last day on record is kept: recent
   silence may be real, and the page already says when the last sale was.
   Nothing in the database is changed; the days are only skipped when read.

   FREAK DAYS FOR THE WHOLE SHOP
   The cap above works product by product. A day on which the whole shop sells
   many times its usual passes straight through it: every product is a little
   above its own usual, none far enough to be capped, and together they bend
   the forecast of everything (7 Nov 2026: 618 items in one day against a
   usual busy day of 17; the forecast for the next 30 days went from about 650
   to 3,262, and to 13,350 the day after it happened).

   A day is a freak when the shop sold more than

       the larger of 20 items, and 4 x its usual busy day

   where the usual busy day is what the shop reached or stayed under on three
   of every four of its last 28 selling days before that day. Nothing is judged
   until the shop has 14 selling days behind it. One or two such days in a row
   are left out of every product's history, like the days without data. Three
   or more selling days in a row above the line are not a freak but a new
   level, and all of them are kept: the forecast has to learn from that.
   Only days before the one being judged are used, so the accuracy test never
   looks ahead. */

const MIN_CAP = 5;
const FREAK_TIMES = 4;
const FREAK_MIN_ITEMS = 20;
const FREAK_LOOKBACK = 28;
const FREAK_MIN_DAYS = 14;
const FREAK_MAX_RUN = 2;
const CAP_TIMES = 4;
const TYPICAL_QUANTILE = 0.75;
const MIN_SELLING_DAYS = 5;
const MIN_HISTORY_DAYS = 14;
const CLOSED_RUN_DAYS = 3;
const DAY_MS = 86400000;

/** The value at this fraction of the way through a sorted list, never interpolated upward. */
function lowQuantile(sorted, fraction) {
    return sorted[Math.floor(fraction * (sorted.length - 1))];
}

/** The typical quantity on a selling day, across every product given. */
function shopTypical(seriesList) {
    const sold = [];
    for (const series of seriesList) for (const p of series) if (p.quantity > 0) sold.push(p.quantity);
    if (!sold.length) return 1;
    sold.sort((a, b) => a - b);
    return lowQuantile(sold, TYPICAL_QUANTILE);
}

/** The most one day counts for, for a product with this history. */
function dailyCap(series, shopTypicalQty = 1) {
    const sold = series.map(p => p.quantity).filter(q => q > 0).sort((a, b) => a - b);
    const typical = sold.length >= MIN_SELLING_DAYS ? lowQuantile(sold, TYPICAL_QUANTILE) : shopTypicalQty;
    return Math.max(MIN_CAP, CAP_TIMES * typical);
}

/**
 * The series with any day over the cap brought down to it.
 * The cap comes from the series it is given, so a forecast made from part of a
 * history (the accuracy test) is never capped using days it has not seen.
 */
function capSeries(series, shopTypicalQty = 1) {
    const cap = dailyCap(series, shopTypicalQty);
    let clipped = 0;
    const out = series.map(p => (p.quantity > cap ? (clipped++, { date: p.date, quantity: cap }) : p));
    return { series: clipped ? out : series, cap, clipped };
}

/** True while a product has too few days on record to read a rate from. */
function isNewProduct(series) {
    return series.length < MIN_HISTORY_DAYS;
}

/** The cautious daily rate for a new product: what it has sold so far, spread over MIN_HISTORY_DAYS. */
function cautiousDailyRate(series) {
    return series.reduce((total, p) => total + p.quantity, 0) / MIN_HISTORY_DAYS;
}

/**
 * The days to leave out of every product's history.
 *   soldByDay   Map of shop day -> items sold that day, all products together
 *   salesByDay  Map of shop day -> completed sales recorded that day, with or without items
 *   firstDay, lastDay   the span to look at, as 'YYYY-MM-DD'
 * Returns { days: Set, ranges: [{ from, to, days, sales, reason }] } where
 * reason is 'no_items' or 'closed'.
 */
function noDataDays(soldByDay, salesByDay, firstDay, lastDay) {
    const out = { days: new Set(), ranges: [] };
    if (!firstDay || !lastDay || firstDay > lastDay) return out;
    const endMs = Date.parse(lastDay + 'T00:00:00Z');
    let run = [];
    const close = (reachesEnd) => {
        if (run.length && !reachesEnd) {
            const sales = run.reduce((a, d) => a + (Number(salesByDay.get(d)) || 0), 0);
            const reason = sales > 0 ? 'no_items' : run.length >= CLOSED_RUN_DAYS ? 'closed' : null;
            if (reason) {
                run.forEach(d => out.days.add(d));
                out.ranges.push({ from: run[0], to: run[run.length - 1], days: run.length, sales, reason });
            }
        }
        run = [];
    };
    for (let t = Date.parse(firstDay + 'T00:00:00Z'); t <= endMs; t += DAY_MS) {
        const day = new Date(t).toISOString().slice(0, 10);
        if ((Number(soldByDay.get(day)) || 0) > 0) close(false);
        else run.push(day);
    }
    close(true);
    return out;
}

/**
 * Days on which the whole shop sold far more than its usual busy day.
 *   soldByDay  Map of shop day -> items sold that day, all products together
 *   firstDay, lastDay   the span to look at, as 'YYYY-MM-DD'
 * Returns { days: Set, ranges: [{ from, to, days, items, typical, reason: 'freak' }] }.
 * `typical` is the usual busy day the first day of the run was judged against.
 */
function freakDays(soldByDay, firstDay, lastDay) {
    const out = { days: new Set(), ranges: [] };
    if (!firstDay || !lastDay || firstDay > lastDay) return out;
    const endMs = Date.parse(lastDay + 'T00:00:00Z');
    const before = [];          // what the shop sold on each selling day so far
    let run = [];               // selling days in a row above the line
    const close = () => {
        if (run.length && run.length <= FREAK_MAX_RUN) {
            run.forEach(r => out.days.add(r.day));
            out.ranges.push({
                from: run[0].day, to: run[run.length - 1].day, days: run.length,
                items: run.reduce((a, r) => a + r.items, 0), typical: run[0].typical, reason: 'freak'
            });
        }
        run = [];
    };
    for (let t = Date.parse(firstDay + 'T00:00:00Z'); t <= endMs; t += DAY_MS) {
        const day = new Date(t).toISOString().slice(0, 10);
        const items = Number(soldByDay.get(day)) || 0;
        if (!(items > 0)) continue;     // a day with no sale neither ends a run nor says what is usual
        if (before.length >= FREAK_MIN_DAYS) {
            const typical = lowQuantile(before.slice(-FREAK_LOOKBACK).sort((a, b) => a - b), TYPICAL_QUANTILE);
            if (items > Math.max(FREAK_MIN_ITEMS, FREAK_TIMES * typical)) run.push({ day, items, typical });
            else close();
        }
        before.push(items);
    }
    close();
    return out;
}

module.exports = { shopTypical, dailyCap, capSeries, lowQuantile, isNewProduct, cautiousDailyRate, noDataDays, freakDays, MIN_CAP, CAP_TIMES, MIN_SELLING_DAYS, MIN_HISTORY_DAYS, CLOSED_RUN_DAYS, FREAK_TIMES, FREAK_MIN_ITEMS, FREAK_LOOKBACK, FREAK_MIN_DAYS, FREAK_MAX_RUN };
