/* Reports → Stock planning.

   One request (/predictions/overview) returns every product already classified
   by the server: how much it is expected to sell, how long its stock will last,
   whether to reorder and how much. This file only presents that — it makes no
   decisions of its own, so the numbers on screen always agree with each other. */

const PRED_API = `${API_BASE}/predictions`;
let forecastChart = null;
let seasonalChart = null;
let dowChart = null;
let plan = null;                 // the overview payload
let planFilter = 'all';
let planSearch = '';
let planLoading = false;
const PRED_PAGE_SIZE = 10;
let predDisplayCount = PRED_PAGE_SIZE;
let reorderDisplayCount = PRED_PAGE_SIZE;

const STOCK_LABEL = {
    out: { text: 'Out of stock', tone: 'danger' },
    reorder_now: { text: 'Reorder now', tone: 'danger' },
    reorder_soon: { text: 'Reorder soon', tone: 'warning' },
    ok: { text: 'Enough stock', tone: 'ok' }
};
const TREND_LABEL = { up: 'Rising', down: 'Falling', stable: 'Steady' };

/* ---------- Loading ---------- */

async function loadStockPlanning(force) {
    if (planLoading || (plan && !force)) return;
    planLoading = true;
    wirePlanControls();
    const controller = new AbortController();
    // The first forecast after the server starts can take a while to compute.
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const [overview, trends] = await Promise.all([
            fetch(`${PRED_API}/overview`, { headers: getAuthHeaders(), signal: controller.signal }).then(r => r.json()),
            fetch(`${PRED_API}/trends`, { headers: getAuthHeaders(), signal: controller.signal }).then(r => r.json()).catch(() => null)
        ]);
        if (!overview.success) throw new Error(overview.error || 'Stock planning failed');
        plan = overview.data;
        renderPlan();
        if (trends && trends.success) renderPatterns(trends.data.seasonality || {});
    } catch (error) {
        console.error('Error loading stock planning:', error);
        const msg = error.name === 'AbortError'
            ? 'The forecast is taking longer than usual. Press Refresh in a minute.'
            : 'Stock planning could not be loaded. Press Refresh to try again.';
        orderListMessage(msg);
        setRow('predictionsTableBody', 6, msg);
    } finally {
        clearTimeout(timeout);
        planLoading = false;
    }
}

function refreshAnalytics() {
    predDisplayCount = PRED_PAGE_SIZE;
    reorderDisplayCount = PRED_PAGE_SIZE;
    orderListMessage('Working out what to order…');
    setRow('predictionsTableBody', 6, 'Loading products…');
    loadStockPlanning(true);
}

