/* Supplier page. Everything shown here comes from /api/supplier-portal, which
   the server limits to the one supplier this login belongs to. This file only
   presents it and sends back what the supplier types. */

const PORTAL_API = `${API_BASE}/supplier-portal`;
const PAST_PAGE = 10;

let portal = { me: null, products: [], orders: [], score: null, newProducts: [] };
let pastShown = PAST_PAGE;
const PRODUCTS_PAGE = 10;
let productsShown = PRODUCTS_PAGE;     // the products list shows 10 at a time
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
    document.getElementById('waitingOffersBody').addEventListener('click', onOrderClick);
    document.getElementById('pastOrdersBody').addEventListener('click', onOrderClick);
    document.getElementById('openOrders').addEventListener('submit', onNoteSubmit);
    document.querySelectorAll('.sp-tab').forEach(t => t.addEventListener('click', () => setSpTab(t.dataset.spTab)));
    let first = 'open';
    try { first = localStorage.getItem('spTab') || 'open'; } catch (e) {}
    if (location.hash === '#offer') first = 'offer';
    setSpTab(first);
    document.getElementById('productsBody').addEventListener('click', e => {
        const btn = e.target.closest('button[data-price]');
        if (btn) openPrice(Number(btn.dataset.price));
        const cancel = e.target.closest('button[data-cancel-price]');
        if (cancel) cancelPrice(Number(cancel.dataset.cancelPrice));
        const hist = e.target.closest('button[data-history]');
        if (hist) showProductHistory(Number(hist.dataset.history));
        const why = e.target.closest('button[data-declined]');
        if (why) showDeclined(Number(why.dataset.declined));
    });
    document.getElementById('newProductsBody').addEventListener('click', e => {
        const view = e.target.closest('button[data-new-view]');
        if (view) showNewProduct(Number(view.dataset.newView));
        const cancel = e.target.closest('button[data-new-cancel]');
        if (cancel) cancelNewProduct(Number(cancel.dataset.newCancel));
    });
    document.getElementById('pastSearch').addEventListener('input', () => { pastShown = PAST_PAGE; renderPast(); });
    document.getElementById('pastStatus').addEventListener('change', () => { pastShown = PAST_PAGE; renderPast(); });
    document.getElementById('spStatus').addEventListener('change', e => { if (e.target.id === 'spStatusPick') changeStatus(e.target.value); });
    loadPortal();
});

/* The offers the shop has not answered yet, in the Offer to the shop tab, each with Cancel offer. */
function renderWaitingOffers() {
    const waiting = portal.orders.filter(o => o.status === 'proposed');
    if (!waiting.length) { portalRow('waitingOffersBody', 5, 'No offers waiting. Use Offer an order above.'); return; }
    document.getElementById('waitingOffersBody').innerHTML = waiting.map(o => {
        const items = (o.items || []).map(i => `${escHtml(formatQty(i.quantity))} × ${escHtml(i.name)}`);
        return `<tr>
            <td><span class="rp-strong">${escHtml(o.po_number)}</span>${o.order_date ? `<span class="rp-sub">Offered ${escHtml(portalDate(o.order_date))}</span>` : ''}</td>
            <td>${items.slice(0, 3).join('<br>')}${items.length > 3 ? `<span class="rp-sub">and ${items.length - 3} more</span>` : ''}</td>
            <td>${o.promised_date ? escHtml(portalDate(o.promised_date)) : '—'}</td>
            <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
            <td class="num"><button class="btn-secondary sp-btn-cancel" data-act="cancel-offer" data-id="${Number(o.id)}">Cancel offer</button></td>
        </tr>`;
    }).join('');
}

/* ---------- One part of the portal at a time ---------- */

/* The tabs under the figures show one card; the last one opened is kept on
   this browser so the page opens where the supplier left it. */
function setSpTab(name) {
    if (!document.querySelector(`[data-sp-panel="${name}"]`)) name = 'open';
    document.querySelectorAll('.sp-tab').forEach(t => {
        const on = t.dataset.spTab === name;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-sp-panel]').forEach(p => { p.hidden = p.dataset.spPanel !== name; });
    try { localStorage.setItem('spTab', name); } catch (e) {}
}

/* A number on a tab, or nothing when it is 0. `word` says what is counted
   when the tab's name alone does not (Products: "5 low"). */
function setTabCount(id, n, word) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = formatNumber(n) + (word ? ' ' + word : '');
    el.hidden = !n;
}

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
    if (!data.success) throw new Error(data.message || 'the server gave no reason (error ' + res.status + ')');
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
        const [me, products, orders, score, newProducts] = await Promise.all([
            portalGet('/me'), portalGet('/products'), portalGet('/orders'), portalGet('/scorecard'),
            portalGet('/new-products').catch(() => [])
        ]);
        portal = { me, products, orders, score, newProducts };
        notice.hidden = true;
        renderDetails();
        renderProducts();
        renderOrders();
        renderPayments();
        renderScorecard();
        renderNewProducts();
        renderWaitingOffers();
    } catch (error) {
        console.error('Supplier page failed to load:', error);
        notice.textContent = error.message && error.message !== 'Request failed'
            ? error.message
            : 'This page could not be loaded. Please try again in a moment.';
        notice.hidden = false;
        document.getElementById('openOrders').innerHTML = '<p class="rp-loading">Nothing to show.</p>';
        portalRow('productsBody', 7, 'Nothing to show.');
        portalRow('pastOrdersBody', 5, 'Nothing to show.');
        portalRow('paymentsBody', 4, 'Nothing to show.');
        portalRow('waitingOffersBody', 5, 'Nothing to show.');
        portalRow('newProductsBody', 5, 'Nothing to show.');
    }
}

/* ---------- Details ---------- */

/* The company name heads the page. The details themselves moved to Settings →
   Profile (UAT, 31 Oct). */
function renderDetails() {
    document.getElementById('supplierName').textContent = (portal.me && portal.me.name) || 'Supplier';
    // the supplier's own status: Active, On vacation or Inactive (Carlo, 3 Nov)
    const status = (portal.me && portal.me.status) || 'active';
    const box = document.getElementById('spStatus');
    box.hidden = false;
    box.className = 'sp-status is-' + status;
    // the chip says what the status is; the menu beside it changes it (Carlo, 5 Nov)
    box.innerHTML = `<label class="sp-status-chip" for="spStatusPick" title="Your status"><span class="sp-status-dot"></span>${escHtml((SP_STATUS[status] || SP_STATUS.active).short)}</label>
        <select class="form-select sp-status-pick" id="spStatusPick" aria-label="Your status">
            ${Object.entries(SP_STATUS).map(([k, v]) => `<option value="${k}"${k === status ? ' selected' : ''}>${v.label}</option>`).join('')}
        </select>`;
    applyLock();
}

