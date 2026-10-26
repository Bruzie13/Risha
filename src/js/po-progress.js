/* Where an order is in its life: four steps joined by a line, the ones done
   ticked, the current one ringed. Shown on the Dashboard's Purchase orders,
   a supplier's Performance window, the Orders view and the Supplier Portal.
   An offer from a supplier starts at "Offered" instead of "Pending": it
   becomes a confirmed order when the shop accepts it. A cancelled order is
   not on that road, so it says so in words. */
const PO_STEPS = [['pending', 'Pending'], ['confirmed', 'Confirmed'], ['shipped', 'Shipped'], ['received', 'Received']];
function poProgressHtml(status) {
    if (status === 'cancelled') return '<div class="po-progress po-progress-note cancelled">Cancelled</div>';
    const offer = status === 'proposed';
    const steps = offer ? [['proposed', 'Offered']].concat(PO_STEPS.slice(1)) : PO_STEPS;
    const at = steps.findIndex(s => s[0] === status);
    if (at < 0) return '';
    const done = k => k < at || status === 'received';
    const label = offer ? 'Offered by the supplier, waiting for the shop to accept' : `${steps[at][1]}, step ${at + 1} of 4`;
    return `<div class="po-progress" role="img" aria-label="Order progress: ${label}">`
        + steps.map(([, name], k) => `<span class="po-step ${done(k) ? 'done' : k === at ? 'now' : ''}" aria-hidden="true"><span class="po-dot">${done(k) ? '✓' : ''}</span>${name}</span>`).join('')
        + '</div>';
}