function setRow(id, cols, text) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<tr><td colspan="${cols}" class="rp-loading">${escHtml(text)}</td></tr>`;
}

let planControlsWired = false;
function wirePlanControls() {
    if (planControlsWired) return;
    planControlsWired = true;
    document.querySelectorAll('#demandFilters button').forEach(b => b.addEventListener('click', () => {
        planFilter = b.dataset.demand;
        document.querySelectorAll('#demandFilters button').forEach(x => x.classList.toggle('active', x === b));
        predDisplayCount = PRED_PAGE_SIZE;
        renderAllProducts();
    }));
    const search = document.getElementById('planSearch');
    if (search) search.addEventListener('input', () => {
        planSearch = search.value.trim().toLowerCase();
        predDisplayCount = PRED_PAGE_SIZE;
        renderAllProducts();
    });
    document.getElementById('predictionsTableBody').addEventListener('click', e => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        row.closest('.rp-card').after(document.getElementById('productDetail'));
        openProductDetail(Number(row.dataset.id));
    });
    document.getElementById('orderList').addEventListener('click', onOrderListClick);
    document.getElementById('orderLater').addEventListener('click', onOrderListClick);
    ['excessBody', 'expiryBody', 'guessBody'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            const row = e.target.closest('tr[data-id]');
            if (!row) return;
            // the product's forecast opens under the list it was picked from
            row.closest('.rp-card').after(document.getElementById('productDetail'));
            openProductDetail(Number(row.dataset.id));
        });
    });
    document.querySelectorAll('.plan-view').forEach(b => b.addEventListener('click', () => showPlanView(b.dataset.view)));
    // Sales patterns: days of the week or months, in one card
    document.querySelectorAll('#patternSeg button').forEach(b => b.addEventListener('click', () => {
        const which = b.dataset.pattern;
        document.querySelectorAll('#patternSeg button').forEach(x => {
            x.classList.toggle('active', x === b);
            x.setAttribute('aria-selected', x === b ? 'true' : 'false');
        });
        document.querySelectorAll('[data-pattern-pane]').forEach(el => { el.hidden = el.dataset.patternPane !== which; });
        document.getElementById('patternSub').textContent = which === 'days'
            ? 'Average items sold per day, last 6 months' : 'Total items sold, last 12 months';
    }));
    let start = new URLSearchParams(window.location.search).get('view');
    if (!start) try { start = localStorage.getItem('planView'); } catch (e) {}
    showPlanView(start);
}

/* ---------- Words ---------- */

function planDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function lastsText(p) {
    if (p.stock <= 0) return 'None left';
    if (p.days_left == null) return 'No recent sales';
    if (p.days_left > 180) return 'Over 6 months';
    if (p.days_left >= 60) return `About ${Math.round(p.days_left / 30)} months`;
    if (p.days_left >= 14) return `About ${Math.round(p.days_left / 7)} weeks`;
    return p.days_left === 1 ? '1 day' : `${p.days_left} days`;
}

/** Why a product is on the reorder list, in one plain sentence. */
function reorderReason(p) {
    if (p.stock_status === 'out') return `Nothing left; reorder level is ${formatQty(p.reorder_level)}`;
    const below = p.stock <= p.reorder_level;
    if (p.days_left != null && p.days_left <= plan.lead_time_days) {
        return `Runs out in ${lastsText(p).toLowerCase()} — sooner than a delivery arrives`;
    }
    if (below) return `At or below its reorder level of ${formatQty(p.reorder_level)}`;
    return `Runs out in ${lastsText(p).toLowerCase()}`;
}

function badge(status) {
    const s = STOCK_LABEL[status] || STOCK_LABEL.ok;
    return `<span class="rp-badge rp-badge-${s.tone}">${s.text}</span>`;
}

/* ---------- Rendering ---------- */

function renderPlan() {
    const t = plan.totals;
    const stale = plan.days_since_last_sale != null && plan.days_since_last_sale > 7;

    // Stale sales are the single most common reason this page looks empty, so
    // say so in words instead of leaving a row of zeros to be puzzled over.
    // A gap in recorded sales is the most common reason this page looks low,
    // so say so in words instead of leaving small numbers to be puzzled over.
    const thin = !stale && plan.last_sale_date != null && plan.recent_sale_days <= 5;
    showNotice('planNotice', plan.last_sale_date == null
        ? 'No sales have been recorded yet. Forecasts will appear once the shop starts recording sales.'
        : stale
            ? `The last sale on record was ${planDate(plan.last_sale_date)}, ${plan.days_since_last_sale} days ago. `
              + 'Forecasts lean on recent sales, so they will stay low until new sales are recorded. Stock levels and reorder levels below are still current.'
            : thin
                ? `Sales were recorded on only ${plan.recent_sale_days} of the last 30 days. Forecasts lean on recent sales, so they are lower than usual, `
                  + 'and many products show as not selling. They will correct themselves as daily sales are recorded.'
                : '');
    // one short line up top; what the forecast is based on is in "About this forecast"
    document.getElementById('planLead').textContent = `Forecast for the next ${plan.forecast_days} days`
        + (plan.last_sale_date && !stale ? `, from sales up to ${planDate(plan.last_sale_date)}.` : '.');
    // the important parts stand out: the days, the dates, what was left out (UAT part 4, A13)
    const b = t => `<strong>${escHtml(t)}</strong>`;
    const left = (plan.excluded && plan.excluded.ranges) || [];
    const why = { no_items: 'sales were recorded without their items', closed: 'nothing was recorded' };
    document.getElementById('planCaption').innerHTML =
        `<p>Based on ${plan.history_days ? b(formatNumber(plan.history_days) + ' days') + ' of sales on record' + (plan.model && plan.model.fit_days ? ` (the model reads the last ${b(plan.model.fit_days + ' days')})` : '') : 'the sales on record'}.</p>`
        + `<p>Forecasts cover the ${b('next ' + plan.forecast_days + ' days')}.`
        + (plan.last_sale_date ? ` Last sale recorded ${b(planDate(plan.last_sale_date))}.` : '') + '</p>'
        + (left.length ? `<p class="rp-left-out-head"><mark>Not counted: ${formatNumber(plan.excluded.days)} day${plan.excluded.days === 1 ? '' : 's'}</mark></p><ul class="rp-left-out">`
            + left.map(r => `<li>${b(r.from === r.to ? planDate(r.from) : planDate(r.from) + ' to ' + planDate(r.to))} · ${r.days} day${r.days === 1 ? '' : 's'}: ${escHtml(why[r.reason] || 'no usable record')}</li>`).join('') + '</ul>' : '');
    const lead = document.getElementById('howLead');
    if (lead) lead.textContent = plan.lead_time_days;

    document.getElementById('kpiForecastUnits').textContent = formatNumber(t.expected_units) + (t.expected_units === 1 ? ' item' : ' items');
    document.getElementById('kpiForecastRevenue').textContent = formatCurrency(t.expected_revenue);
    renderForecastBreakdown();
    document.getElementById('kpiAccuracy').textContent = t.accuracy != null ? formatDecimal(t.accuracy, 0) + '%' : 'Not available';
    document.getElementById('kpiAccuracyNote').textContent = t.accuracy != null
        ? 'How close the forecast came in a test on the last two weeks'
        : 'Needs recent sales to test against';
    // the two facts shown on the folded "About this forecast" bar
    document.getElementById('aboutAccuracy').textContent = t.accuracy != null
        ? `${formatDecimal(t.accuracy, 0)}% accurate in its last test` : 'Accuracy not tested yet';
    document.getElementById('aboutHistory').textContent = plan.history_days
        ? `Learns from ${formatNumber(plan.history_days)} days of sales` : 'Learns from the sales on record';

    renderGuide();
    renderAttention();
    renderReorder();
    renderGuess();
    renderExcess();
    renderExpiry();
    renderAllProducts();
    renderDemandGroups();
    renderModel();
}

/* The four tabs at the top: what to order, what is expiring, what is
   overstocked, and the forecast they come from. Each says what it holds in
   words ("1 product, out of stock"); the dot carries the urgency. */
function renderAttention() {
    const t = plan.totals;
    const today = ymd(new Date());
    const products = n => `${formatNumber(n)} product${n === 1 ? '' : 's'}`;
    const reorder = plan.products.filter(p => p.stock_status !== 'ok');
    const dueToday = reorder.filter(p => p.order_by && p.order_by <= today).length;
    const atRisk = plan.products.filter(p => p.expired_units > 0 || p.expiry_risk_units > 0);
    const expired = atRisk.filter(p => p.expired_units > 0).length;
    const expiring = atRisk.length - expired;
    const excess = plan.products.filter(p => p.excess_units > 0).length;
    setView('viewReorder',
        !reorder.length ? 'Nothing to order'
            : products(reorder.length) + (t.out_of_stock ? `, ${formatNumber(t.out_of_stock)} out of stock` : dueToday ? `, ${formatNumber(dueToday)} to order today` : ', running low'),
        !reorder.length ? 'ok' : (t.out_of_stock || dueToday ? 'red' : 'amber'));
    setView('viewExpiry',
        !atRisk.length ? 'Nothing expired or at risk' : `${formatNumber(expired)} expired, ${formatNumber(expiring)} at risk`,
        expired ? 'red' : expiring ? 'amber' : 'ok');
    setView('viewExcess',
        excess ? `${products(excess)}, ${formatCompactCurrency(t.excess_value)} tied up` : 'No product is overstocked',
        excess ? 'grey' : 'ok');
    setView('viewForecast', `${formatNumber(t.expected_units)} item${t.expected_units === 1 ? '' : 's'} in the next ${plan.forecast_days} days`, 'none');
}

function setView(id, note, tone) {
    const tab = document.getElementById(id);
    if (!tab) return;
    tab.dataset.tone = tone;
    tab.querySelector('.plan-view-note').textContent = note;
}

/* One view at a time. The choice is kept for the next visit, and ?view=
   (reorder, expiry, excess, forecast) opens one directly. */
const PLAN_VIEWS = ['reorder', 'expiry', 'excess', 'forecast'];
function showPlanView(view) {
    if (!PLAN_VIEWS.includes(view)) view = 'reorder';
    document.querySelectorAll('.plan-view').forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.plan-pane').forEach(p => { p.hidden = p.dataset.pane !== view; });
    try { localStorage.setItem('planView', view); } catch (e) {}
}

/* ---------- Order this week (forecast mock-up 1) ----------
   One line per product: why, how many and what it costs, the last day to
   order (from its supplier's own delivery time), and a Reorder button. Red is
   today or tomorrow, amber the rest of the week; later ones sit under it. */
function orderListMessage(text) {
    const list = document.getElementById('orderList');
    if (list) list.innerHTML = `<p class="rp-loading">${escHtml(text)}</p>`;
    ['orderChips', 'orderLater'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
}
const weekday = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''; };
function addDaysYmd(day, n) { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
const orderCost = p => (Number(p.suggested_order) || 0) * (Number(p.cost_price) || 0);

/** Why a product is on the list, as a shopkeeper would say it. */
function orderWhy(p) {
    const wait = p.supplier_name ? `${p.supplier_name} takes about ${p.lead_time_days} day${p.lead_time_days === 1 ? '' : 's'} to deliver` : '';
    const coming = p.on_order > 0 ? ` ${formatQty(p.on_order)} already on order.` : '';
    if (p.stock_status === 'out') return `Nothing left on the shelf.${wait ? ' ' + wait + '.' : ''}${coming}`;
    if (p.days_left != null && p.days_left <= p.lead_time_days) return `Runs out in about ${p.days_left} day${p.days_left === 1 ? '' : 's'}, before a delivery could arrive.${coming}`;
    if (p.stock <= p.reorder_level) return `At or below its reorder level of ${formatQty(p.reorder_level)}.${coming}`;
    const lasts = p.days_left != null ? `Runs out in about ${p.days_left} days` : 'Running low';
    return `${lasts}${wait ? '. ' + wait + ', so order by ' + weekday(p.order_by).split(',')[0] : ''}.${coming}`;
}

function orderRow(p, today) {
    const urgent = p.stock_status === 'out' || !p.order_by || p.order_by <= addDaysYmd(today, 1);
    const when = !p.order_by || p.order_by <= today ? 'Today' : weekday(p.order_by);
    const manage = typeof canManage === 'function' && canManage();
    const action = p.suggested_order > 0 && p.supplier_id && manage
        ? `<button type="button" class="btn-secondary order-btn" data-order="${p.product_id}">Reorder ${formatNumber(p.suggested_order)}</button>`
        : `<span class="rp-sub">${p.suggested_order > 0 && !p.supplier_id ? 'No supplier set' : p.on_order > 0 ? 'Already on order' : ''}</span>`;
    return `<div class="order-row" data-id="${p.product_id}" tabindex="0">
        <span class="order-dot ${urgent ? 'red' : 'amber'}" aria-hidden="true"></span>
        <div class="order-what"><b>${escHtml(p.name)}</b><span>${escHtml(orderWhy(p))}</span></div>
        <div class="order-fig"><span>Order</span><b>${p.suggested_order > 0 ? formatNumber(p.suggested_order) + ' pcs' + (orderCost(p) ? ' · ' + formatCurrency(orderCost(p)) : '') : '—'}</b></div>
        <div class="order-fig"><span>Order by</span><b class="${urgent ? 'is-red' : 'is-amber'}">${escHtml(when)}</b></div>
        <div class="order-act">${action}</div>
    </div>`;
}

let orderLaterOpen = false;
function renderReorder() {
    const today = ymd(new Date());
    const weekEnd = addDaysYmd(today, 7);
    const rows = plan.products.filter(p => p.stock_status !== 'ok')
        .sort((a, b) => (a.order_by || '0') < (b.order_by || '0') ? -1 : (a.order_by || '0') > (b.order_by || '0') ? 1 : a.name.localeCompare(b.name));
    const thisWeek = rows.filter(p => p.stock_status === 'out' || !p.order_by || p.order_by <= weekEnd);
    const later = rows.filter(p => !thisWeek.includes(p));
    const orderable = thisWeek.filter(p => p.suggested_order > 0 && p.supplier_id);
    const createBtn = document.getElementById('createOrdersBtn');
    if (createBtn) {
        createBtn.hidden = !(orderable.length && typeof canManage === 'function' && canManage());
        const total = orderable.reduce((a, p) => a + orderCost(p), 0);
        document.getElementById('createOrdersLabel').textContent = `Order all ${orderable.length}` + (total ? ' · ' + formatCurrency(total) : '');
    }
    const soon = thisWeek.filter(p => p.stock_status === 'out' || !p.order_by || p.order_by <= addDaysYmd(today, 1)).length;
    const suppliers = new Set(orderable.map(p => p.supplier_id)).size;
    document.getElementById('orderChips').innerHTML = thisWeek.length ? [
        soon ? `<span class="rp-badge rp-badge-danger">${formatNumber(soon)} to order today or tomorrow</span>` : '',
        thisWeek.length - soon ? `<span class="rp-badge rp-badge-warning">${formatNumber(thisWeek.length - soon)} later this week</span>` : '',
        suppliers ? `<span class="rp-badge rp-badge-muted">${suppliers} supplier${suppliers === 1 ? '' : 's'} · ${suppliers} email${suppliers === 1 ? '' : 's'}</span>` : ''
    ].join('') : '';
    document.getElementById('orderList').innerHTML = thisWeek.length
        ? thisWeek.map(p => orderRow(p, today)).join('')
        : `<p class="order-none"><span class="order-dot green" aria-hidden="true"></span> Nothing to order this week.${later.length ? '' : ' Every product has enough stock for the next three weeks.'}</p>`;
    const names = later.slice(0, 3).map(p => p.name).join(', ') + (later.length > 3 ? `, and ${later.length - 3} more` : '');
    document.getElementById('orderLater').innerHTML = !later.length ? '' : `
        <div class="order-later-head"><span class="order-dot green" aria-hidden="true"></span>
            <span><b>Later:</b> ${formatNumber(later.length)} more product${later.length === 1 ? '' : 's'} to order in the next weeks (${escHtml(names)}). Nothing to do yet.</span>
            <button type="button" class="btn-secondary" data-later>${orderLaterOpen ? 'Hide them' : 'Show them'}</button></div>
        ${orderLaterOpen ? later.map(p => orderRow(p, today)).join('') : ''}`;
}

function onOrderListClick(e) {
    const btn = e.target.closest('[data-order]');
    if (btn) { e.stopPropagation(); createPlannedOrders([Number(btn.dataset.order)]); return; }
    if (e.target.closest('[data-later]')) { orderLaterOpen = !orderLaterOpen; renderReorder(); return; }
    const row = e.target.closest('.order-row[data-id]');
    if (!row) return;
    row.closest('.rp-card').after(document.getElementById('productDetail'));
    openProductDetail(Number(row.dataset.id));
}

/* Purchase orders for this week's list (or for the products given), one per
   supplier, each emailed to its supplier, with the suggested quantities. */
function createPlannedOrders(ids) {
    const today = ymd(new Date()), weekEnd = addDaysYmd(today, 7);
    const pick = Array.isArray(ids) ? p => ids.includes(p.product_id)
        : p => p.stock_status === 'out' || !p.order_by || p.order_by <= weekEnd;
    const lines = plan.products.filter(p => p.stock_status !== 'ok' && p.suggested_order > 0 && p.supplier_id && pick(p));
    if (!lines.length) { showToast('Nothing on the list can be ordered right now', 'warning'); return; }
    const suppliers = new Set(lines.map(p => p.supplier_id)).size;
    const total = lines.reduce((a, p) => a + orderCost(p), 0);
    const what = lines.length === 1
        ? `This orders <strong>${formatNumber(lines[0].suggested_order)} of ${escHtml(lines[0].name)}</strong>${total ? ` (${formatCurrency(total)})` : ''} from ${escHtml(lines[0].supplier_name || 'its supplier')}`
        : `This creates ${suppliers} purchase order${suppliers === 1 ? '' : 's'} covering ${lines.length} products${total ? ` (${formatCurrency(total)})` : ''}`;
    showConfirmDialog(lines.length === 1 ? 'Reorder ' + escHtml(lines[0].name) : 'Order this week',
        `${what}, and <strong>emails ${suppliers === 1 ? 'the order to the supplier' : 'each order to its supplier'} straight away</strong>.`,
        async () => {
            try {
                const res = await fetch(`${API_BASE}/purchase-orders/auto-generate`, {
                    method: 'POST', headers: getAuthHeaders(),
                    body: JSON.stringify({ items: lines.map(p => ({ product_id: p.product_id, quantity: p.suggested_order })) })
                });
                const data = await res.json();
                if (!data.success) { showToast(data.message || 'The orders could not be created', 'error'); return; }
                const warnings = Array.isArray(data.warnings) && data.warnings.length
                    ? '<br><br>' + data.warnings.map(w => escHtml(w)).join('<br>') : '';
                showSuccessDialog('Purchase orders created', escHtml(data.message || 'Done.') + warnings, { icon: 'local_shipping', stay: !!warnings });
                loadStockPlanning(true);
            } catch (error) {
                console.error('Creating orders failed:', error);
                showToast('The orders could not be created', 'error');
            }
        }, 'Order and email');
}

/* ---------- Did it guess right? (forecast mock-up 3) ----------
   The last test, as the shop sees it: what FETCH expected for the hidden two
   weeks, what really sold, and the same for the best sellers one by one. */
function renderGuess() {
    const card = document.getElementById('guessCard');
    const test = plan.totals && plan.totals.accuracy_test;
    const tested = plan.products.filter(p => p.test_sold != null && p.test_expected != null);
    if (!card) return;
    if (!test || !(test.actual_units > 0) || !tested.length) { card.hidden = true; return; }
    card.hidden = false;
    const exp = test.predicted_units, sold = test.actual_units;
    const ratio = sold > 0 ? exp / sold : 0;
    const verdict = ratio > 1.2 ? { word: 'Too high', tone: 'amber', note: ratio >= 1.8 ? `about ${formatDecimal(ratio, 1)}× what sold` : `${Math.round((ratio - 1) * 100)}% more than sold` }
        : ratio < 0.8 ? { word: 'Too low', tone: 'amber', note: `${Math.round((1 - ratio) * 100)}% less than sold` }
        : { word: 'Close', tone: 'green', note: 'within a fifth of what sold' };
    const range = test.from && test.to ? `${planDate(test.from).replace(/, \d{4}$/, '')} – ${planDate(test.to)}` : 'the last two weeks on record';
    // days with no sales recorded inside the test make the guess look worse than it is
    const gap = test.from && (plan.excluded && plan.excluded.ranges || []).some(r => r.to >= test.from && r.from <= test.to);
    document.getElementById('guessTiles').innerHTML = `
        <div class="guess-tile"><span>It expected</span><b>${formatNumber(exp)} items</b><small>${escHtml(range)}</small></div>
        <div class="guess-tile"><span>You sold</span><b>${formatNumber(sold)} items</b><small>the same days</small></div>
        <div class="guess-tile is-${verdict.tone}"><span>So it guessed</span><b>${verdict.word}</b><small>${verdict.note}${gap && ratio > 1.2 ? ', partly because some days had no sales recorded' : ''}</small></div>`;
    const best = tested.slice().sort((a, b) => b.test_sold - a.test_sold || b.test_expected - a.test_expected).slice(0, 8);
    const close = p => Math.abs(p.test_expected - p.test_sold) <= Math.max(1, p.test_sold * 0.25);
    const rows = best.map(p => {
        const e = Math.round(p.test_expected);
        const how = close(p) ? ['Right on', 'ok', '✓ close'] : p.test_expected > p.test_sold ? ['Sold less than expected', 'warning', '↑ guessed high'] : ['Sold more than expected', 'warning', '↓ guessed low'];
        return `<tr data-id="${p.product_id}"><td class="rp-strong">${escHtml(p.name)}</td><td class="num">${formatNumber(e)}</td><td class="num rp-strong">${formatNumber(p.test_sold)}</td>
            <td>${how[0]} <span class="rp-badge rp-badge-${how[1]}">${how[2]}</span></td></tr>`;
    }).join('');
    document.getElementById('guessBody').innerHTML = rows;
    const good = best.filter(close).length;
    // the usual reason the total and the best sellers disagree: small expected
    // sales spread over many products that then sold nothing
    const idle = tested.filter(p => p.test_sold === 0 && p.test_expected >= 0.5);
    const idleUnits = Math.round(idle.reduce((a, p) => a + p.test_expected, 0));
    const lowBest = best.filter(p => !close(p) && p.test_expected < p.test_sold).length;
    const why = ratio > 1.2 && lowBest >= best.length / 2 && idle.length
        ? `<b>Why:</b> it expected about ${formatNumber(idleUnits)} sales from ${formatNumber(idle.length)} slow products that sold nothing in those days, and too few of your best sellers. `
        : '';
    const advice = lowBest >= best.length / 2
        ? '<b>So:</b> for your best sellers, expect more than it says and check their shelf yourself; for slow products, expect less.'
        : '<b>So:</b> trust it most for products marked <b>Sure</b> in the list below; treat slow sellers as a rough guess and check the shelf yourself.';
    document.getElementById('guessMeans').innerHTML = why + advice;
    document.getElementById('guessFoot').innerHTML = `<span class="rp-badge rp-badge-${good >= best.length / 2 ? 'ok' : 'warning'}">Close for ${good} of your ${best.length} best sellers</span> <span class="rp-sub" style="display:inline">It gets better as more sales are recorded at the till.</span>`;
}

/* ---------- Too much stock, and stock that will expire ---------- */

let excessShown = PRED_PAGE_SIZE, expiryShown = PRED_PAGE_SIZE;

function renderExcess() {
    const rows = plan.products.filter(p => p.excess_units > 0).sort((a, b) => b.excess_value - a.excess_value || b.excess_units - a.excess_units);
    document.getElementById('excessSub').textContent = rows.length
        ? `${rows.length} product${rows.length === 1 ? '' : 's'} holding ${formatCurrency(plan.totals.excess_value)} more stock than the next three months need`
        : 'More than three months of stock at the expected rate of sale, or stock that is not selling';
    if (!rows.length) { setRow('excessBody', 5, 'No product is overstocked.'); document.getElementById('excessPagination').innerHTML = ''; return; }
    document.getElementById('excessBody').innerHTML = rows.slice(0, excessShown).map(p => `
        <tr data-id="${p.product_id}" tabindex="0">
            <td><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td>${p.excess_reason === 'not_selling'
                ? 'Nothing sold in the last 30 days'
                : 'Lasts ' + escHtml(lastsText(p).toLowerCase()) + ' at ' + formatDecimal(p.per_week, 1) + ' a week'}</td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="num">${formatQty(p.excess_units)}</td>
            <td class="num rp-strong">${p.excess_value > 0 ? formatCurrency(p.excess_value) : '—'}</td>
        </tr>`).join('');
    updatePagination('excessPagination', rows, excessShown, 'showMoreExcess', 'showLessExcess', PRED_PAGE_SIZE);
}
function showMoreExcess() { excessShown += PRED_PAGE_SIZE; renderExcess(); }
function showLessExcess() { excessShown = Math.max(PRED_PAGE_SIZE, excessShown - PRED_PAGE_SIZE); renderExcess(); }

function renderExpiry() {
    /* About to expire first, soonest at the top, then what has already
       expired, the most recent first; each kind its own colour so they are
       not confused (UAT, 1 Nov): amber "At risk", red "Expired". */
    const all = plan.products.filter(p => p.expired_units > 0 || p.expiry_risk_units > 0);
    const soonest = (a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0);
    const atRisk = all.filter(p => !(p.expired_units > 0)).sort(soonest);
    const gone = all.filter(p => p.expired_units > 0).sort((a, b) => soonest(b, a));
    const rows = atRisk.concat(gone);
    document.getElementById('expirySub').textContent = rows.length
        ? `${atRisk.length ? atRisk.length + ' likely to expire before selling out' + (plan.totals.expiry_risk_value > 0 ? `, worth ${formatCurrency(plan.totals.expiry_risk_value)} at cost` : '') + '. ' : ''}`
            + `${gone.length ? gone.length + ' already expired with stock on the shelf.' : ''}`
        : 'Stock expected to still be on the shelf on its expiry date, and stock already expired';
    if (!rows.length) { setRow('expiryBody', 5, 'Nothing is expected to expire unsold.'); document.getElementById('expiryPagination').innerHTML = ''; return; }
    let lastKind = null;
    document.getElementById('expiryBody').innerHTML = rows.slice(0, expiryShown).map(p => {
        const expired = p.expired_units > 0;
        const kind = expired ? 'expired' : 'risk';
        // a heading line where one kind ends and the other starts
        const head = kind === lastKind ? '' : `<tr class="rp-risk-group ${kind}"><td colspan="5">${expired
            ? `Already expired <span>· ${gone.length}</span>` : `About to expire <span>· ${atRisk.length}</span>`}</td></tr>`;
        lastKind = kind;
        const when = expired
            ? `<span class="rp-risk-chip expired">Expired</span><span class="rp-sub">${escHtml(planDate(p.expires_on))}</span>`
            : `<span class="rp-risk-chip risk">At risk</span>${escHtml(planDate(p.expires_on))}<span class="rp-sub">in ${p.days_to_expiry} day${p.days_to_expiry === 1 ? '' : 's'}</span>`;
        const left = expired ? p.expired_units : p.expiry_risk_units;
        return head + `<tr data-id="${p.product_id}" tabindex="0" class="rp-risk-row ${kind}">
            <td><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td>${when}</td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="num">${formatQty(left)}${expired ? '<span class="rp-sub">remove from the shelf</span>' : ''}</td>
            <td class="num rp-strong">${expired ? '—' : (p.expiry_risk_value > 0 ? formatCurrency(p.expiry_risk_value) : '—')}</td>
        </tr>`;
    }).join('');
    updatePagination('expiryPagination', rows, expiryShown, 'showMoreExpiry', 'showLessExpiry', PRED_PAGE_SIZE);
}
function showMoreExpiry() { expiryShown += PRED_PAGE_SIZE; renderExpiry(); }
function showLessExpiry() { expiryShown = Math.max(PRED_PAGE_SIZE, expiryShown - PRED_PAGE_SIZE); renderExpiry(); }

/* "How the forecast works": open until it is closed once (remembered on
   this browser), with a worked example taken from one of the shop's own
   products, and how far to trust the numbers in one plain sentence. */
function renderGuide() {
    const guide = document.getElementById('planGuide');
    if (!guide) return;
    if (!guide.dataset.ready) {
        guide.dataset.ready = '1';
        let closed = false;
        try { closed = localStorage.getItem('planGuideClosed') === '1'; } catch (e) {}
        guide.open = !closed;
        guide.addEventListener('toggle', () => { try { localStorage.setItem('planGuideClosed', guide.open ? '0' : '1'); } catch (e) {} });
    }
    // a product that sells regularly and has stock makes the clearest example
    const pick = [...plan.products]
        .filter(p => p.expected_30d >= 3 && p.sold_30d >= 3 && p.stock > 0 && p.basis !== 'new')
        .sort((a, b) => b.sold_30d - a.sold_30d)[0];
    // the example as four short steps, from one of the shop's own products
    const ex = document.getElementById('planExample');
    if (pick) {
        const todo = pick.stock_status !== 'ok' ? ['Order more', 'is-red']
            : pick.excess_units > 0 ? ['Too much, stop ordering', 'is-grey']
            : pick.expiry_risk_units > 0 ? ['Sell it first, it may expire', 'is-amber']
            : ['Enough, nothing to do', 'is-green'];
        const step = (label, value) => `<div class="plan-ex-step"><span>${label}</span><b>${value}</b></div>`;
        ex.innerHTML = `<span class="plan-example-tag">Example: ${escHtml(pick.name)}</span>`
            + '<div class="plan-ex-flow">'
            + step('Sold last month', formatQty(pick.sold_30d))
            + '<span class="plan-ex-arrow" aria-hidden="true">→</span>' + step('Expects next month', 'about ' + formatNumber(Math.round(pick.expected_30d)))
            + '<span class="plan-ex-arrow" aria-hidden="true">→</span>' + step('On your shelf', formatQty(pick.stock))
            + '<span class="plan-ex-arrow" aria-hidden="true">→</span>' + `<div class="plan-ex-step plan-ex-todo ${todo[1]}"><span>So</span><b>${todo[0]}</b></div>`
            + '</div>';
        ex.hidden = false;
    } else ex.hidden = true;
}

/* What makes up Expected to sell and Expected revenue (UAT part 4, A14):
   the categories that bring the most, then the rest, each with its share.
   Both figures are the sum over products of expected units (× price for
   revenue), so the lines add up to the figure above them. */
function renderForecastBreakdown() {
    const groups = new Map();
    plan.products.forEach(p => {
        const key = p.category || 'No category';
        const g = groups.get(key) || { name: key, units: 0, revenue: 0, products: 0 };
        g.units += Number(p.expected_30d) || 0;
        g.revenue += (Number(p.expected_30d) || 0) * (Number(p.unit_price) || 0);
        if ((Number(p.expected_30d) || 0) >= 0.5) g.products++;
        groups.set(key, g);
    });
    const all = [...groups.values()];
    const totalUnits = all.reduce((a, g) => a + g.units, 0), totalRev = all.reduce((a, g) => a + g.revenue, 0);
    const lines = (key, total, fmt, unitWord) => {
        const sorted = [...all].filter(g => g[key] > 0).sort((a, b) => b[key] - a[key]);
        if (!sorted.length || !total) return '<p class="rp-fig-bd-none">Nothing is expected to sell yet.</p>';
        const top = sorted.slice(0, 4), rest = sorted.slice(4);
        const restSum = rest.reduce((a, g) => a + g[key], 0);
        const row = (label, v, sub) => `<li><span class="rp-fig-bd-label">${escHtml(label)}${sub ? `<small>${escHtml(sub)}</small>` : ''}</span>`
            + `<span class="rp-fig-bd-bar" aria-hidden="true"><span style="width:${Math.max(3, Math.round(v / total * 100))}%"></span></span>`
            + `<span class="rp-fig-bd-value">${fmt(v)} <small>${Math.round(v / total * 100)}%</small></span></li>`;
        return '<ul>' + top.map(g => row(g.name, g[key], `${formatNumber(g.products)} product${g.products === 1 ? '' : 's'} selling`)).join('')
            + (rest.length ? row(`${rest.length} other categor${rest.length === 1 ? 'y' : 'ies'}`, restSum) : '') + '</ul>'
            + `<p class="rp-fig-bd-how">${unitWord}</p>`;
    };
    document.getElementById('unitsBreakdown').innerHTML = lines('units', totalUnits, v => formatNumber(Math.round(v)),
        `Each product's expected sales over the next ${plan.forecast_days} days, added up by category.`);
    document.getElementById('revenueBreakdown').innerHTML = lines('revenue', totalRev, v => formatCompactCurrency(v),
        'Each product\'s expected sales × its selling price, added up by category.');
}