const SP_STATUS = {
    active: { label: 'Active: taking orders', short: 'Active', say: 'The shop sees that you are taking orders, and you can use the whole portal again.' },
    vacation: { label: 'On vacation: away for a while', short: 'On vacation', say: 'The shop sees that you are on vacation, on your line in Suppliers and before it sends you an order. Your open orders stay as they are. While you are on vacation the portal is locked: you can look, but not confirm, ship, change dates or prices, send notes or make offers until you are Active again.' },
    inactive: { label: 'Inactive: not taking orders', short: 'Inactive', say: 'The shop sees that you are not taking orders for now. Your open orders stay as they are. While you are inactive the portal is locked: you can look, but not confirm, ship, change dates or prices, send notes or make offers until you are Active again.' }
};

/* On vacation or Inactive, the portal is read-only (Carlo, 7 Nov 2026): every
   button that changes something is greyed out and cannot be clicked, a note
   says why, and the server refuses the same. Looking around, receipts,
   history and the status menu stay open, so the supplier can switch back. */
const LOCKABLE = 'button[data-act="confirm"], button[data-act="ship"], button[data-act="date"], button[data-act="cancel-offer"], '
    + 'button[data-price], button[data-cancel-price], button[data-new-cancel], .sp-offer-tile, .sp-note-form button, .sp-note-form input';
function portalLock() {
    const s = portal.me && portal.me.status;
    return s === 'vacation' || s === 'inactive' ? SP_STATUS[s].short : null;
}
function lockedSay() {
    const s = portalLock();
    if (s) showToast(`Your status is ${s}, so the portal is locked. Change Your status to Active: taking orders to use it again.`, 'warning');
    return !!s;
}
function lockControls() {
    const s = portalLock();
    document.querySelectorAll(LOCKABLE).forEach(b => {
        if (s && !b.dataset.locked) {
            b.dataset.locked = b.title || ' ';
            b.disabled = true;
            b.title = `Locked while you are ${s}`;
            b.style.opacity = '.45'; b.style.cursor = 'not-allowed';
        } else if (!s && b.dataset.locked) {
            const was = b.dataset.locked.trim();
            delete b.dataset.locked;
            b.disabled = false;
            if (was) b.title = was; else b.removeAttribute('title');
            b.style.opacity = ''; b.style.cursor = '';
        }
    });
}
let lockWatch = null;
function applyLock() {
    const s = portalLock();
    const note = document.getElementById('spLockNote');
    if (note) {
        note.hidden = !s;
        // one span: the notice lays its children out side by side
        if (s) note.innerHTML = `<span><strong>Your status is ${escHtml(s)}, so the portal is locked.</strong> You can look at your orders, payments and products, but you cannot confirm, ship, change dates or prices, send notes or make offers. Change <strong>Your status</strong> to <strong>Active: taking orders</strong> to use it again.</span>`;
    }
    lockControls();
    // lists are drawn again (show more, notes opened, tabs): keep their buttons locked
    if (!lockWatch && window.MutationObserver) {
        lockWatch = new MutationObserver(() => { if (portalLock()) lockControls(); });
        lockWatch.observe(document.querySelector('.main-wrapper') || document.body, { childList: true, subtree: true });
    }
}

function changeStatus(next) {
    const now = (portal.me && portal.me.status) || 'active';
    if (!SP_STATUS[next] || next === now) return;
    showConfirmDialog('Change your status to ' + SP_STATUS[next].short + '?', SP_STATUS[next].say,
        async () => { if (await portalSend('PUT', '/me/status', { status: next })) loadPortal(); else renderDetails(); },
        'Change status');
    // closing the question without changing puts the menu back
    const keep = document.getElementById('confirmCancelBtn');
    if (keep) keep.addEventListener('click', renderDetails);
}

/* ---------- Products and prices ---------- */

function renderProducts() {
    const products = portal.products;
    const low = products.filter(p => Number(p.stock_quantity) <= Number(p.reorder_level));
    setTabCount('tabCountLow', low.length, 'low');
    // the offer section says how many are running low, so an offer is worth making
    const lowChip = document.getElementById('spOfferLow');
    if (lowChip) { lowChip.hidden = !low.length; lowChip.textContent = low.length + ' running low'; }
    if (!products.length) { portalRow('productsBody', 7, 'No products are assigned to you yet.'); document.getElementById('productsPagination').innerHTML = ''; return; }
    const status = p => {
        const stock = Number(p.stock_quantity), level = Number(p.reorder_level);
        if (stock <= 0) return '<span class="rp-badge rp-badge-danger">Out of stock</span>';
        if (stock <= level) return '<span class="rp-badge rp-badge-warning">Running low</span>';
        return '<span class="rp-badge rp-badge-ok">Enough stock</span>';
    };
    // what the shop is short of comes first
    const ordered = [...products].sort((a, b) =>
        (Number(a.stock_quantity) - Number(a.reorder_level)) - (Number(b.stock_quantity) - Number(b.reorder_level)));
    document.getElementById('productsBody').innerHTML = ordered.slice(0, productsShown).map(p => `
        <tr>
            <td><span class="rp-strong">${escHtml(p.name)}</span><span class="rp-sub">${escHtml([p.sku, p.category].filter(Boolean).join(' · '))}</span></td>
            <td class="num">${formatQty(p.stock_quantity)}</td>
            <td class="num">${formatQty(p.reorder_level)}</td>
            <td>${status(p)}</td>
            <td class="num">${p.expected_30d == null ? '<span class="rp-sub">Being calculated</span>' : (p.expected_30d >= 0.5 ? formatNumber(Math.round(p.expected_30d)) : '—')}</td>
            <td class="num">${p.cost_price != null ? formatCurrency(p.cost_price) : '—'}${p.pending_price != null
                ? `<button type="button" class="price-pending-btn" data-history="${Number(p.id)}" title="See your reason and this product's history">${formatCurrency(p.pending_price)} proposed, waiting <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>`
                : p.declined_price != null
                    ? `<button type="button" class="price-declined-btn" data-declined="${Number(p.id)}" title="See why and when">${formatCurrency(p.declined_price)} declined${p.decline_reason ? ': ' + escHtml(p.decline_reason) : ''} <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>` : ''}</td>
            <td class="num"><div class="sp-cell-actions">${p.pending_price != null
                ? `<button class="btn-secondary sp-btn-cancel" data-cancel-price="${Number(p.id)}">Cancel proposal</button>`
                : `<button class="btn-view" data-price="${Number(p.id)}">Change price</button>`}<button class="btn-view" data-history="${Number(p.id)}" title="Price changes and orders of this product">History</button></div></td>
        </tr>`).join('');
    updatePagination('productsPagination', ordered, productsShown, 'showMoreProducts', 'showLessProducts', PRODUCTS_PAGE);
}
function showMoreProducts() { productsShown += PRODUCTS_PAGE; renderProducts(); }
function showLessProducts() { productsShown = Math.max(PRODUCTS_PAGE, productsShown - PRODUCTS_PAGE); renderProducts(); }

