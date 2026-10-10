/* The lines of a sale, as the server accepts them.

   The till sends one line per product. Nothing stops a request from carrying
   the same product on two lines, and the stock check used to look at each line
   by itself: two lines of 16 for a product with 20 in stock both passed, and
   the sale would have left the stock at minus 12. Lines for the same product
   are therefore added together first, so the check sees the whole quantity. */

/* A number as the till sends it: a number, or digits in text. Number() alone
   also reads a list of one ([3]) as 3, so a line with a list for its quantity
   was sold as if it were a number. */
const asNumber = v => ((typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN);

/** Why a line cannot be sold, or null. */
function lineProblem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Each item must have a product and a quantity';
    const id = asNumber(item.product_id);
    if (!Number.isInteger(id) || id <= 0) return 'Each item must have a valid product';
    const qty = asNumber(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
        return 'Each item needs a quantity above zero, as a number';
    }
    return null;
}

/** One line per product, quantities added up, in the order the products first appear. */
function mergeLines(items) {
    const byProduct = new Map();
    for (const item of items) {
        const id = Number(item.product_id);
        const seen = byProduct.get(id);
        if (seen) seen.quantity = Math.round((seen.quantity + Number(item.quantity)) * 1000) / 1000;
        else byProduct.set(id, { ...item, product_id: id, quantity: Number(item.quantity) });
    }
    return [...byProduct.values()];
}

module.exports = { lineProblem, mergeLines };