/* ---------- Demand by category and brand; how good the model is ---------- */

function renderDemandGroups() {
    const bars = list => list.filter(g => g.expected_30d > 0 || g.sold_30d > 0).slice(0, 8).map(g => ({
        label: g.name, value: g.expected_30d,
        text: `${formatNumber(Math.round(g.expected_30d))} expected · ${formatQty(g.sold_30d)} sold in the last 30 days`
    }));
    renderBars('categoryDemand', bars(plan.by_category || []));
    // Brand is optional on a product. If none have one, say how to get this
    // view instead of showing a single bar labelled "Not set".
    const brands = (plan.by_brand || []).filter(g => g.name !== 'Not set');
    if (brands.length) renderBars('brandDemand', bars(plan.by_brand || []));
    else document.getElementById('brandDemand').innerHTML = '<p class="rp-empty">No product has a brand set yet. Add a brand to products in Inventory to see which brands are expected to sell.</p>';
}

/* The Forecast accuracy figure, broken down (UAT part 4, A15): what the
   test hid, what the forecast said, what actually sold, and how each method
   scored on the same days. */
function renderModel() {
    const model = plan.model || {};
    const cmp = model.comparison;
    const test = plan.totals.accuracy_test;
    const box = document.getElementById('accuracyBreakdown');
    if (!box) return;
    const pct = v => v == null ? '—' : formatDecimal(v, 1) + '%';
    const row = (label, value, strong) => `<div class="rp-acc-row${strong ? ' is-strong' : ''}"><span>${label}</span><span>${value}</span></div>`;
    let html = '';
    if (test && test.actual_units) {
        const off = test.predicted_units - test.actual_units;
        html += '<div class="rp-acc-rows">'
            + row('Days tested', 'The last 14 days on record, hidden from the forecast')
            + row('The forecast said', formatNumber(test.predicted_units) + ' items')
            + row('What actually sold', formatNumber(test.actual_units) + ' items')
            + row('Off by', formatNumber(Math.abs(off)) + ' items (' + (off > 0 ? 'too high' : off < 0 ? 'too low' : 'exact') + ')')
            // the score is worked out before the counts are rounded, so its own parts are shown
            + (plan.totals.accuracy != null ? row('Accuracy', '100% − ' + formatDecimal(100 - plan.totals.accuracy, 1) + '% off = <strong>' + pct(plan.totals.accuracy) + '</strong>', true) : '')
            + '</div>';
    } else if (plan.totals.accuracy == null) {
        html += '<p class="rp-acc-none">Too few items sold in the last 14 days on record to test the forecast fairly'
            + (test && test.min_units ? ` (it needs at least ${formatNumber(test.min_units)})` : '') + '.</p>';
    }
    if (cmp) {
        const best = Math.max(cmp.random_forest ?? 0, cmp.gradient_boosting ?? 0, cmp.ensemble ?? 0);
        html += '<div class="rp-acc-sub">Each method on the same days, ' + formatNumber(cmp.products) + ' products, ' + formatNumber(cmp.actual_units) + ' items sold</div><div class="rp-acc-rows">'
            + row('Random Forest alone', pct(cmp.random_forest))
            + row('Gradient Boosting alone', pct(cmp.gradient_boosting))
            + row('Both together' + (best > 0 && cmp.ensemble === best ? ' (best)' : ''), pct(cmp.ensemble))
            + row('Simple trend, no machine learning', pct(cmp.statistical_baseline))
            + row('What this page uses', pct(cmp.system_forecast), true)
            + '</div>';
    }
    box.innerHTML = html;
}