// Take back a price change the shop has not answered (UAT part 4, SP8).
function cancelPrice(productId) {
    if (lockedSay()) return;
    const p = portal.products.find(x => Number(x.id) === productId);
    if (!p || p.pending_price == null) return;
    showConfirmDialog('Cancel this price change?',
        `${escHtml(p.name)}: your proposal of <strong>${formatCurrency(p.pending_price)}</strong> is taken back. The shop keeps paying ${p.cost_price != null ? formatCurrency(p.cost_price) : 'the current price'}.`,
        async () => { if (await portalSend('POST', `/products/${productId}/price/cancel`)) loadPortal(); },
        'Cancel proposal');
    const keep = document.getElementById('confirmCancelBtn');
    if (keep) keep.textContent = 'Keep it';
}

/* One product, opened (SP9; Carlo, 5 Nov): what is waiting or was last
   declined, with the reasons, then every price change for it and the orders
   it was on. The red declined line and the "proposed, waiting" line open it,
   and so does History on every product. */
function showDeclined(productId) { showProductHistory(productId); }

async function showProductHistory(productId) {
    const p = portal.products.find(x => Number(x.id) === productId);
    if (!p) return;
    let h;
    try { h = await portalGet(`/products/${productId}/history`); }
    catch (e) { showToast(couldNot('open the history', e), 'error'); return; }
    const when = ms => ms ? new Date(Number(ms)).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const day = ms => ms ? new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const money = v => v != null ? formatCurrency(v) : 'Not set';
    // what is going on now
    let title = p.name, tone = 'primary', icon = 'history', rows = [['Your price now', money(p.cost_price)]];
    if (p.pending_price != null) {
        title = 'Price change waiting';
        rows = [['You proposed', formatCurrency(p.pending_price)], ['Price now', money(p.cost_price)],
            ['Your reason', p.pending_note || 'None given'], ['Sent', when(p.pending_at)], ['Status', 'Waiting for the shop', 'warning']];
    } else if (p.declined_price != null) {
        title = 'Price change declined'; tone = 'danger'; icon = 'block';
        rows = [['You proposed', formatCurrency(p.declined_price)], ['Price then', money(p.declined_was)], ['Price now', money(p.cost_price)],
            ['Your reason', p.declined_note || 'None given'], ['Sent', when(p.declined_proposed_at)], ['Declined', when(p.declined_at)],
            ['Declined by', p.declined_by || 'Risha Pet Supplies'], ['Shop\'s reason', p.decline_reason || 'None given', 'danger']];
    }
    const STATE = { pending: ['Waiting', 'warning'], approved: ['Accepted', 'ok'], rejected: ['Declined', 'danger'], cancelled: ['Cancelled by you', 'muted'] };
    const prices = (h.proposals || []).map(x => {
        const st = STATE[x.status] || [x.status, 'muted'];
        const why = [x.note ? 'You: ' + x.note : '', x.status === 'rejected' && x.decline_reason ? 'Shop: ' + x.decline_reason : ''].filter(Boolean).join(' · ');
        return `<tr><td>${escHtml(day(x.sent_at))}</td><td class="num">${money(x.current_price)} → <b>${formatCurrency(x.proposed_price)}</b></td>
            <td><span class="rp-badge rp-badge-${st[1]}">${escHtml(st[0])}</span>${why ? `<span class="rp-sub">${escHtml(why)}</span>` : ''}</td></tr>`;
    }).join('');
    const orders = (h.orders || []).map(o => {
        const st = ORDER_STATUS[o.status] || { text: o.status, tone: 'ok' };
        const qty = o.confirmed_quantity != null && Number(o.confirmed_quantity) !== Number(o.quantity)
            ? `${formatQty(o.confirmed_quantity)} of ${formatQty(o.quantity)}` : formatQty(o.quantity);
        return `<tr><td><b>${escHtml(o.po_number)}</b><span class="rp-sub">${escHtml(o.order_date ? portalDate(o.order_date) : '')}${o.proposed_by_supplier ? ' · your offer' : ''}</span></td>
            <td class="num">${qty}</td><td class="num">${o.unit_price != null ? formatCurrency(o.unit_price) : '—'}</td>
            <td><span class="rp-badge rp-badge-${st.tone}">${escHtml(o.status === 'cancelled' && o.proposed_by_supplier ? 'Cancelled' : st.text)}</span></td></tr>`;
    }).join('');
    const html = `<div class="sp-hist">
        <h4>Price changes <small>${formatNumber((h.proposals || []).length)}</small></h4>
        ${prices ? `<table class="rp-table sp-hist-table"><thead><tr><th>Sent</th><th class="num">Price</th><th>Answer and reasons</th></tr></thead><tbody>${prices}</tbody></table>` : '<p class="sp-hist-none">No price change proposed for this product yet.</p>'}
        <h4>Orders with this product <small>${formatNumber((h.orders || []).length)}</small></h4>
        ${orders ? `<table class="rp-table sp-hist-table"><thead><tr><th>Order</th><th class="num">Qty</th><th class="num">Price each</th><th>Status</th></tr></thead><tbody>${orders}</tbody></table>` : '<p class="sp-hist-none">This product has not been on an order yet.</p>'}
    </div>`;
    const dlg = showDetailsDialog(title, p.name, rows, { tone, icon, html,
        // locked (On vacation or Inactive): the window only shows, it changes nothing
        actions: portalLock() ? []
            : p.pending_price != null
            ? [{ label: 'Cancel proposal', className: 'btn-secondary', onClick: () => cancelPrice(productId) }]
            : [{ label: p.declined_price != null ? 'Propose another price' : 'Change price', onClick: () => openPrice(productId) }] });
    dlg.dialog.classList.add('sp-hist-dialog');
}

