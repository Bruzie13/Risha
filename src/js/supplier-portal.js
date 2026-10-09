/* Supplier page. Everything shown here comes from /api/supplier-portal, which
   the server limits to the one supplier this login belongs to. */

const PORTAL_API = `${API_BASE}/supplier-portal`;

const ORDER_STATUS = {
    pending: { text: 'Waiting for you to confirm', tone: 'warning' },
    confirmed: { text: 'Confirmed — not shipped yet', tone: 'warning' },
    shipped: { text: 'Shipped', tone: 'ok' },
    received: { text: 'Received by the shop', tone: 'ok' },
    cancelled: { text: 'Cancelled', tone: 'danger' }
};
// The one step a supplier can take from each state.
const NEXT_STEP = {
    pending: { to: 'confirmed', label: 'Confirm order', ask: 'Confirm that you accept this order?' },
    confirmed: { to: 'shipped', label: 'Mark as shipped', ask: 'Mark this order as shipped? The shop will be told it is on the way.' }
};

window.addEventListener('load', () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    document.getElementById('openOrdersBody').addEventListener('click', e => {
        const btn = e.target.closest('button[data-order]');
        if (btn) advanceOrder(Number(btn.dataset.order), btn.dataset.status);
    });
    loadPortal();
});

function portalDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function portalRow(id, cols, text) {
    document.getElementById(id).innerHTML = `<tr><td colspan="${cols}" class="rp-loading">${escHtml(text)}</td></tr>`;
}

async function portalGet(path) {
    const res = await fetch(PORTAL_API + path, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Request failed');
    return data.data;
}

async function loadPortal() {
    const notice = document.getElementById('portalNotice');
    try {
        const [me, products, orders] = await Promise.all([portalGet('/me'), portalGet('/products'), portalGet('/orders')]);
        notice.hidden = true;
        renderDetails(me);
        renderProducts(products);
        renderOrders(orders);
    } catch (error) {
        console.error('Supplier page failed to load:', error);
        notice.textContent = error.message && error.message !== 'Request failed'
            ? error.message
            : 'This page could not be loaded. Please try again in a moment.';
        notice.hidden = false;
        portalRow('openOrdersBody', 5, 'Nothing to show.');
        portalRow('productsBody', 5, 'Nothing to show.');
        portalRow('pastOrdersBody', 4, 'Nothing to show.');
    }
}

function renderDetails(me) {
    document.getElementById('supplierName').textContent = me.name || 'Supplier';
    const rows = [
        ['Company', me.name], ['Contact person', me.contact_person], ['Email', me.email], ['Phone', me.phone],
        ['Address', [me.address, me.city].filter(Boolean).join(', ')], ['Payment terms', me.payment_terms]
    ];
    document.getElementById('supplierDetails').innerHTML = rows.map(([label, value]) => `
        <div class="rp-detail-item">
            <span class="rp-detail-label">${escHtml(label)}</span>
            <span class="rp-detail-value">${value ? escHtml(value) : '—'}</span>
        </div>`).join('');
}

function renderProducts(products) {
    document.getElementById('figProducts').textContent = formatNumber(products.length);
    const low = products.filter(p => Number(p.stock_quantity) <= Number(p.reorder_level));
    document.getElementById('figLow').textContent = formatNumber(low.length);
    if (!products.length) { portalRow('productsBody', 5, 'No products are assigned to you yet.'); return; }
    const status = p => {
        const stock = Number(p.stock_quantity), level = Number(p.reorder_level);
        if (stock <= 0) return '<span class="rp-badge rp-badge-danger">Out of stock</span>';
        if (stock <= level) return '<span class="rp-badge rp-badge-warning">Running low</span>';
        return '<span class="rp-badge rp-badge-ok">Enough stock</span>';
    };
    // what the shop is short of comes first
    const ordered = [...products].sort((a, b) =>
        (Number(a.stock_quantity) - Number(a.reorder_level)) - (Number(b.stock_quantity) - Number(b.reorder_level)));
    document.getElementById('productsBody').innerHTML = ordered.map(p => `
        <tr>
            <td><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td>${escHtml(p.category || '—')}</td>
            <td class="num">${formatQty(p.stock_quantity)}</td>
            <td class="num">${formatQty(p.reorder_level)}</td>
            <td>${status(p)}</td>
        </tr>`).join('');
}

function orderCells(o) {
    const items = (o.items || []).map(i => `${escHtml(formatQty(i.quantity))} × ${escHtml(i.name)}`);
    const shown = items.slice(0, 4).join('<br>') + (items.length > 4 ? `<span class="rp-sub">and ${items.length - 4} more</span>` : '');
    const when = [o.order_date ? `Ordered ${portalDate(o.order_date)}` : '',
                  o.expected_delivery_date ? `wanted by ${portalDate(o.expected_delivery_date)}` : ''].filter(Boolean).join(', ');
    const s = ORDER_STATUS[o.status] || { text: o.status, tone: 'ok' };
    return `
        <td><span class="rp-strong">${escHtml(o.po_number)}</span>${when ? `<span class="rp-sub">${escHtml(when)}</span>` : ''}</td>
        <td>${shown || '—'}</td>
        <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
        <td><span class="rp-badge rp-badge-${s.tone}">${escHtml(s.text)}</span></td>`;
}

function renderOrders(orders) {
    const open = orders.filter(o => ['pending', 'confirmed', 'shipped'].includes(o.status));
    const past = orders.filter(o => !['pending', 'confirmed', 'shipped'].includes(o.status));
    document.getElementById('figWaiting').textContent = formatNumber(open.filter(o => NEXT_STEP[o.status]).length);
    document.getElementById('figShipped').textContent = formatNumber(open.filter(o => o.status === 'shipped').length);

    if (!open.length) portalRow('openOrdersBody', 5, 'No open orders right now.');
    else document.getElementById('openOrdersBody').innerHTML = open.map(o => {
        const step = NEXT_STEP[o.status];
        return `<tr>${orderCells(o)}<td class="num">${step
            ? `<button class="btn-primary" data-order="${Number(o.id)}" data-status="${step.to}">${step.label}</button>`
            : ''}</td></tr>`;
    }).join('');

    if (!past.length) portalRow('pastOrdersBody', 4, 'No past orders yet.');
    else document.getElementById('pastOrdersBody').innerHTML = past.map(o => `<tr>${orderCells(o)}</tr>`).join('');
}

function advanceOrder(id, status) {
    const step = Object.values(NEXT_STEP).find(s => s.to === status);
    if (!step) return;
    showConfirmDialog(step.label, step.ask, async () => {
        try {
            const res = await fetch(`${PORTAL_API}/orders/${id}/status`, {
                method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ status })
            });
            const data = await res.json();
            if (!data.success) { showToast(data.message || 'The order could not be updated', 'error'); return; }
            showToast(data.message || 'Order updated', 'success');
            loadPortal();
        } catch (error) {
            console.error('Order update failed:', error);
            showToast('The order could not be updated', 'error');
        }
    }, step.label);
}