function renderAllProducts() {
    // The search box and the group buttons are usable before the forecast has
    // arrived. What was typed or picked is kept, and applied when it does.
    if (!plan) return;
    const all = plan.products;
    const count = d => all.filter(p => p.demand === d).length;
    document.getElementById('countAll').textContent = all.length;
    document.getElementById('countFast').textContent = count('fast');
    document.getElementById('countSteady').textContent = count('steady');
    document.getElementById('countSlow').textContent = count('slow');
    document.getElementById('countNone').textContent = count('none');

    const rows = all
        .filter(p => planFilter === 'all' || p.demand === planFilter)
        .filter(p => !planSearch || p.name.toLowerCase().includes(planSearch) || (p.sku || '').toLowerCase().includes(planSearch))
        .sort((a, b) => b.expected_30d - a.expected_30d || b.sold_30d - a.sold_30d || a.name.localeCompare(b.name));
    document.getElementById('planListSub').textContent = groupText(planFilter, all)
        + (planSearch ? ` ${formatNumber(rows.length)} match “${planSearch}”.` : '');

    const tbody = document.getElementById('predictionsTableBody');
    if (!rows.length) {
        setRow('predictionsTableBody', 6, planSearch ? 'No products match that search.' : 'No products in this group.');
        document.getElementById('predictionsPagination').innerHTML = '';
        return;
    }
    tbody.innerHTML = rows.slice(0, predDisplayCount).map(p => {
        const d = doThis(p), sure = HOW_SURE[p.how_sure] || HOW_SURE.rough;
        return `
        <tr data-id="${p.product_id}" tabindex="0">
            <td><span class="order-dot ${d.dot}" aria-hidden="true"></span><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="rp-strong">${escHtml(lastsText(p))}</td>
            <td>${nextMonthText(p)}</td>
            <td><span class="rp-badge rp-badge-${sure.tone}">${sure.text}</span></td>
            <td><span class="rp-badge rp-badge-${d.tone}">${escHtml(d.text)}</span></td>
        </tr>`;
    }).join('');
    updatePagination('predictionsPagination', rows, predDisplayCount, 'showMorePredictions', 'showLessPredictions', PRED_PAGE_SIZE);
}