function openPrice(productId) {
    if (lockedSay()) return;
    const p = portal.products.find(x => Number(x.id) === productId);
    if (!p) return;
    openSpModal('Propose a new price',
        `<p class="sp-form-hint note-banner"><span class="material-symbols-outlined" aria-hidden="true">sell</span><span><strong>${escHtml(p.name)}</strong><br>Current price: ${p.cost_price != null ? formatCurrency(p.cost_price) : 'not set'}. The price changes only if the shop accepts.</span></p>
         <div class="form-group">
            <label class="form-label" for="spPrice">New price (₱)</label>
            <input type="text" class="form-input" id="spPrice" inputmode="decimal" autocomplete="off" maxlength="11" placeholder="For example: 1250.50" required>
            <div class="field-error" id="spPriceError" role="alert"></div>
         </div>
         <div class="form-group">
            <label class="form-label" for="spPriceNote">Reason (optional)</label>
            <input type="text" class="form-input" id="spPriceNote" maxlength="300" placeholder="For example: manufacturer price increase">
         </div>`,
        'Send to the shop',
        async () => {
            // typed as text, so "+20" or "20abc" reach this check instead of being read as 20
            const box = document.getElementById('spPrice'), text = box.value.trim();
            const problem = spPriceProblem(text, p.cost_price);
            document.getElementById('spPriceError').textContent = problem || '';
            box.classList.toggle('input-invalid', !!problem);
            if (problem) { box.focus(); return false; }
            return portalSend('POST', `/products/${productId}/price`, { price: text, note: document.getElementById('spPriceNote').value });
        });
    // said while typing (UAT part 4, S1)
    liveCheck(document.getElementById('spPrice'), () => {
        const box = document.getElementById('spPrice'), problem = box.value.trim() ? spPriceProblem(box.value.trim(), p.cost_price) : null;
        document.getElementById('spPriceError').textContent = problem || '';
        box.classList.toggle('input-invalid', !!problem);
    });
}

