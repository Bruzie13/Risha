/* The SKU pattern: a product-type code, a dash and the shop's running number,
   for example DRY-121. It is the pattern the shop's SKUs already followed
   (DRY-002 … CAT-120), now made by the system instead of typed: the user
   chooses the type, the number is the next one after the highest on record,
   and a SKU never changes once the product is saved. */

const SKU_TYPES = [
    ['DRY', 'Dry food'],
    ['WET', 'Wet food'],
    ['SUP', 'Supplements'],
    ['GRO', 'Grooming'],
    ['LIT', 'Litter'],
    ['TOY', 'Toys'],
    ['CAG', 'Cages'],
    ['ACC', 'Accessories']
];
const CODES = new Set(SKU_TYPES.map(([code]) => code));

// a SKU of the pattern: three capital letters, a dash, three or more digits
const SKU_PATTERN = /^[A-Z]{3}-\d{3,}$/;

function skuTypeProblem(type) {
    if (type == null || String(type).trim() === '') return 'Choose the product type. The SKU is made from it.';
    if (!CODES.has(String(type).trim())) return 'Choose the product type from the list.';
    return null;
}

// the SKU for a type and a running number, the number at least three digits
function skuFor(type, number) {
    return String(type).trim() + '-' + String(number).padStart(3, '0');
}

module.exports = { SKU_TYPES, SKU_PATTERN, skuTypeProblem, skuFor };
