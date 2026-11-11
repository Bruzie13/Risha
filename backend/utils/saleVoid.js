/* Voiding part of a sale (Ms Mel, 12 Nov: "sa void, dapat may ilalagay kung
   ilan ibabalik na product para ayun lang ibabawas sa sales"; Carlo: two
   products ordered, only one voided).

   items      the sale's lines: [{ id, product_id, product_name, quantity, unit_price }]
   requested  what to void: [{ id, quantity }] (a line left out voids none of it)
   discount   the sale's discount in percent

   Returns { error } or
   { whole, lines: [{ id, product_id, product_name, quantity, left, unit_price, amount }],
     removed, total, final } where total and final are the sale's amounts after
   the void (before and after its discount). `whole` is true when every item
   of every line is voided: then the sale is voided as a whole, as before. */
function planVoid(items, requested, discount = 0) {
    const lines = Array.isArray(items) ? items : [];
    if (!lines.length) return { error: 'This sale has no items to void.' };
    if (!Array.isArray(requested) || !requested.length) return { error: 'Choose how many of each item to void.' };
    const byId = new Map(lines.map(l => [Number(l.id), l]));
    const want = new Map();
    for (const r of requested) {
        const id = Number(r && r.id);
        const text = String(r && r.quantity != null ? r.quantity : '').trim();
        if (!byId.has(id)) return { error: 'That item is not on this sale.' };
        if (want.has(id)) return { error: 'Each item can appear once.' };
        if (!/^\d+$/.test(text)) return { error: 'Type how many to void as a whole number, like 1.' };
        const q = Number(text), sold = Number(byId.get(id).quantity);
        if (q > sold) return { error: `Only ${sold} of ${byId.get(id).product_name || 'that item'} ${sold === 1 ? 'was' : 'were'} sold, so no more than ${sold} can be voided.` };
        want.set(id, q);
    }
    const out = [];
    let removed = 0, total = 0, voidedUnits = 0, soldUnits = 0;
    for (const l of lines) {
        const sold = Number(l.quantity), price = Number(l.unit_price) || 0, q = want.get(Number(l.id)) || 0;
        soldUnits += sold; voidedUnits += q;
        total += (sold - q) * price;
        if (q > 0) {
            const amount = Math.round(q * price * 100) / 100;
            removed += amount;
            out.push({ id: Number(l.id), product_id: Number(l.product_id), product_name: l.product_name, quantity: q, left: sold - q, unit_price: price, amount });
        }
    }
    if (!voidedUnits) return { error: 'Set at least one item to void.' };
    const pct = Math.max(0, Math.min(100, Number(discount) || 0));
    total = Math.round(total * 100) / 100;
    const final = Math.round(Math.max(0, total - total * pct / 100) * 100) / 100;
    return { whole: voidedUnits === soldUnits, lines: out, removed: Math.round(removed * 100) / 100, total, final };
}

module.exports = { planVoid };