/* What is wrong with the price typed, or null (backend/utils/supply.js has the same rule). */
function spPriceProblem(text, current) {
    if (!text) return 'Enter the new price.';
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return 'Type the price as a number only, like 1250 or 1250.50: no + or - signs, no letters, and at most 2 decimals.';
    const n = Number(text);
    if (n <= 0) return 'Enter a price greater than zero.';
    if (n > 1000000) return 'That price is too large (₱1,000,000 at most).';
    if (current != null && Number(current) === n) return 'That is already the current price.';
    return null;
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

function orderActions(o) {
    const id = Number(o.id);
    // only a paid order has a receipt (UAT part 4, A7); an open order is not paid yet
    const notes = `<button class="btn-secondary" data-act="notes" data-id="${id}">Notes${Number(o.message_count) ? ' (' + Number(o.message_count) + ')' : ''}</button>`;
    if (o.status === 'pending') return `<button class="btn-primary" data-act="confirm" data-id="${id}">Confirm order</button>${notes}`;
    if (o.status === 'confirmed') return `<button class="btn-primary" data-act="ship" data-id="${id}">Mark as shipped</button>
        <button class="btn-secondary" data-act="date" data-id="${id}">Change delivery date</button>${notes}`;
    if (o.status === 'shipped') return `<button class="btn-secondary" data-act="date" data-id="${id}">Change delivery date</button>${notes}
        <span class="sp-waiting">The shop marks it received when it arrives.</span>`;
    return `<button class="btn-secondary sp-btn-cancel" data-act="cancel-offer" data-id="${id}">Cancel offer</button>${notes}<span class="sp-waiting">Waiting for the shop to accept or decline.</span>`;
}

function renderOrders() {
    const open = portal.orders.filter(o => ['proposed', 'pending', 'confirmed', 'shipped'].includes(o.status));
    const past = portal.orders.filter(o => ['received', 'cancelled'].includes(o.status));
    document.getElementById('figWaiting').textContent = formatNumber(open.filter(o => o.status === 'pending').length);
    document.getElementById('figToShip').textContent = formatNumber(open.filter(o => o.status === 'confirmed').length);
    document.getElementById('figShipped').textContent = formatNumber(open.filter(o => o.status === 'shipped').length);
    // the tab counts what is waiting on the supplier: orders to confirm and to ship
    const toConfirm = open.filter(o => o.status === 'pending').length, toShip = open.filter(o => o.status === 'confirmed').length;
    setTabCount('tabCountOpen', toConfirm + toShip, 'to do');
    document.getElementById('tabCountOpen').title = `${toConfirm} to confirm, ${toShip} to ship`;

    const box = document.getElementById('openOrders');
    if (!open.length) box.innerHTML = '<p class="rp-loading">No open orders right now.</p>';
    else box.innerHTML = open.map(o => {
        const s = ORDER_STATUS[o.status] || { text: o.status, tone: 'ok' };
        const id = Number(o.id);
        /* one box per order, the same as the shop's Orders (Carlo, 3 Nov: the
           columns across a wide screen looked "random"): the order and where it
           is, the total, the progress, what is on it, then what to do */
        const items = o.items || [];
        const lineOf = i => {
            const sending = sendingOf(i);
            const short = i.confirmed_quantity != null && sending < Number(i.quantity);
            return `<div class="sp-line"><span>${escHtml(i.name)}</span><span class="${short ? 'sp-short' : ''}">${short ? formatQty(sending) + ' of ' + formatQty(i.quantity) : formatQty(i.quantity)}</span></div>`;
        };
        return `<div class="sp-order" data-order="${id}">
            <div class="sp-order-head">
                <span class="sp-order-title">${escHtml(o.po_number)}<span class="rp-badge rp-badge-${s.tone}">${escHtml(s.text)}</span></span>
                <span class="sp-order-total">${formatCurrency(o.total_amount)}</span>
            </div>
            ${poProgressHtml(o.status)}
            <div class="sp-order-facts">${orderFacts(o)}</div>
            <div class="sp-lines">${items.length ? `<div class="sp-line sp-line-head"><span>Products (${items.length})</span><span>Quantity</span></div>${items.map(lineOf).join('')}` : ''}</div>
            <div class="sp-order-actions">${orderActions(o)}</div>
            <div class="sp-notes" id="notes-${id}" ${openNotes.has(id) ? '' : 'hidden'}></div>
        </div>`;
    }).join('');
    openNotes.forEach(id => { if (document.getElementById('notes-' + id)) loadNotes(id); });

    renderPast(past);
}

function renderPast() {
    const all = portal.orders.filter(o => ['received', 'cancelled'].includes(o.status));
    // search and filter (UAT part 4, SP11)
    const q = (document.getElementById('pastSearch').value || '').trim().toLowerCase();
    const show = document.getElementById('pastStatus').value;
    const past = all.filter(o => {
        if (show === 'received' && o.status !== 'received') return false;
        if (show === 'paid' && !(o.status === 'received' && o.paid)) return false;
        if (show === 'unpaid' && !(o.status === 'received' && !o.paid)) return false;
        if (show === 'cancelled' && o.status !== 'cancelled') return false;
        if (!q) return true;
        return String(o.po_number).toLowerCase().includes(q) || (o.items || []).some(i => String(i.name).toLowerCase().includes(q));
    });
    const count = document.getElementById('pastCount');
    count.textContent = q || show ? `${formatNumber(past.length)} of ${formatNumber(all.length)} past orders` : `${formatNumber(all.length)} past order${all.length === 1 ? '' : 's'}`;
    if (!past.length) {
        portalRow('pastOrdersBody', 5, all.length ? 'No past order matches. Clear the search or choose All past orders.' : 'No past orders yet.');
        document.getElementById('pastPagination').innerHTML = '';
        return;
    }
    document.getElementById('pastOrdersBody').innerHTML = past.slice(0, pastShown).map(o => {
        const s = ORDER_STATUS[o.status] || { text: o.status, tone: 'ok' };
        const items = (o.items || []).map(i => `${escHtml(formatQty(sendingOf(i)))} × ${escHtml(i.name)}`);
        return `<tr>
            <td><span class="rp-strong">${escHtml(o.po_number)}</span>${o.order_date ? `<span class="rp-sub">Ordered ${escHtml(portalDate(o.order_date))}</span>` : ''}</td>
            <td>${items.slice(0, 3).join('<br>')}${items.length > 3 ? `<span class="rp-sub">and ${items.length - 3} more</span>` : ''}</td>
            <td><span class="rp-badge rp-badge-${s.tone}">${escHtml(o.status === 'cancelled' && o.cancelled_by_supplier ? 'Cancelled by you' : s.text)}</span>${o.payment_tracked || o.paid
                ? `<span class="rp-sub">${o.paid ? 'Paid' + (o.paid_day ? ' ' + escHtml(portalDate(o.paid_day)) : '') : 'Not yet paid'}</span>` : ''}${o.status === 'cancelled' && o.cancel_note ? `<span class="rp-sub">${escHtml(o.cancel_note)}</span>` : ''}</td>
            <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
            <td class="num">${o.paid ? `<button class="btn-view" data-receipt="${Number(o.id)}"><span class="material-symbols-outlined" style="font-size:15px;">receipt_long</span> Receipt</button>` : ''}</td>
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
    else if (btn.dataset.act === 'cancel-offer') cancelOffer(id);
}

// Take back an offer the shop has not answered (UAT part 4, SP5).
function cancelOffer(id) {
    if (lockedSay()) return;
    const o = orderOf(id);
    if (!o || o.status !== 'proposed') return;
    showPromptDialog('Cancel offer ' + o.po_number + '?',
        'The shop is told it is no longer offered. Say why, so the shop knows (optional).',
        async reason => { if (await portalSend('POST', `/offers/${id}/cancel`, { reason: (reason || '').trim() })) loadPortal(); },
        'Cancel offer', '<span class="material-symbols-outlined" style="color:var(--danger);">block</span>', 'text', '',
        { maxLength: 300, placeholder: 'For example: we ran out of stock' });
    const keep = document.getElementById('confirmCancelBtn');
    if (keep) keep.textContent = 'Keep the offer';
}

function openConfirm(id) {
    if (lockedSay()) return;
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
         <p class="sp-form-hint note-banner is-quiet"><span class="material-symbols-outlined" aria-hidden="true">info</span><span>Lower a number if you cannot send the full amount, or set it to 0 if you have none. The shop is told before the delivery arrives.</span></p>
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
    if (lockedSay()) return;
    const o = orderOf(id);
    if (!o) return;
    openSpModal('Mark ' + o.po_number + ' as shipped',
        `<p class="sp-form-hint note-banner"><span class="material-symbols-outlined" aria-hidden="true">local_shipping</span><span>The shop is told the order is on its way.</span></p>
         <div class="form-group">
            <label class="form-label" for="spRef">Delivery receipt or invoice number (optional)</label>
            <input type="text" class="form-input" id="spRef" maxlength="80" placeholder="For example: DR-10452">
         </div>`,
        'Mark as shipped',
        async () => portalSend('POST', `/orders/${id}/ship`, { delivery_ref: document.getElementById('spRef').value }));
}

function openDate(id) {
    if (lockedSay()) return;
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
    if (lockedSay()) return;
    const products = [...portal.products].sort((a, b) =>
        (Number(a.stock_quantity) - Number(a.reorder_level)) - (Number(b.stock_quantity) - Number(b.reorder_level)));
    if (!products.length) { showToast('No products are assigned to you yet', 'warning'); return; }
    // Start from what would bring each low product back to twice its reorder level.
    const suggest = p => Number(p.stock_quantity) <= Number(p.reorder_level)
        ? Math.max(1, Math.ceil(Number(p.reorder_level) * 2 - Number(p.stock_quantity))) : 0;
    const lines = products.map(p => `
        <label class="sp-form-line" data-find="${escHtml((p.name + ' ' + (p.sku || '') + ' ' + (p.category || '')).toLowerCase())}">
            <span>${escHtml(p.name)}<small>${formatQty(p.stock_quantity)} in stock, reorder level ${formatQty(p.reorder_level)}${p.cost_price != null ? ' · ' + formatCurrency(p.cost_price) + ' each' : ''}</small></span>
            <input type="number" class="form-input" data-product="${Number(p.id)}" min="0" max="10000" step="1" value="${suggest(p)}" inputmode="numeric">
        </label>`).join('');
    openSpModal('Offer an order',
        `<p class="sp-form-hint note-banner"><span class="material-symbols-outlined" aria-hidden="true">add_shopping_cart</span><span>Suggest a delivery to the shop. Products running low are filled in for you. It becomes an order only if the shop accepts.</span></p>
         <input type="search" class="form-input sp-offer-search" id="spOfferSearch" placeholder="Search your products" maxlength="100" aria-label="Search your products">
         <div class="sp-form-lines" id="spOfferLines">${lines}<p class="sp-form-hint sp-offer-none" id="spOfferNone" hidden>No product matches. Not one you supply yet? <button type="button" class="sp-link" onclick="closeSpModal(); openNewProduct();">Offer a new product</button></p></div>
         <p class="sp-form-hint" style="margin-top:-4px;">Selling something the shop does not carry? <button type="button" class="sp-link" onclick="closeSpModal(); openNewProduct();">Offer a new product</button></p>
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
    // search the list (UAT part 4, SP3): quantities typed stay, hidden or not
    document.getElementById('spOfferSearch').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll('#spOfferLines .sp-form-line').forEach(l => {
            const on = !q || l.dataset.find.includes(q);
            l.hidden = !on;
            if (on) shown++;
        });
        document.getElementById('spOfferNone').hidden = shown > 0;
    });
    setTimeout(() => document.getElementById('spOfferSearch')?.focus(), 60);
}

/* ---------- Offer a new product (UAT part 4, SP4) ----------
   A product the shop does not sell yet: its name, brand, what it is, the
   pet, the supplier's price and a picture. The shop adds it to Inventory or
   declines it with a reason, shown in the Products tab. */

const NEW_STATUS = {
    pending: { text: 'Waiting for the shop', tone: 'warning' },
    added: { text: 'Added to the shop', tone: 'ok' },
    declined: { text: 'Declined', tone: 'danger' },
    cancelled: { text: 'Cancelled by you', tone: 'muted' }
};

function renderNewProducts() {
    const rows = portal.newProducts || [];
    if (!rows.length) { portalRow('newProductsBody', 5, 'None yet. Use Offer a new product above.'); return; }
    const when = ms => ms ? new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    document.getElementById('newProductsBody').innerHTML = rows.map(o => {
        const st = NEW_STATUS[o.status] || { text: o.status, tone: 'ok' };
        return `<tr>
            <td><span class="rp-strong">${escHtml(o.name)}</span><span class="rp-sub">${escHtml([o.brand, o.category, o.species].filter(Boolean).join(' · '))}</span></td>
            <td>${when(o.created_at)}</td>
            <td class="num">${formatCurrency(o.cost_price)}</td>
            <td><span class="rp-badge rp-badge-${st.tone}">${escHtml(st.text)}</span>${o.status === 'declined' && o.decline_reason ? `<span class="rp-sub price-declined" style="margin-left:0;">${escHtml(o.decline_reason)}</span>` : ''}</td>
            <td class="num"><div class="sp-cell-actions"><button class="btn-view" data-new-view="${Number(o.id)}">Details</button>${o.status === 'pending' ? `<button class="btn-secondary sp-btn-cancel" data-new-cancel="${Number(o.id)}">Cancel</button>` : ''}</div></td>
        </tr>`;
    }).join('');
}

function showNewProduct(id) {
    const o = (portal.newProducts || []).find(x => Number(x.id) === id);
    if (!o) return;
    const when = ms => ms ? new Date(Number(ms)).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const st = NEW_STATUS[o.status] || { text: o.status };
    showDetailsDialog(o.name, 'A new product you offered', [
        ['Status', st.text, o.status === 'declined' ? 'danger' : o.status === 'added' ? 'success' : null],
        ['Brand', o.brand], ['Product type', o.category], ['Pet type', o.species], ['Sold by', o.unit_type],
        ['Your price', formatCurrency(o.cost_price)], ['About it', o.description],
        ['Offered', when(o.created_at)], ['Answered', when(o.decided_at)],
        ['Shop\'s reason', o.status === 'declined' ? o.decline_reason : null, 'danger']
    ], { icon: 'add_box', tone: o.status === 'declined' ? 'danger' : 'primary',
         html: o.image_url ? `<img src="${escHtml(o.image_url)}" alt="" class="sp-new-photo">` : '' });
}

function cancelNewProduct(id) {
    if (lockedSay()) return;
    const o = (portal.newProducts || []).find(x => Number(x.id) === id);
    if (!o) return;
    showConfirmDialog('Cancel this offer?', `${escHtml(o.name)} is taken back. The shop no longer sees it.`,
        async () => { if (await portalSend('POST', `/new-products/${id}/cancel`)) loadPortal(); }, 'Cancel offer');
    const keep = document.getElementById('confirmCancelBtn');
    if (keep) keep.textContent = 'Keep it';
}

let newProductImage = null;
function openNewProduct() {
    if (lockedSay()) return;
    newProductImage = null;
    openSpModal('Offer a new product',
        `<p class="sp-form-hint note-banner"><span class="material-symbols-outlined" aria-hidden="true">add_box</span><span>A product the shop does not sell yet. The shop decides whether to add it; you will see the answer in the Products tab.</span></p>
         <div class="form-group">
            <label class="form-label" for="npName">Product name</label>
            <input type="text" class="form-input" id="npName" maxlength="100" placeholder="For example: AOZI Senior Lamb 1kg" required>
            <div class="field-error" id="npNameError" role="alert"></div>
         </div>
         <div class="sp-form-pair">
            <div class="form-group">
                <label class="form-label" for="npBrand">Brand (optional)</label>
                <input type="text" class="form-input" id="npBrand" maxlength="50" placeholder="For example: Aozi">
            </div>
            <div class="form-group">
                <label class="form-label" for="npCategory">Product type (optional)</label>
                <input type="text" class="form-input" id="npCategory" maxlength="60" placeholder="For example: Dry food">
            </div>
         </div>
         <div class="sp-form-pair">
            <div class="form-group">
                <label class="form-label" for="npSpecies">Pet type (optional)</label>
                <select class="form-select" id="npSpecies"><option value="">Any</option><option>Dog</option><option>Cat</option><option>Bird</option><option>Fish</option></select>
            </div>
            <div class="form-group">
                <label class="form-label" for="npUnit">Sold by (optional)</label>
                <input type="text" class="form-input" id="npUnit" maxlength="20" placeholder="For example: bag, can, piece">
            </div>
         </div>
         <div class="form-group">
            <label class="form-label" for="npPrice">Your price to the shop (₱)</label>
            <input type="text" class="form-input" id="npPrice" inputmode="decimal" autocomplete="off" maxlength="11" placeholder="For example: 520.00" required>
            <div class="field-error" id="npPriceError" role="alert"></div>
         </div>
         <div class="form-group">
            <label class="form-label" for="npAbout">About it (optional)</label>
            <input type="text" class="form-input" id="npAbout" maxlength="500" placeholder="Size, flavour, why customers would want it">
         </div>
         <div class="form-group">
            <label class="form-label" for="npPhoto">Picture (optional)</label>
            <input type="file" class="form-input" id="npPhoto" accept="image/png,image/jpeg,image/webp">
            <img id="npPhotoPreview" class="sp-new-photo" alt="" hidden>
            <div class="field-error" id="npPhotoError" role="alert"></div>
         </div>`,
        'Send to the shop',
        async () => {
            const name = document.getElementById('npName'), price = document.getElementById('npPrice');
            const nameText = name.value.trim(), priceText = price.value.trim();
            const nameProblem = !nameText ? 'Enter the product name.'
                : nameText.length < 2 || !/[A-Za-z]/.test(nameText) ? 'The product name needs at least 2 characters, with letters.' : null;
            const priceProblem = !priceText ? 'Enter your price to the shop.' : spPriceProblem(priceText, null);
            document.getElementById('npNameError').textContent = nameProblem || '';
            document.getElementById('npPriceError').textContent = priceProblem || '';
            name.classList.toggle('input-invalid', !!nameProblem);
            price.classList.toggle('input-invalid', !!priceProblem);
            if (nameProblem) { name.focus(); return false; }
            if (priceProblem) { price.focus(); return false; }
            return portalSend('POST', '/new-products', {
                name: nameText, brand: document.getElementById('npBrand').value, category: document.getElementById('npCategory').value,
                species: document.getElementById('npSpecies').value, unit_type: document.getElementById('npUnit').value,
                cost_price: priceText, description: document.getElementById('npAbout').value, image_url: newProductImage
            });
        });
    // said while typing (UAT part 4, S1)
    liveCheck(document.getElementById('npName'), () => {
        const box = document.getElementById('npName'), v = box.value.trim();
        const problem = v && (v.length < 2 || !/[A-Za-z]/.test(v)) ? 'The product name needs at least 2 characters, with letters.' : null;
        document.getElementById('npNameError').textContent = problem || '';
        box.classList.toggle('input-invalid', !!problem);
    });
    liveCheck(document.getElementById('npPrice'), () => {
        const box = document.getElementById('npPrice'), problem = box.value.trim() ? spPriceProblem(box.value.trim(), null) : null;
        document.getElementById('npPriceError').textContent = problem || '';
        box.classList.toggle('input-invalid', !!problem);
    });
    document.getElementById('npPhoto').addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        const err = document.getElementById('npPhotoError'), preview = document.getElementById('npPhotoPreview');
        err.textContent = ''; newProductImage = null; preview.hidden = true;
        if (!file) return;
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { err.textContent = 'Choose a PNG, JPG or WEBP picture.'; e.target.value = ''; return; }
        if (file.size > 10 * 1024 * 1024) { err.textContent = 'The picture is larger than 10 MB. Choose a smaller one.'; e.target.value = ''; return; }
        shrinkPicture(file, 800).then(url => { newProductImage = url; preview.src = url; preview.hidden = false; })
            .catch(() => { err.textContent = 'That picture could not be read. Try another one.'; e.target.value = ''; });
    });
}

