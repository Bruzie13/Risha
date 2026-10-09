/* Supplier page. Everything shown here comes from /api/supplier-portal, which
   the server limits to the one supplier this login belongs to. This file only
   presents it and sends back what the supplier types. */

const PORTAL_API = `${API_BASE}/supplier-portal`;
const PAST_PAGE = 10;

let portal = { me: null, products: [], orders: [], score: null };
let pastShown = PAST_PAGE;
const openNotes = new Set();     // order ids whose notes are expanded

const ORDER_STATUS = {
    proposed: { text: 'Offered — waiting for the shop', tone: 'ok' },
    pending: { text: 'Waiting for you to confirm', tone: 'warning' },
    confirmed: { text: 'Confirmed — not shipped yet', tone: 'warning' },
    shipped: { text: 'Shipped', tone: 'ok' },
    received: { text: 'Received by the shop', tone: 'ok' },
    cancelled: { text: 'Cancelled', tone: 'danger' }
};

window.addEventListener('load', () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    document.getElementById('openOrders').addEventListener('click', onOrderClick);
    document.getElementById('openOrders').addEventListener('submit', onNoteSubmit);
    document.getElementById('productsBody').addEventListener('click', e => {
        const btn = e.target.closest('button[data-price]');
        if (btn) openPrice(Number(btn.dataset.price));
    });
    loadPortal();
});

/* ---------- Small helpers ---------- */

function todayYmd() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

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

/** Send something to the server; returns true when it worked, and says why when it did not. */
async function portalSend(method, path, body) {
    try {
        const res = await fetch(PORTAL_API + path, { method, headers: getAuthHeaders(), body: JSON.stringify(body || {}) });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'That could not be saved', 'error'); return false; }
        if (data.message) showToast(data.message, 'success');
        return true;
    } catch (error) {
        console.error('Supplier request failed:', error);
        showToast('That could not be saved', 'error');
        return false;
    }
}

const sendingOf = line => line.confirmed_quantity == null ? Number(line.quantity) : Number(line.confirmed_quantity);
const orderOf = id => portal.orders.find(o => Number(o.id) === Number(id));

/* ---------- Loading ---------- */

async function loadPortal() {
    const notice = document.getElementById('portalNotice');
    try {
        const [me, products, orders, score] = await Promise.all([
            portalGet('/me'), portalGet('/products'), portalGet('/orders'), portalGet('/scorecard')
        ]);
        portal = { me, products, orders, score };
        notice.hidden = true;
        renderDetails();
        renderProducts();
        renderOrders();
        renderPayments();
        renderScorecard();
    } catch (error) {
        console.error('Supplier page failed to load:', error);
        notice.textContent = error.message && error.message !== 'Request failed'
            ? error.message
            : 'This page could not be loaded. Please try again in a moment.';
        notice.hidden = false;
        document.getElementById('openOrders').innerHTML = '<p class="rp-loading">Nothing to show.</p>';
        portalRow('productsBody', 6, 'Nothing to show.');
        portalRow('pastOrdersBody', 4, 'Nothing to show.');
        portalRow('paymentsBody', 4, 'Nothing to show.');
    }
}

/* ---------- Details ---------- */