/* Every product in plain words (forecast mock-up 2): how sure, and what to do. */
const HOW_SURE = {
    sure: { text: 'Sure', tone: 'ok' },
    rough: { text: 'Rough guess', tone: 'plain' },
    new: { text: 'Too new to tell', tone: 'plain' }
};
function nextMonthText(p) {
    if (!(p.expected_high > 0)) return '<span class="rp-sub" style="display:inline">none expected</span>';
    return p.expected_low === p.expected_high ? `about ${formatNumber(p.expected_low)}` : `about ${formatNumber(p.expected_low)}–${formatNumber(p.expected_high)}`;
}
function doThis(p) {
    const today = ymd(new Date());
    if (p.stock_status === 'out') return { text: 'Out of stock: order now', tone: 'danger', dot: 'red' };
    if (p.stock_status === 'reorder_now') return { text: !p.order_by || p.order_by <= today ? 'Order today' : 'Order by ' + planDate(p.order_by).replace(/, \d{4}$/, ''), tone: 'danger', dot: 'red' };
    if (p.stock_status === 'reorder_soon') return { text: 'Order by ' + planDate(p.order_by).replace(/, \d{4}$/, ''), tone: 'warning', dot: 'amber' };
    if (p.expired_units > 0) return { text: 'Expired: sell or remove', tone: 'danger', dot: 'red' };
    if (p.expiry_risk_units > 0) return { text: 'Sell it first: may expire', tone: 'warning', dot: 'amber' };
    if (p.excess_reason === 'not_selling') return { text: 'Not selling: stop ordering', tone: 'warning', dot: 'grey' };
    if (p.excess_units > 0) return { text: 'Too much: stop ordering', tone: 'warning', dot: 'amber' };
    return { text: 'Enough', tone: 'ok', dot: 'green' };
}

