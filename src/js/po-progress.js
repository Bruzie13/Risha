/* Where an order is in its life: four steps joined by a line. Every step
   that has happened is ticked, and the next one (what the order is waiting
   for) is ringed, so a shipped order reads Ordered ✓ Confirmed ✓ Shipped ✓
   and then Received, ringed, matching its "Receive into stock" button.
   Shown on the Dashboard's Purchase orders, a supplier's Performance window,
   the Orders view and the Supplier Portal. An offer from a supplier starts
   at "Offered" and waits to be accepted (Confirmed). A cancelled order is
   not on that road, so it says so in words. */
const PO_STEPS = [['pending', 'Ordered'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['received', 'Received']];
function poProgressHtml(status) {
    if (status === 'cancelled') return '<div class="po-progress po-progress-note cancelled">Cancelled</div>';
    const steps = status === 'proposed' ? [['proposed', 'Offered']].concat(PO_STEPS.slice(1)) : PO_STEPS;
    const at = steps.findIndex(s => s[0] === status);
    if (at < 0) return '';
    const next = steps[at + 1];
    const label = steps[at][1] + (next ? ', waiting to be ' + next[1].toLowerCase() : ', done');
    return `<div class="po-progress" role="img" aria-label="Order progress: ${label}">`
        + steps.map(([, name], k) => `<span class="po-step ${k <= at ? 'done' : k === at + 1 ? 'now' : ''}" aria-hidden="true"><span class="po-dot">${k <= at ? '✓' : ''}</span>${name}</span>`).join('')
        + '</div>';
}