function renderDetails() {
    const me = portal.me;
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

function openDetails() {
    const me = portal.me || {};
    const field = (id, label, value, max) => `
        <div class="form-group">
            <label class="form-label" for="${id}">${label}</label>
            <input type="text" class="form-input" id="${id}" maxlength="${max}" value="${escHtml(value || '')}">
        </div>`;
    openSpModal('Edit contact details',
        field('spContact', 'Contact person', me.contact_person, 255)
        + field('spPhone', 'Phone', me.phone, 20)
        + field('spAddress', 'Address', me.address, 500)
        + field('spCity', 'City', me.city, 100),
        'Save details',
        async () => portalSend('PUT', '/me', {
            contact_person: document.getElementById('spContact').value,
            phone: document.getElementById('spPhone').value,
            address: document.getElementById('spAddress').value,
            city: document.getElementById('spCity').value
        }));
}

/* ---------- Products and prices ---------- */

function renderProducts() {
    const products = portal.products;
    const low = products.filter(p => Number(p.stock_quantity) <= Number(p.reorder_level));
    document.getElementById('figLow').textContent = formatNumber(low.length);
    if (!products.length) { portalRow('productsBody', 6, 'No products are assigned to you yet.'); return; }
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
            <td><span class="rp-strong">${escHtml(p.name)}</span><span class="rp-sub">${escHtml([p.sku, p.category].filter(Boolean).join(' · '))}</span></td>
            <td class="num">${formatQty(p.stock_quantity)}</td>
            <td class="num">${formatQty(p.reorder_level)}</td>
            <td>${status(p)}</td>
            <td class="num">${p.cost_price != null ? formatCurrency(p.cost_price) : '—'}${p.pending_price != null
                ? `<span class="rp-sub">${formatCurrency(p.pending_price)} proposed, waiting</span>` : ''}</td>
            <td class="num"><button class="btn-view" data-price="${Number(p.id)}">Change price</button></td>
        </tr>`).join('');
}

function openPrice(productId) {
    const p = portal.products.find(x => Number(x.id) === productId);
    if (!p) return;
    openSpModal('Propose a new price',
        `<p class="sp-form-hint"><strong>${escHtml(p.name)}</strong><br>Current price: ${p.cost_price != null ? formatCurrency(p.cost_price) : 'not set'}. The price changes only if the shop accepts.</p>
         <div class="form-group">
            <label class="form-label" for="spPrice">New price (₱)</label>
            <input type="number" class="form-input" id="spPrice" min="0.01" step="0.01" inputmode="decimal" required>
         </div>
         <div class="form-group">
            <label class="form-label" for="spPriceNote">Reason (optional)</label>
            <input type="text" class="form-input" id="spPriceNote" maxlength="300" placeholder="For example: manufacturer price increase">
         </div>`,
        'Send to the shop',
        async () => {
            const price = parseFloat(document.getElementById('spPrice').value);
            if (!(price > 0)) { showToast('Enter a price greater than zero', 'warning'); return false; }
            return portalSend('POST', `/products/${productId}/price`, { price, note: document.getElementById('spPriceNote').value });
        });
}

/* ---------- Orders ---------- */

function orderFacts(o) {
    const facts = [];
    if (o.order_date) facts.push(`Ordered ${escHtml(portalDate(o.order_date))}`);
    if (o.expected_delivery_date && !o.proposed_by_supplier) facts.push(`shop asked for it by ${escHtml(portalDate(o.expected_delivery_date))}`);
    let line = facts.join(', ');
    if (o.promised_date) {
        const late = ['confirmed', 'shipped'].includes(o.status) && o.promised_date < todayYmd();
        line += `<br>You said you will deliver on <strong>${escHtml(portalDate(o.promised_date))}</strong>`
            + (late ? ' <span class="sp-late">— that date has passed</span>' : '')
            + (o.promise_note ? ` (${escHtml(o.promise_note)})` : '');
    }
    if (o.delivery_ref) line += `<br>Delivery receipt: <strong>${escHtml(o.delivery_ref)}</strong>`;
    if (o.notes && o.proposed_by_supplier) line += `<br>${escHtml(o.notes)}`;
    return line;
}

function orderLines(o) {
    return (o.items || []).map(i => {
        const sending = sendingOf(i);
        const short = i.confirmed_quantity != null && sending < Number(i.quantity);
        return `<div class="sp-line">
            <span>${escHtml(i.name)}</span>
            <span class="${short ? 'sp-short' : ''}">${short
                ? `${formatQty(sending)} of ${formatQty(i.quantity)} ordered`
                : formatQty(i.quantity)}</span>
        </div>`;
    }).join('');
}

function orderActions(o) {
    const id = Number(o.id);
    const notes = `<button class="btn-secondary" data-act="notes" data-id="${id}">Notes${Number(o.message_count) ? ' (' + Number(o.message_count) + ')' : ''}</button>`;
    if (o.status === 'pending') return `<button class="btn-primary" data-act="confirm" data-id="${id}">Confirm order</button>${notes}`;
    if (o.status === 'confirmed') return `<button class="btn-primary" data-act="ship" data-id="${id}">Mark as shipped</button>
        <button class="btn-secondary" data-act="date" data-id="${id}">Change delivery date</button>${notes}`;
    if (o.status === 'shipped') return `<button class="btn-secondary" data-act="date" data-id="${id}">Change delivery date</button>${notes}
        <span class="sp-waiting">The shop marks it received when it arrives.</span>`;
    return `${notes}<span class="sp-waiting">Waiting for the shop to accept or decline.</span>`;
}

function renderOrders() {
    const open = portal.orders.filter(o => ['proposed', 'pending', 'confirmed', 'shipped'].includes(o.status));
    const past = portal.orders.filter(o => ['received', 'cancelled'].includes(o.status));
    document.getElementById('figWaiting').textContent = formatNumber(open.filter(o => ['pending', 'confirmed'].includes(o.status)).length);
    document.getElementById('figShipped').textContent = formatNumber(open.filter(o => o.status === 'shipped').length);

    const box = document.getElementById('openOrders');
    if (!open.length) box.innerHTML = '<p class="rp-loading">No open orders right now.</p>';
    else box.innerHTML = open.map(o => {
        const s = ORDER_STATUS[o.status] || { text: o.status, tone: 'ok' };
        const id = Number(o.id);
        return `<div class="sp-order" data-order="${id}">
            <div class="sp-order-head">
                <span class="sp-order-title">${escHtml(o.po_number)}<span class="rp-badge rp-badge-${s.tone}">${escHtml(s.text)}</span></span>
                <span class="sp-order-total">${formatCurrency(o.total_amount)}</span>
            </div>
            <div class="sp-order-facts">${orderFacts(o)}</div>
            <div class="sp-lines">${orderLines(o)}</div>
            <div class="sp-order-actions">${orderActions(o)}</div>
            <div class="sp-notes" id="notes-${id}" ${openNotes.has(id) ? '' : 'hidden'}></div>
        </div>`;
    }).join('');
    openNotes.forEach(id => { if (document.getElementById('notes-' + id)) loadNotes(id); });

    renderPast(past);
}

function renderPast(past) {
    past = past || portal.orders.filter(o => ['received', 'cancelled'].includes(o.status));
    if (!past.length) { portalRow('pastOrdersBody', 4, 'No past orders yet.'); document.getElementById('pastPagination').innerHTML = ''; return; }
    document.getElementById('pastOrdersBody').innerHTML = past.slice(0, pastShown).map(o => {
        const s = ORDER_STATUS[o.status] || { text: o.status, tone: 'ok' };
        const items = (o.items || []).map(i => `${escHtml(formatQty(sendingOf(i)))} × ${escHtml(i.name)}`);
        return `<tr>
            <td><span class="rp-strong">${escHtml(o.po_number)}</span>${o.order_date ? `<span class="rp-sub">Ordered ${escHtml(portalDate(o.order_date))}</span>` : ''}</td>
            <td>${items.slice(0, 3).join('<br>')}${items.length > 3 ? `<span class="rp-sub">and ${items.length - 3} more</span>` : ''}</td>
            <td><span class="rp-badge rp-badge-${s.tone}">${escHtml(s.text)}</span>${o.payment_tracked || o.paid
                ? `<span class="rp-sub">${o.paid ? 'Paid' : 'Not yet paid'}</span>` : ''}</td>
            <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
        </tr>`;
    }).join('');
    updatePagination('pastPagination', past, pastShown, 'showMorePast', 'showLessPast', PAST_PAGE);
}
function showMorePast() { pastShown += PAST_PAGE; renderPast(); }
function showLessPast() { pastShown = Math.max(PAST_PAGE, pastShown - PAST_PAGE); renderPast(); }

function onOrderClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'confirm') openConfirm(id);
    else if (btn.dataset.act === 'ship') openShip(id);
    else if (btn.dataset.act === 'date') openDate(id);
    else if (btn.dataset.act === 'notes') toggleNotes(id);
}

function openConfirm(id) {
    const o = orderOf(id);
    if (!o) return;
    const lines = (o.items || []).map(i => `
        <label class="sp-form-line">
            <span>${escHtml(i.name)}<small>${formatQty(i.quantity)} ordered</small></span>
            <input type="number" class="form-input" data-line="${Number(i.id)}" min="0" max="${Number(i.quantity)}" step="1" value="${Number(i.quantity)}" inputmode="numeric">
        </label>`).join('');
    openSpModal('Confirm ' + o.po_number,
        `<div class="form-group">
            <label class="form-label" for="spDate">Date you will deliver</label>
            <input type="date" class="form-input" id="spDate" min="${todayYmd()}" value="${o.expected_delivery_date && o.expected_delivery_date >= todayYmd() ? o.expected_delivery_date : ''}" required>
         </div>
         <label class="form-label">How many of each you can send</label>
         <p class="sp-form-hint">Lower a number if you cannot send the full amount, or set it to 0 if you have none. The shop is told before the delivery arrives.</p>
         <div class="sp-form-lines">${lines}</div>`,
        'Confirm order',
        async () => {
            const date = document.getElementById('spDate').value;
            if (!date) { showToast('Choose the date you will deliver', 'warning'); return false; }
            const items = [...document.querySelectorAll('#spModalBody input[data-line]')].map(input => ({
                id: Number(input.dataset.line), quantity: Number(input.value)
            }));
            return portalSend('POST', `/orders/${id}/confirm`, { promised_date: date, items });
        });
}

function openShip(id) {
    const o = orderOf(id);
    if (!o) return;
    openSpModal('Mark ' + o.po_number + ' as shipped',
        `<p class="sp-form-hint">The shop is told the order is on its way.</p>
         <div class="form-group">
            <label class="form-label" for="spRef">Delivery receipt or invoice number (optional)</label>
            <input type="text" class="form-input" id="spRef" maxlength="80" placeholder="For example: DR-10452">
         </div>`,
        'Mark as shipped',
        async () => portalSend('POST', `/orders/${id}/ship`, { delivery_ref: document.getElementById('spRef').value }));
}

function openDate(id) {
    const o = orderOf(id);
    if (!o) return;
    openSpModal('Change the delivery date',
        `<p class="sp-form-hint">${escHtml(o.po_number)}${o.promised_date ? ` is currently promised for ${escHtml(portalDate(o.promised_date))}.` : '.'}</p>
         <div class="form-group">
            <label class="form-label" for="spDate">New delivery date</label>
            <input type="date" class="form-input" id="spDate" min="${todayYmd()}" required>
         </div>
         <div class="form-group">
            <label class="form-label" for="spWhy">Why it changed</label>
            <input type="text" class="form-input" id="spWhy" maxlength="300" placeholder="For example: stock arrives from the distributor on Friday" required>
         </div>`,
        'Save new date',
        async () => {
            const date = document.getElementById('spDate').value, note = document.getElementById('spWhy').value.trim();
            if (!date) { showToast('Choose the new delivery date', 'warning'); return false; }
            if (note.length < 3) { showToast('Say briefly why the date changed', 'warning'); return false; }
            return portalSend('PUT', `/orders/${id}/promise`, { promised_date: date, note });
        });
}

/* ---------- Offer an order ---------- */

function openOffer() {
    const products = [...portal.products].sort((a, b) =>
        (Number(a.stock_quantity) - Number(a.reorder_level)) - (Number(b.stock_quantity) - Number(b.reorder_level)));
    if (!products.length) { showToast('No products are assigned to you yet', 'warning'); return; }
    // Start from what would bring each low product back to twice its reorder level.
    const suggest = p => Number(p.stock_quantity) <= Number(p.reorder_level)
        ? Math.max(1, Math.ceil(Number(p.reorder_level) * 2 - Number(p.stock_quantity))) : 0;
    const lines = products.map(p => `
        <label class="sp-form-line">
            <span>${escHtml(p.name)}<small>${formatQty(p.stock_quantity)} in stock, reorder level ${formatQty(p.reorder_level)}${p.cost_price != null ? ' · ' + formatCurrency(p.cost_price) + ' each' : ''}</small></span>
            <input type="number" class="form-input" data-product="${Number(p.id)}" min="0" max="10000" step="1" value="${suggest(p)}" inputmode="numeric">
        </label>`).join('');
    openSpModal('Offer an order',
        `<p class="sp-form-hint">Suggest a delivery to the shop. Products running low are filled in for you. It becomes an order only if the shop accepts.</p>
         <div class="sp-form-lines">${lines}</div>
         <div class="form-group">
            <label class="form-label" for="spDate">Date you could deliver</label>
            <input type="date" class="form-input" id="spDate" min="${todayYmd()}" required>
         </div>
         <div class="form-group">
            <label class="form-label" for="spOfferNote">Note to the shop (optional)</label>
            <input type="text" class="form-input" id="spOfferNote" maxlength="300">
         </div>`,
        'Send offer',
        async () => {
            const items = [...document.querySelectorAll('#spModalBody input[data-product]')]
                .map(input => ({ product_id: Number(input.dataset.product), quantity: Number(input.value) }))
                .filter(i => i.quantity > 0);
            const date = document.getElementById('spDate').value;
            if (!items.length) { showToast('Enter a quantity for at least one product', 'warning'); return false; }
            if (!date) { showToast('Choose the date you could deliver', 'warning'); return false; }
            return portalSend('POST', '/offers', { items, promised_date: date, note: document.getElementById('spOfferNote').value });
        });
}

/* ---------- Notes ---------- */

function toggleNotes(id) {
    const box = document.getElementById('notes-' + id);
    if (!box) return;
    if (openNotes.has(id)) { openNotes.delete(id); box.hidden = true; return; }
    openNotes.add(id);
    box.hidden = false;
    loadNotes(id);
}

async function loadNotes(id) {
    const box = document.getElementById('notes-' + id);
    if (!box) return;
    try {
        const notes = await portalGet(`/orders/${id}/messages`);
        box.innerHTML = (notes.length ? notes.map(n => `
            <div class="sp-note">
                <span class="sp-note-meta">${escHtml(n.from_supplier ? 'You' : (n.author || 'Risha Pet Supplies'))} · ${escHtml(new Date(Number(n.created_at)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>
                ${escHtml(n.body)}
            </div>`).join('') : '<p class="sp-form-hint" style="margin:0;">No notes on this order yet.</p>')
            + `<form class="sp-note-form" data-note-for="${id}">
                <input type="text" class="form-input" maxlength="1000" placeholder="Write a note to the shop" aria-label="Note to the shop" required>
                <button type="submit" class="btn-secondary">Send</button>
               </form>`;
    } catch (error) {
        box.innerHTML = '<p class="sp-form-hint" style="margin:0;">Notes could not be loaded.</p>';
    }
}

async function onNoteSubmit(e) {
    const form = e.target.closest('form[data-note-for]');
    if (!form) return;
    e.preventDefault();
    const id = Number(form.dataset.noteFor);
    const input = form.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    if (await portalSend('POST', `/orders/${id}/messages`, { body })) {
        const o = orderOf(id);
        if (o) o.message_count = Number(o.message_count || 0) + 1;
        loadNotes(id);
    }
}

/* ---------- Payments and scorecard ---------- */

function renderPayments() {
    const unpaid = portal.orders.filter(o => o.payment_tracked && !o.paid);
    const total = unpaid.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    document.getElementById('figUnpaid').textContent = formatCurrency(total);
    document.getElementById('figUnpaidNote').textContent = unpaid.length ? `${unpaid.length} delivered order${unpaid.length === 1 ? '' : 's'}` : 'Nothing outstanding';
    const terms = portal.me && portal.me.payment_terms;
    document.getElementById('paymentsSub').textContent = 'Delivered orders the shop has not yet marked as paid'
        + (terms ? `. Your payment terms: ${terms}` : '');
    if (!unpaid.length) { portalRow('paymentsBody', 4, 'Nothing is waiting to be paid.'); return; }
    const today = todayYmd();
    document.getElementById('paymentsBody').innerHTML = unpaid.map(o => `
        <tr>
            <td class="rp-strong">${escHtml(o.po_number)}</td>
            <td>${o.received_day ? escHtml(portalDate(o.received_day)) : '—'}</td>
            <td>${o.payment_due
                ? escHtml(portalDate(o.payment_due)) + (o.payment_due < today ? ' <span class="sp-late">overdue</span>' : '')
                : 'Not set by your terms'}</td>
            <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
        </tr>`).join('');
}

function renderScorecard() {
    const s = portal.score || {};
    const cell = (label, value, note) => `
        <div class="rp-detail-item">
            <span class="rp-detail-label">${label}</span>
            <span class="rp-figure-value">${value}</span>
            <span class="rp-figure-note">${note}</span>
        </div>`;
    if (!s.delivered) {
        document.getElementById('scorecard').innerHTML = '<p class="sp-form-hint" style="margin:0;">Figures appear once the shop has received an order from you.</p>';
        return;
    }
    document.getElementById('scorecard').innerHTML =
        cell('Delivered on time', s.on_time_percent != null ? s.on_time_percent + '%' : '—',
            s.on_time_of ? `Arrived by the promised date, out of ${s.on_time_of} order${s.on_time_of === 1 ? '' : 's'} with a date` : 'No orders had a delivery date to judge against')
        + cell('Delivered in full', s.complete_percent != null ? s.complete_percent + '%' : '—', 'Every item arrived in the quantity ordered')
        + cell('Average time to deliver', s.average_days != null ? s.average_days + ' days' : '—', 'From the order being placed to being received')
        + cell('Orders delivered', formatNumber(s.delivered), 'In the last 12 months');
}

/* ---------- The one dialog ---------- */

let spSubmit = null;

function openSpModal(title, bodyHtml, submitLabel, onSubmit) {
    document.getElementById('spModalTitle').textContent = title;
    document.getElementById('spModalBody').innerHTML = bodyHtml;
    document.getElementById('spModalSubmit').textContent = submitLabel;
    spSubmit = onSubmit;
    document.getElementById('spModal').classList.add('active');
    const first = document.querySelector('#spModalBody input');
    if (first) setTimeout(() => first.focus(), 50);
}

function closeSpModal() {
    document.getElementById('spModal').classList.remove('active');
    spSubmit = null;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('spModalForm').addEventListener('submit', async e => {
        e.preventDefault();
        if (!spSubmit) return;
        const btn = document.getElementById('spModalSubmit');
        btn.disabled = true;
        try {
            if (await spSubmit()) { closeSpModal(); await loadPortal(); }
        } finally {
            btn.disabled = false;
        }
    });
});