/* The line under "All products": what the chosen group is, with its figures. */
function groupText(group, all) {
    const items = n => `${formatNumber(Math.round(n))} item${Math.round(n) === 1 ? '' : 's'}`;
    const products = n => `${formatNumber(n)} product${n === 1 ? '' : 's'}`;
    const expected = list => list.reduce((a, p) => a + p.expected_30d, 0);
    const shopTotal = expected(all);
    const share = list => shopTotal > 0 ? ` (${Math.round(expected(list) / shopTotal * 100)}% of the shop's)` : '';
    const list = group === 'all' ? all : all.filter(p => p.demand === group);
    let text;
    if (!list.length) return 'No products in this group right now.';
    if (group === 'all') {
        text = `${products(list.length)}, together expected to sell ${items(shopTotal)} in the next 30 days. Sorted by expected sales, highest first.`;
    } else if (group === 'none') {
        const units = list.reduce((a, p) => a + (Number(p.stock) || 0), 0);
        const value = list.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.unit_price) || 0), 0);
        text = `Nothing sold in the last 30 days: ${products(list.length)} still holding ${items(units)} in stock, ${formatCurrency(value)} at selling price.`;
    } else {
        // one decimal: most products sell a few a month, and whole numbers
        // made the groups look the same ("2 or more" next to "2 to 2")
        const each = list.map(p => Math.round(p.expected_30d * 10) / 10);
        const low = Math.min(...each), high = Math.max(...each);
        const n = v => formatDecimal(v, 1);
        const range = group === 'fast' ? `${n(low)} or more items each`
            : group === 'slow' ? `${n(high)} items or fewer each`
            : low === high ? `about ${n(low)} items each` : `${n(low)} to ${n(high)} items each`;
        const which = { fast: 'The top quarter of your products by expected sales', steady: 'The middle of your products by expected sales', slow: 'The bottom quarter of your products by expected sales' }[group];
        text = `${which}: ${products(list.length)} expected to sell ${range} in the next 30 days, ${items(expected(list))} together${share(list)}.`;
    }
    return text;
}

