/* The last step of the forecast: correcting for how far off it has just been.

   Every forecast here reads a product's level from its recent weeks, so when
   the shop's sales are falling it runs high, and when they are rising it runs
   low, by about as much as sales moved while it was looking. In testing on
   held-out fortnights the forecast was above what sold in every one of them
   while sales fell fortnight after fortnight.

   The system already checks itself each time it runs: it hides the last 14
   days, forecasts them from the days before, and compares. That comparison
   says how far off the same method was, most recently, on days it had not
   seen. The live forecast is corrected by half of that:

       factor = 1 + 0.5 x (sold / forecast - 1)       kept between 0.6 and 1.4

   So if the method forecast 100 for the last fortnight and 80 sold, the next
   forecast is multiplied by 0.9. Half, not all: one fortnight's miss is partly
   chance, and correcting all of it makes the forecast swing.

   The factor is worked out for each product category, because categories do
   not all move together. A category that sold fewer than 20 items in the test
   fortnight is too thin to judge and takes the whole shop's factor; if the
   whole shop sold fewer than 20, nothing is adjusted.

   Nothing here looks ahead. The factor for a forecast made today comes only
   from days already past. When the accuracy test scores the page's forecast
   for the last fortnight, that forecast is corrected with the factor from the
   fortnight before it, exactly as it would have been at the time. */

const ADJUST = {
    strength: 0.5,     // how much of the last miss is corrected
    min: 0.6,          // the factor never goes below this
    max: 1.4,          // ... or above this
    minUnits: 20       // items a category (or the shop) must have sold in the test fortnight to be judged
};

function factorOf(forecast, sold, tune = ADJUST) {
    if (!(forecast > 0) || !(sold >= tune.minUnits)) return null;
    return Math.min(tune.max, Math.max(tune.min, 1 + tune.strength * (sold / forecast - 1)));
}

/**
 * The correction factors one test fortnight gives.
 *   rows  [{ group, forecast, sold }]  one per product: what was forecast for the
 *         hidden days (before any correction) and what sold on them
 * Returns { shop, groups: { name: factor }, detail: [{ group, forecast, sold, factor, own }] }.
 * A group without enough sales takes the shop's factor ("own" is false).
 */
function errorFactors(rows, tune = ADJUST) {
    let F = 0, S = 0;
    const by = new Map();
    for (const r of rows || []) {
        const forecast = Number(r.forecast) || 0, sold = Number(r.sold) || 0;
        F += forecast; S += sold;
        const key = r.group == null ? '' : String(r.group);
        const g = by.get(key) || { forecast: 0, sold: 0 };
        g.forecast += forecast; g.sold += sold;
        by.set(key, g);
    }
    const shop = factorOf(F, S, tune) ?? 1;
    const groups = {}, detail = [];
    for (const [group, g] of by) {
        const own = factorOf(g.forecast, g.sold, tune);
        groups[group] = own ?? shop;
        detail.push({ group, forecast: Math.round(g.forecast * 10) / 10, sold: Math.round(g.sold * 10) / 10, factor: Math.round(groups[group] * 1000) / 1000, own: own !== null });
    }
    return { shop, groups, detail };
}

/** The factor for a product in this group; the shop's when the group is unknown; 1 when there are no factors. */
function factorFor(factors, group) {
    if (!factors) return 1;
    const key = group == null ? '' : String(group);
    return Object.prototype.hasOwnProperty.call(factors.groups, key) ? factors.groups[key] : factors.shop;
}

module.exports = { ADJUST, errorFactors, factorFor };