/* The picture, made smaller in the browser before it is sent (the same as a
   product's picture in Inventory). */
function shrinkPicture(file, maxSize) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
                else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.75));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
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
    if (lockedSay()) return;
    const id = Number(form.dataset.noteFor);
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    const body = input.value.trim();
    // one press, one note: Send is locked until the note is saved
    if (!body || form.dataset.sending) return;
    form.dataset.sending = '1'; btn.disabled = true; input.readOnly = true; btn.textContent = 'Sending…';
    const ok = await portalSend('POST', `/orders/${id}/messages`, { body });
    delete form.dataset.sending; btn.disabled = false; input.readOnly = false; btn.textContent = 'Send';
    if (ok) {
        const o = orderOf(id);
        if (o) o.message_count = Number(o.message_count || 0) + 1;
        loadNotes(id);
    }
}

/* ---------- Payments and scorecard ---------- */

function renderPayments() {
    const unpaid = portal.orders.filter(o => o.payment_tracked && !o.paid);
    const total = unpaid.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    setTabCount('tabCountPay', unpaid.length, 'unpaid');
    document.getElementById('tabCountPay').title = 'Delivered orders the shop has not marked as paid yet';
    const terms = portal.me && portal.me.payment_terms;
    // the columns below say what each list is; the line here gives the terms
    document.getElementById('paymentsSub').textContent = terms ? `Your payment terms: ${terms}` : 'What the shop owes you and what it has paid';
    renderPaid();
    // due soon or overdue: said at the top of Payments and on the tab (UAT, 31 Oct)
    const today = todayYmd();
    const soonDay = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
    const over = unpaid.filter(o => o.payment_due && o.payment_due < today);
    const soon = unpaid.filter(o => o.payment_due && o.payment_due >= today && o.payment_due <= soonDay);
    const notice = document.getElementById('paymentsNotice');
    notice.innerHTML = over.length || soon.length
        ? `<div class="sp-due-notice ${over.length ? 'over' : ''}"><span class="material-symbols-outlined" aria-hidden="true">${over.length ? 'error' : 'schedule'}</span><span>`
          + [over.length ? `${over.length} payment${over.length === 1 ? ' is' : 's are'} overdue` : '', soon.length ? `${soon.length} ${soon.length === 1 ? 'is' : 'are'} due within 7 days` : ''].filter(Boolean).join(' and ')
          + '. The shop has been reminded.</span></div>' : '';
    if (over.length) setTabCount('tabCountPay', over.length, 'overdue');
    if (!unpaid.length) { portalRow('paymentsBody', 4, 'Nothing is waiting to be paid.'); return; }
    document.getElementById('paymentsBody').innerHTML = unpaid.map(o => `
        <tr>
            <td class="rp-strong">${escHtml(o.po_number)}</td>
            <td>${o.received_day ? escHtml(portalDate(o.received_day)) : '—'}</td>
            <td>${o.payment_due ? escHtml(portalDate(o.payment_due)) + dueBadge(o.payment_due, today) : 'Not set by your terms'}</td>
            <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
        </tr>`).join('');
}