function showMorePredictions() { predDisplayCount += PRED_PAGE_SIZE; renderAllProducts(); }
function showLessPredictions() { predDisplayCount = Math.max(PRED_PAGE_SIZE, predDisplayCount - PRED_PAGE_SIZE); renderAllProducts(); }

/* ---------- One product ---------- */

async function openProductDetail(productId) {
    const p = plan && plan.products.find(x => x.product_id === productId);
    if (!p) return;
    const card = document.getElementById('productDetail');
    card.hidden = false;
    document.getElementById('detailTitle').textContent = p.name;
    const sure = { sure: 'Sure: it sells steadily', rough: 'Rough guess: it sells now and then', new: 'Too new to tell: little on record' }[p.how_sure] || '';
    document.getElementById('detailSub').textContent = [p.sku ? `SKU ${p.sku}` : '', sure].filter(Boolean).join(' · ');
    document.getElementById('detailSummary').textContent = 'Loading forecast…';
    if (forecastChart) { forecastChart.destroy(); forecastChart = null; }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const params = new URLSearchParams({ stock: Math.round(p.stock), reorder_level: p.reorder_level, lead_time: plan.lead_time_days });
        const response = await fetch(`${PRED_API}/product/${encodeURIComponent(productId)}?${params}`, { headers: getAuthHeaders(), signal: controller.signal });
        const data = await response.json();
        if (!data.success) {
            document.getElementById('detailSummary').textContent =
                `${formatQty(p.stock)} in stock. This product has no sales on record yet, so there is nothing to forecast.`;
            return;
        }
        document.getElementById('detailSummary').textContent = detailSentence(p);
        renderForecastChart(data.data);
    } catch (error) {
        console.error('Error loading product forecast:', error);
        document.getElementById('detailSummary').textContent = error.name === 'AbortError'
            ? 'This forecast is taking longer than usual. Try again in a minute.'
            : 'The forecast for this product could not be loaded.';
    } finally {
        clearTimeout(timeout);
    }
}

