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
   drags an average, and a standard deviation, up with it. */

const MIN_CAP = 5;
const CAP_TIMES = 4;
const TYPICAL_QUANTILE = 0.75;
const MIN_SELLING_DAYS = 5;

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

module.exports = { shopTypical, dailyCap, capSeries, lowQuantile, MIN_CAP, CAP_TIMES, MIN_SELLING_DAYS };
