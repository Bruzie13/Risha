/* What a product needs before it can be saved.

   A product with no name, no price, no category or no supplier is not one the
   shop can use: it cannot be found, sold or reordered. These are checked when
   a product is added (one at a time or from a file), and again for whichever
   of them an edit touches. The barcode and picture tools send a single field,
   so an edit is only judged on the fields it actually carries. */

const IMPORTANT = [['sku', 'SKU'], ['name', 'Product name'], ['category_id', 'Category'], ['unit_price', 'Unit price'], ['supplier_id', 'Supplier']];
const NOT_NEGATIVE = [['cost_price', 'Cost price'], ['stock_quantity', 'Stock quantity'], ['reorder_level', 'Reorder level'], ['max_stock_level', 'Max stock level']];

const blank = v => v == null || String(v).trim() === '';

/**
 * `adding` is true for a new product: every important field must be there.
 * `activeSupplierIds` is a Set of the ids of suppliers still on the shop's list.
 * Returns the reason the product cannot be saved, or null.
 */
function productProblem(data, adding, activeSupplierIds) {
    const d = data || {};
    const sent = k => Object.prototype.hasOwnProperty.call(d, k);
    const checked = k => adding || sent(k);

    const missing = IMPORTANT.filter(([k]) => checked(k) && blank(d[k])).map(([, label]) => label);
    if (missing.length) return `Fill in ${missing.length === 1 ? 'this' : 'these'} first: ${missing.join(', ')}.`;

    if (checked('unit_price') && !(Number(d.unit_price) > 0)) return 'Unit price must be more than zero.';
    if (checked('category_id') && !(Number.isInteger(Number(d.category_id)) && Number(d.category_id) > 0)) return 'Choose a category from the list.';
    for (const [k, label] of NOT_NEGATIVE) {
        if (sent(k) && !blank(d[k]) && !(Number(d[k]) >= 0)) return `${label} cannot be less than zero.`;
    }
    if (checked('supplier_id') && !(activeSupplierIds && activeSupplierIds.has(Number(d.supplier_id)))) {
        return 'Choose a supplier from the list. A product needs a supplier so it can be reordered.';
    }
    return null;
}

module.exports = { productProblem };