/* How near a payment's due date is, on its own line (UAT part 4, SP7):
   overdue in red, due within 7 days in amber, with the days counted. */
function dueBadge(due, today) {
    const days = Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
    if (days < 0) return ` <span class="rp-badge rp-badge-danger sp-due-badge">${-days} day${days === -1 ? '' : 's'} overdue</span>`;
    if (days === 0) return ' <span class="rp-badge rp-badge-danger sp-due-badge">Due today</span>';
    if (days <= 7) return ` <span class="rp-badge rp-badge-warning sp-due-badge">Due in ${days} day${days === 1 ? '' : 's'}</span>`;
    return '';
}

/* The payments the shop has made, each with its receipt. */
function renderPaid() {
    const paid = portal.orders.filter(o => o.paid).slice(0, 20);
    if (!paid.length) { portalRow('paidBody', 4, 'No payments yet.'); return; }
    document.getElementById('paidBody').innerHTML = paid.map(o => `
        <tr>
            <td class="rp-strong">${escHtml(o.po_number)}</td>
            <td>${o.paid_day ? escHtml(portalDate(o.paid_day)) : '—'}</td>
            <td class="num rp-strong">${formatCurrency(o.total_amount)}</td>
            <td class="num"><button class="btn-view" data-receipt="${Number(o.id)}"><span class="material-symbols-outlined" style="font-size:15px;">receipt_long</span> Receipt</button></td>
        </tr>`).join('');
}