/* The days the forecast does not read, and why, for the line under the title. */
function detailSentence(p) {
    // in plain words first: how fast it sells, how long the shelf lasts, what to do
    const week = p.per_week;
    const perWeek = week >= 1.5 ? `about ${formatNumber(Math.round(week))} a week` : week >= 0.5 ? 'about 1 a week' : week > 0 ? 'less than 1 a week' : null;
    const trend = p.trend === 'up' ? ', and more lately' : p.trend === 'down' ? ', and fewer lately' : '';
    // what really sold first, then what FETCH expects: when they differ, both are said
    const sold = p.sold_30d > 0 ? `Sold ${formatQty(p.sold_30d)} in the last 30 days.` : 'Nothing sold in the last 30 days.';
    const next = p.expected_high > 0
        ? ` FETCH expects ${p.expected_low === p.expected_high ? 'about ' + formatNumber(p.expected_low) : 'about ' + formatNumber(p.expected_low) + '–' + formatNumber(p.expected_high)} in the next 30 days (${perWeek || 'less than 1 a week'}${trend}).`
        : ' FETCH expects little or none next month.';
    const parts = [sold + next];
    if (p.stock > 0 && p.days_left != null) parts.push(`At that rate the ${formatQty(p.stock)} on the shelf last ${lastsText(p).toLowerCase()}.`);
    else parts.push(`${formatQty(p.stock)} on the shelf.`);
    if (p.stock_status !== 'ok') {
        parts.push(p.suggested_order > 0
            ? `Order about ${formatNumber(p.suggested_order)}${p.order_by ? ' by ' + planDate(p.order_by) : ' today'} so it does not run out.`
            : `${formatQty(p.on_order)} already on order, which covers it.`);
    } else parts.push(doThis(p).text === 'Enough' ? 'Nothing to do.' : doThis(p).text + '.');
    if (p.recommended_reorder_point != null) {
        parts.push(`Recommended reorder point: ${formatNumber(p.recommended_reorder_point)}, which includes a safety stock of ${formatNumber(p.safety_stock)}`
            + (p.recommended_reorder_point !== p.reorder_level ? ` (it is currently set to ${formatQty(p.reorder_level)}).` : ' (matches the current setting).'));
    }
    if (p.expiry_risk_units > 0) parts.push(`About ${formatQty(p.expiry_risk_units)} may still be unsold when it expires on ${planDate(p.expires_on)}.`);
    // a product too new to read a rate from says so, in place of the usual remark
    if (p.basis === 'new') {
        parts.push(`This product has only ${p.days_on_record} day${p.days_on_record === 1 ? '' : 's'} of sales on record, so this is a cautious first estimate: what it has sold so far, spread over two weeks. It becomes a normal forecast once it has 14 days.`);
    } else if (p.confidence && p.expected_30d >= 0.5) {
        parts.push({ high: 'Sales have been regular, so this estimate is fairly reliable.',
                     medium: 'Sales have been somewhat uneven, so treat this as a guide.',
                     low: 'Sales have been irregular, so this is a rough estimate.' }[p.confidence]);
    }
    return parts.join(' ');
}

function closeProductDetail() {
    document.getElementById('productDetail').hidden = true;
    if (forecastChart) { forecastChart.destroy(); forecastChart = null; }
}

/* Weeks, not days: the last eight weeks sold as solid bars, the next four
   expected as light bars (forecast mock-up 2). A shopkeeper reads "about 2 a
   week" off this at a glance, where daily lines were mostly zeros. */
function renderForecastChart(data) {
    const canvas = document.getElementById('demandForecastChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (forecastChart) forecastChart.destroy();

    const short = s => { const d = planDate(s); return d ? d.replace(/, \d{4}$/, '') : ''; };
    const history = data.historical_data || [];
    const predicted = data.predictions || [];
    const weeks = (list, field, count, fromEnd) => {
        const out = [];
        const take = fromEnd ? list.slice(-count * 7) : list.slice(0, count * 7);
        for (let i = 0; i < take.length; i += 7) {
            const chunk = take.slice(i, i + 7);
            out.push({ label: short(chunk[0].date), qty: chunk.reduce((a, x) => a + (Number(x[field]) || 0), 0) });
        }
        return out;
    };
    const past = weeks(history, 'quantity', 8, true);
    const next = weeks(predicted, 'predicted_quantity', 4, false);
    const labels = past.map(w => w.label).concat(next.map(w => w.label));
    const t = chartTheme();
    const options = baseChartOptions(t);
    options.plugins.tooltip = {
        filter: item => item.raw != null,
        callbacks: { label: item => `${item.dataset.label}: ${formatDecimal(item.raw, 1)}` }
    };
    options.scales.x.stacked = true;
    forecastChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Sold that week', data: past.map(w => w.qty).concat(next.map(() => null)), backgroundColor: t.bar, borderRadius: 5, maxBarThickness: 46 },
                { label: 'Expected that week', data: past.map(() => null).concat(next.map(w => Math.round(w.qty * 10) / 10)), backgroundColor: t.barSoft + 'AA', borderColor: t.bar, borderWidth: 1.5, borderRadius: 5, maxBarThickness: 46 }
            ]
        },
        options
    });
}

/* ---------- Patterns ---------- */

function renderPatterns(seasonality) {
    if (typeof Chart === 'undefined') return;
    const t = chartTheme();

    const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dow = [...(seasonality.day_of_week_patterns || [])].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day));
    const dowCanvas = document.getElementById('dowTrendsChart');
    if (dowChart) { dowChart.destroy(); dowChart = null; }
    if (dowCanvas && dow.length) {
        const values = dow.map(d => Number(d.avg_daily_sales) || 0);
        const peak = Math.max(...values);
        dowChart = new Chart(dowCanvas.getContext('2d'), {
            type: 'bar',
            data: { labels: dow.map(d => d.day), datasets: [{ label: 'Items per day', data: values, backgroundColor: values.map(v => v === peak ? t.bar : t.barSoft), borderRadius: 2, maxBarThickness: 44 }] },
            options: baseChartOptions(t)
        });
    }

    // The pattern the study names first: do weekends sell more than weekdays?
    const note = document.getElementById('weekendNote');
    if (note) {
        const avg = days => { const v = dow.filter(d => days.includes(d.day)).map(d => Number(d.avg_daily_sales) || 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
        const weekend = avg(['Sat', 'Sun']), weekday = avg(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        if (weekday > 0 && weekend > 0) {
            const diff = Math.round((weekend - weekday) / weekday * 100);
            note.textContent = Math.abs(diff) < 3
                ? `Weekends and weekdays sell about the same: around ${formatDecimal(weekday, 0)} items a day.`
                : `Weekends sell ${Math.abs(diff)}% ${diff > 0 ? 'more' : 'less'} per day than weekdays (${formatDecimal(weekend, 0)} against ${formatDecimal(weekday, 0)} items).`;
        } else note.textContent = '';
    }

    const months = seasonality.monthly_patterns || [];
    const monthCanvas = document.getElementById('seasonalTrendsChart');
    if (seasonalChart) { seasonalChart.destroy(); seasonalChart = null; }
    if (monthCanvas && months.length) {
        seasonalChart = new Chart(monthCanvas.getContext('2d'), {
            type: 'bar',
            data: { labels: months.map(m => m.month), datasets: [{ label: 'Items sold', data: months.map(m => Number(m.total_sales) || 0), backgroundColor: t.bar, borderRadius: 2, maxBarThickness: 44 }] },
            options: baseChartOptions(t)
        });
    }
}

/* ---------- Export ---------- */

function exportReorderCSV() {
    const rows = plan ? plan.products.filter(p => p.stock_status !== 'ok') : [];
    if (!rows.length) { showToast('Nothing needs reordering right now', 'warning'); return; }
    const lines = [['Product', 'SKU', 'Supplier', 'Status', 'Why', 'In stock', 'On order', 'Reorder level', 'Recommended reorder point', 'Safety stock', 'Sells per week', 'Order by', 'Suggested order'].map(csvCell).join(',')];
    rows.forEach(p => lines.push([p.name, p.sku || '', p.supplier_name || '', STOCK_LABEL[p.stock_status].text, reorderReason(p),
        p.stock, p.on_order, p.reorder_level, p.recommended_reorder_point ?? '', p.safety_stock, p.per_week, p.order_by || '', p.suggested_order].map(csvCell).join(',')));
    downloadCSV(`reorder_list_${ymd(new Date())}.csv`, lines);
    showToast('Reorder list exported', 'success');
}
