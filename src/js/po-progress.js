/* Where an order is in its life: four steps joined by a line, the ones done
   ticked, the current one ringed. Shown on the Dashboard's Purchase orders
   and in a supplier's Performance window. An offer from a supplier and a cancelled
   order are not on that road, so they say so in words instead. */
const PO_STEPS = [['pending', 'Pending'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['received', 'Received']];
function poProgressHtml(status) {
    if (status === 'proposed') return '<div class="po-progress po-progress-note">Offer from the supplier, waiting for your answer</div>';
    if (status === 'cancelled') return '<div class="po-progress po-progress-note cancelled">Cancelled</div>';
    const at = PO_STEPS.findIndex(s => s[0] === status);
    if (at < 0) return '';
    const done = k => k < at || status === 'received';
    return `<div class="po-progress" role="img" aria-label="Order progress: ${PO_STEPS[at][1]}, step ${at + 1} of 4">`
        + PO_STEPS.map(([, name], k) => `<span class="po-step ${done(k) ? 'done' : k === at ? 'now' : ''}" aria-hidden="true"><span class="po-dot">${done(k) ? '✓' : ''}</span>${name}</span>`).join('')
        + '</div>';
}