document.addEventListener('click', async e => {
    const b = e.target.closest('#paidBody button[data-receipt], #pastOrdersBody button[data-receipt]');
    if (!b) return;
    try {
        const res = await fetch(`${API_BASE}/supplier-portal/orders/${Number(b.dataset.receipt)}/receipt`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'The receipt could not be opened', 'error'); return; }
        showPaymentReceipt(data.data);
    } catch (err) { showToast(couldNot('open the receipt', err), 'error'); }
});

function renderScorecard() {
    const s = portal.score || {};
    const r = s.stars;
    const fig = document.getElementById('figRating');
    if (fig) {
        fig.innerHTML = r && r.rated
            ? Array.from({ length: 5 }, (_, i) => `<span class="${i < r.stars ? 'on' : ''}">${i < r.stars ? '★' : '☆'}</span>`).join('')
            : '—';
        fig.setAttribute('aria-label', r && r.rated ? `${r.stars} of 5 stars` : 'Not rated yet');
        document.getElementById('figRatingNote').textContent = !r || !r.rated ? 'Not rated yet'
            : r.meets_standard ? 'Meets the standard (4 stars or more)' : 'Below the standard (needs 4 stars)';
    }
    // How you are doing, laid out (UAT part 4, SP10): the stars and what they
    // mean on the left, the five checks behind them on the right, the four
    // figures underneath.
    const box = document.getElementById('scorecard');
    if (!r) { box.innerHTML = '<p class="rp-loading">Not rated yet.</p>'; return; }
    const stars = Array.from({ length: 5 }, (_, i) => `<span class="${i < r.stars ? 'on' : ''}">${i < r.stars ? '★' : '☆'}</span>`).join('');
    const badge = !r.rated ? '<span class="rp-badge rp-badge-muted">Not rated yet</span>'
        : r.meets_standard ? '<span class="rp-badge rp-badge-ok">Meets the standard</span>'
        : '<span class="rp-badge rp-badge-warning">Below the standard</span>';
    const checks = (r.checks || []).map(c => `
        <li class="${c.met ? 'met' : 'missed'}">
            <span class="sp-check-mark" aria-label="${c.met ? 'Met' : 'Not met'}">${c.met ? '✓' : '✗'}</span>
            <span class="sp-check-label">${escHtml(c.label)}</span>
            <span class="sp-check-value">${escHtml(c.value)}</span>
        </li>`).join('');
    const tile = (label, value, note) => `
        <div class="sp-score-fig">
            <span class="sp-score-fig-label">${label}</span>
            <span class="sp-score-fig-value">${value}</span>
            <span class="sp-score-fig-note">${note}</span>
        </div>`;
    box.innerHTML = `
        <div class="sp-score-top">
            <div class="sp-score-stars">
                <div class="sp-score-big" aria-label="${r.stars} of 5 stars">${stars}</div>
                <div class="sp-score-line"><strong>${r.stars} of 5 stars</strong>${badge}</div>
                <p>${escHtml(r.summary)}</p>
                <p class="sp-score-rule">One star for each check met. The standard is ${r.standard} stars or more. Counted from orders received in the last 12 months.</p>
            </div>
            <ul class="sp-score-checks">${checks}</ul>
        </div>
        ${!s.delivered ? '' : `<div class="sp-score-figs">
            ${tile('Delivered on time', s.on_time_percent != null ? s.on_time_percent + '%' : '—',
                s.on_time_of ? `By the promised date, out of ${s.on_time_of} order${s.on_time_of === 1 ? '' : 's'} with a date` : 'No order had a date to judge against')}
            ${tile('Delivered in full', s.complete_percent != null ? s.complete_percent + '%' : '—', 'Every item arrived in the quantity ordered')}
            ${tile('Average time to deliver', s.average_days != null ? s.average_days + ' days' : '—', 'From the order being placed to being received')}
            ${tile('Orders delivered', formatNumber(s.delivered), 'In the last 12 months')}
        </div>`}`;
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
