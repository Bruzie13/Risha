/* What a product needs before it can be saved.

   A product with no name, no price, no category or no supplier is not one the
   shop can use: it cannot be found, sold or reordered. These are checked when
   a product is added (one at a time or from a file), and again for whichever
   of them an edit touches. The barcode and picture tools send a single field,
   so an edit is only judged on the fields it actually carries. */

const IMPORTANT = [['sku', 'SKU'], ['name', 'Product name'], ['category_id', 'Category'], ['unit_price', 'Unit price'], ['supplier_id', 'Supplier']];
const NOT_NEGATIVE = [['cost_price', 'Cost price'], ['stock_quantity', 'Stock quantity'], ['reorder_level', 'Reorder level'], ['max_stock_level', 'Max stock level']];
// What each column can hold. A value past these used to pass every check and
// then be refused by the database with a general error.
const LONGEST = [['sku', 'SKU', 50], ['name', 'Product name', 100], ['brand', 'Brand', 50], ['barcode', 'Barcode', 100], ['batch_number', 'Batch number', 100],
    ['species', 'Species', 50], ['breed_size', 'Breed size', 20], ['age_group', 'Age group', 20], ['health_category', 'Health category', 50]];
const LARGEST = [['unit_price', 'Unit price', 99999999.99], ['cost_price', 'Cost price', 99999999.99], ['stock_quantity', 'Stock quantity', 9999999.999],
    ['reorder_level', 'Reorder level', 1000000], ['max_stock_level', 'Max stock level', 1000000]];
const WHOLE = [['reorder_level', 'Reorder level'], ['max_stock_level', 'Max stock level']];
const UNIT_TYPES = ['piece', 'kg', 'g', 'liter', 'ml'];

// every field named above, once, with its label
const FIELDS = [...new Map([...IMPORTANT, ...NOT_NEGATIVE, ...LONGEST, ...LARGEST, ['unit_type', 'Unit']].map(([k, label]) => [k, [k, label]])).values()];

const blank = v => v == null || String(v).trim() === '';

/* A barcode is taken as it is printed on the product: makers use different
   kinds (EAN, UPC, their own codes with letters), so there is no rule on its
   length or digits beyond fitting the column (100 characters, checked with
   the other lengths below). It only has to be the product's own: the same
   barcode on two products is refused where the product is saved. */
function barcodeProblem(value, previous) {
    if (value == null || String(value).trim() === '') return null;
    if (previous != null && String(value).trim() === String(previous).trim()) return null;
    if (/[\u0000-\u001F]/.test(String(value))) return 'The barcode has a character that cannot be printed. Scan it or type it again.';
    return null;
}

/**
 * `adding` is true for a new product: every important field must be there.
 * `activeSupplierIds` is a Set of the ids of suppliers still on the shop's list.
 * `previous` is the product as it is now, for an edit.
 * Returns the reason the product cannot be saved, or null.
 */
function productProblem(data, adding, activeSupplierIds, previous) {
    const d = data || {};
    const sent = k => Object.prototype.hasOwnProperty.call(d, k);
    const checked = k => adding || sent(k);

    // Each field is one value. A list in its place used to pass (Number([5])
    // is 5) and then fail with a general error when the row was written.
    const odd = FIELDS.find(([k]) => sent(k) && d[k] !== null && typeof d[k] === 'object');
    if (odd) return `${odd[1]} has to be a single value.`;

    const missing = IMPORTANT.filter(([k]) => checked(k) && blank(d[k])).map(([, label]) => label);
    if (missing.length) return `Fill in ${missing.length === 1 ? 'this' : 'these'} first: ${missing.join(', ')}.`;

    if (checked('unit_price') && !(Number(d.unit_price) > 0)) return 'Unit price must be more than zero.';
    if (checked('category_id') && !(Number.isInteger(Number(d.category_id)) && Number(d.category_id) > 0)) return 'Choose a category from the list.';
    for (const [k, label] of NOT_NEGATIVE) {
        if (sent(k) && !blank(d[k]) && !(Number(d[k]) >= 0)) return `${label} cannot be less than zero.`;
    }
    for (const [k, label, max] of LONGEST) {
        if (sent(k) && !blank(d[k]) && String(d[k]).length > max) return `${label} is too long (${max} characters at most).`;
    }
    for (const [k, label, max] of LARGEST) {
        if (sent(k) && !blank(d[k]) && Number(d[k]) > max) return `${label} is too large (${max.toLocaleString('en-US')} at most).`;
    }
    for (const [k, label] of WHOLE) {
        if (sent(k) && !blank(d[k]) && !Number.isInteger(Number(d[k]))) return `${label} has to be a whole number.`;
    }
    if (sent('unit_type') && !blank(d.unit_type) && !UNIT_TYPES.includes(d.unit_type)) return 'Choose the unit from the list (piece, kg, g, liter or ml).';
    // a new SKU and any barcode have to be plain codes (an older SKU is left as it is)
    if (adding && !blank(d.sku) && !/^[A-Za-z0-9._\-/]+$/.test(String(d.sku).trim())) return 'The SKU can use letters, numbers and - _ . / only, with no spaces.';
    if (sent('barcode')) {
        const codeIssue = barcodeProblem(d.barcode, previous && previous.barcode);
        if (codeIssue) return codeIssue;
    }
    // values that are judged against each other, when both are sent
    if (sent('cost_price') && sent('unit_price') && !blank(d.cost_price) && Number(d.cost_price) > Number(d.unit_price)) {
        return `The cost price (₱${Number(d.cost_price).toFixed(2)}) is higher than the unit price (₱${Number(d.unit_price).toFixed(2)}): the shop would lose money on each sale.`;
    }
    if (sent('max_stock_level') && sent('reorder_level') && !blank(d.max_stock_level) && Number(d.max_stock_level) > 0 && !blank(d.reorder_level)
        && Number(d.max_stock_level) <= Number(d.reorder_level)) {
        return `The max stock level has to be higher than the reorder level (${Number(d.reorder_level)}).`;
    }
    if (checked('supplier_id') && !(activeSupplierIds && activeSupplierIds.has(Number(d.supplier_id)))) {
        return 'Choose a supplier from the list. A product needs a supplier so it can be reordered.';
    }
    return null;
}

/* A stock change made by hand.

   Only "in" adds; the other three kinds take stock off the shelf (taken out,
   counted lower than the system said, damaged). The kind has to be one of the
   four: anything else used to be treated as a removal and then fail when its
   history row was written. The quantity has to be a number above zero that
   the stock column can hold. */
const STOCK_CHANGES = ['in', 'out', 'adjustment', 'damage'];
const MAX_STOCK = 9999999.999;

function stockChangeProblem(quantity, kind) {
    if (!STOCK_CHANGES.includes(kind)) return 'Choose what kind of change this is: stock added, taken out, counted lower, or damaged.';
    if (quantity === null || quantity === undefined || quantity === '' || typeof quantity === 'boolean') return 'Enter the quantity.';
    // a number, or digits in text: Number() alone reads a list of one as its item
    const n = (typeof quantity === 'number' || typeof quantity === 'string') ? Number(quantity) : NaN;
    if (!Number.isFinite(n) || n <= 0) return 'The quantity has to be a number above zero.';
    if (n > MAX_STOCK) return 'That quantity is larger than the system can hold.';
    return null;
}

module.exports = { productProblem, barcodeProblem, stockChangeProblem, STOCK_CHANGES, MAX_STOCK };
