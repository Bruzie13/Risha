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
let planDaily = null;            // items sold each of the last 30 days (sales report rows)
let planDow = null;              // average items a day by weekday, for the expected bars
let planPhotos = new Set();      // ids of products that have a photo
let planFilter = 'all';
let planSearch = '';
let planLoading = false;
const PRED_PAGE_SIZE = 10;      // product cards: ten at a time (Carlo, 8 Nov)
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
        // The page shows as soon as the forecast arrives. What sold each of
        // the last 30 days (for the chart, ~1 s to add up) and which products
        // have a photo follow, and fill in when they come (Carlo, 8 Nov:
        // faster loading on the deployed system).
        const today = ymd(new Date());
        const extras = Promise.all([
            fetch(`${API_BASE}/sales/report?period=daily&date_from=${addDaysYmd(today, -30)}&date_to=${addDaysYmd(today, -1)}`, { headers: getAuthHeaders(), signal: controller.signal }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/products/image-ids`, { headers: getAuthHeaders(), signal: controller.signal }).then(r => r.json()).catch(() => null)
        ]);
        const [overview, trends] = await Promise.all([
            fetch(`${PRED_API}/overview`, { headers: getAuthHeaders(), signal: controller.signal }).then(r => r.json()),
            fetch(`${PRED_API}/trends`, { headers: getAuthHeaders(), signal: controller.signal }).then(r => r.json()).catch(() => null)
        ]);
        if (!overview.success) throw new Error(overview.error || 'Stock planning failed');
        plan = overview.data;
        planDow = trends && trends.success && trends.data.seasonality ? trends.data.seasonality.day_of_week_patterns || null : null;
        renderPlan();
        if (trends && trends.success) renderPatterns(trends.data.seasonality || {});
        loadGoal();
        extras.then(([daily, photos]) => {
            if (!plan) return;
            planDaily = daily && daily.success && daily.data && Array.isArray(daily.data.rows) ? daily.data.rows : null;
            planPhotos = new Set(photos && photos.success && Array.isArray(photos.data) ? photos.data.map(Number) : []);
            if (planDaily || planPhotos.size) renderPlan();
        });
    } catch (error) {
        console.error('Error loading stock planning:', error);
        const msg = error.name === 'AbortError'
            ? 'The forecast is taking longer than usual. Press Refresh in a minute.'
            : 'Stock planning could not be loaded. Press Refresh to try again.';
        orderListMessage(msg);
        setRow('predictionsTableBody', 6, msg);
        const line = document.getElementById('pbLine');
        if (line) line.textContent = msg;
        const body = document.getElementById('pbReorderBody');
        if (body) body.innerHTML = `<p class="rp-loading">${escHtml(msg)}</p>`;
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
    if (!el) return;
    // a table body gets a row; a card grid gets a line
    el.innerHTML = el.tagName === 'TBODY' ? `<tr><td colspan="${cols}" class="rp-loading">${escHtml(text)}</td></tr>` : `<p class="rp-loading">${escHtml(text)}</p>`;
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
    // a product opens in the panel at the side of the list it was picked from
    document.getElementById('orderList').addEventListener('click', onOrderListClick);
    document.getElementById('orderLater').addEventListener('click', onOrderListClick);
    ['predictionsTableBody', 'excessBody', 'expiryBody', 'guessBody'].forEach(id => {
        const box = document.getElementById(id);
        box.addEventListener('click', e => {
            const more = e.target.closest('[data-more]');
            if (more) { cardGroupOpen[more.dataset.more] = !cardGroupOpen[more.dataset.more]; if (id === 'expiryBody') renderExpiry(); return; }
            if (e.target.closest('button, a')) return;
            const row = e.target.closest('[data-id]');
            if (row) openProductDetail(Number(row.dataset.id), row);
        });
    });
    ['predictionsTableBody', 'excessBody', 'expiryBody', 'guessBody', 'orderList', 'orderLater'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('[data-id]');
            if (!row || e.target !== row) return;
            e.preventDefault();
            openProductDetail(Number(row.dataset.id), row);
        });
    });
    document.querySelectorAll('.plan-view').forEach(b => b.addEventListener('click', () => showPlanView(b.dataset.view)));
    // the Forecast tab's closed parts: the chart, the categories, the days not counted, "See why"
    const forecastPane = document.querySelector('.plan-pane[data-pane="forecast"]');
    if (forecastPane) forecastPane.addEventListener('click', e => {
        const b = e.target.closest('[data-fold]');
        if (b) openFold(b.dataset.fold, true);
    });
    wireBoard();
    wireChartTips();
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
    // the board first on every visit; ?view= still opens one list directly
    showPlanView(new URLSearchParams(window.location.search).get('view') || 'board');
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
    const why = { no_items: 'sales were recorded without their items', closed: 'nothing was recorded', freak: 'far more sold than on a usual busy day' };
    document.getElementById('planCaption').innerHTML =
        `<p>Based on ${plan.history_days ? b(formatNumber(plan.history_days) + ' days') + ' of sales on record' + (plan.model && plan.model.fit_days ? ` (the model reads the last ${b(plan.model.fit_days + ' days')})` : '') : 'the sales on record'}.</p>`
        + `<p>Forecasts cover the ${b('next ' + plan.forecast_days + ' days')}.`
        + (plan.last_sale_date ? ` Last sale recorded ${b(planDate(plan.last_sale_date))}.` : '') + '</p>'
        + (left.length ? `<p class="rp-left-out-head"><mark>Not counted: ${formatNumber(plan.excluded.days)} day${plan.excluded.days === 1 ? '' : 's'}</mark></p><ul class="rp-left-out">`
            + left.map(r => `<li>${b(r.from === r.to ? planDate(r.from) : planDate(r.from) + ' to ' + planDate(r.to))} · ${r.days} day${r.days === 1 ? '' : 's'}: ${escHtml(why[r.reason] || 'no usable record')}</li>`).join('') + '</ul>' : '');
    const lead = document.getElementById('howLead');
    if (lead) lead.textContent = plan.lead_time_days;

    renderForecastTop();
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
    renderBoard();
    renderAttention();
    renderReorder();
    renderGuess();
    renderExcess();
    renderExpiry();
    renderAllProducts();
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

/* The board, or one full list at a time. ?view= (reorder, expiry, excess,
   forecast) opens a list directly; anything else shows the board. */
const PLAN_VIEWS = ['reorder', 'expiry', 'excess', 'forecast'];
function showPlanView(view, focusId) {
    closeProductDetail();                    // a product belongs to the list it was opened from
    const board = document.getElementById('planBoard'), detail = document.getElementById('planDetail');
    const onBoard = !PLAN_VIEWS.includes(view);
    if (board) board.hidden = !onBoard;
    if (detail) detail.hidden = onBoard;
    if (onBoard) return;
    document.querySelectorAll('.plan-view').forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.plan-pane').forEach(p => { p.hidden = p.dataset.pane !== view; });
    // "Did it guess right?" is closed until asked for: a link to it opens it
    if (focusId === 'guessCard' && fdOpen !== 'why') openFold('why');
    // from the board, the list (or the card asked for) opens at the top of the screen
    const target = focusId && document.getElementById(focusId);
    if (target && !target.hidden) target.scrollIntoView({ block: 'start' });
    else if (detail && detail.getBoundingClientRect().top < 0) detail.scrollIntoView({ block: 'start' });
}

/* ---------- The board (Stock planning mock-up A, "board of four") ----------
   The four areas on one screen, each a short preview of its full list, with
   a heading that says what needs doing today. Built from the same overview as
   the lists, so the numbers always agree with them. */
let boardWired = false;
function wireBoard() {
    if (boardWired) return;
    boardWired = true;
    document.querySelectorAll('#planBoard [data-open]').forEach(b => b.addEventListener('click', () => showPlanView(b.dataset.open)));
    const back = document.getElementById('planBackBtn');
    if (back) back.addEventListener('click', () => {
        closeProductDetail();
        showPlanView('board');
        const tab = document.getElementById('tab-analytics');
        if (tab && tab.getBoundingClientRect().top < 0) tab.scrollIntoView({ block: 'start' });
    });
    // "How does the forecast work?" shows the guide, open; closing it hides it again
    const guide = document.getElementById('planGuide'), guideBtn = document.getElementById('pbGuideBtn');
    if (guide && guideBtn) {
        guideBtn.addEventListener('click', () => {
            const show = guide.hidden;
            guide.hidden = !show;
            guide.open = show;
            guideBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
        });
        guide.addEventListener('toggle', () => {
            if (guide.open) return;
            guide.hidden = true;
            guideBtn.setAttribute('aria-expanded', 'false');
            guideBtn.focus();
        });
    }
    // a product on the board opens its forecast under the full list it belongs to
    const board = document.getElementById('planBoard');
    if (board) board.addEventListener('click', e => {
        const link = e.target.closest('[data-board-go]');
        if (link) { e.preventDefault(); showPlanView(link.dataset.boardGo, link.dataset.focus); return; }
        const btn = e.target.closest('[data-board-action]');
        if (btn) { if (btn.dataset.boardAction === 'order') createPlannedOrders(); else exportReorderCSV(); return; }
        const row = e.target.closest('[data-board-id]');
        if (!row) return;
        openFromBoard(row.dataset.pane, Number(row.dataset.boardId));
    });
    if (board) board.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('[data-board-id]');
        if (!row || e.target !== row) return;
        e.preventDefault();
        openFromBoard(row.dataset.pane, Number(row.dataset.boardId));
    });
}

function openFromBoard(pane, productId) {
    showPlanView(pane);
    openProductDetail(productId);
}

const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : (many || one + 's')}`;
const shortDate = s => planDate(s).replace(/, \d{4}$/, '');
/** The 30 forecast days as dates, e.g. "Nov 8 to Dec 7" (today is the first). */
const forecastSpan = days => { const t = ymd(new Date()); return `${shortDate(t)} to ${shortDate(addDaysYmd(t, (days || 30) - 1))}`; };
/** The 30 days just before, e.g. "Oct 9 to Nov 7". */
const pastSpan = () => { const t = ymd(new Date()); return `${shortDate(addDaysYmd(t, -30))} to ${shortDate(addDaysYmd(t, -1))}`; };
const pesos = v => '₱' + formatNumber(Math.round(Number(v) || 0));   // whole pesos on the board
/* What a product sold on the last 30 days the forecast counts. Days it leaves
   out (a freak day, a closure) are skipped, so the figure can be set beside
   the forecast; the plain 30-day figure stands in when there is none. */
const soldCounted = p => p.sold_counted_30d != null ? Number(p.sold_counted_30d) : (Number(p.sold_30d) || 0);
/** True when those 30 days reach further back than 30 days, because days were left out. */
const countedReachesBack = () => { const c = plan && plan.totals.sales_check; return !!(c && c.from && c.from < addDaysYmd(ymd(new Date()), -30)); };
const soldSpan = () => countedReachesBack() ? 'last 30 days counted' : 'last 30 days';

/** The product's photo, or its category's icon on a tint when it has none. */
const categoryIcon = p => ({ 'Food': 'pets', 'Health & Wellness': 'medication', 'Accessories': 'styler', 'Litter & Waste': 'delete', 'Toys': 'sports_baseball', 'Cages & Habitats': 'house' }[p.category] || 'inventory_2');
function productPhoto(p, cls) {
    if (planPhotos.has(Number(p.product_id))) {
        return `<span class="${cls}"><img src="${API_BASE}/products/${encodeURIComponent(p.product_id)}/image" alt="" loading="lazy" onerror="this.parentNode.classList.add('is-none');this.replaceWith(Object.assign(document.createElement('span'),{className:'material-symbols-outlined',textContent:'${categoryIcon(p)}'}))"></span>`;
    }
    return `<span class="${cls} is-none"><span class="material-symbols-outlined" aria-hidden="true">${categoryIcon(p)}</span></span>`;
}
const boardPhoto = p => productPhoto(p, 'pb-ph');

/** Five paw prints, one for every two weeks the shelf lasts. */
function boardPaws(p, tone) {
    const paws = p.stock <= 0 ? 0 : p.days_left == null ? 5 : Math.max(1, Math.min(5, Math.ceil(p.days_left / 14)));
    return `<span class="cs-track pb-paws" role="img" aria-label="${paws} of 5 paws"><span class="cs-fill pb-fill is-${tone}" style="width:${paws * 20}%"></span></span>`;
}

function renderBoard() {
    if (!document.getElementById('planBoard')) return;
    const today = ymd(new Date());
    const tomorrow = addDaysYmd(today, 1), weekEnd = addDaysYmd(today, 7);
    const byOrderDate = (a, b) => (a.order_by || '0') < (b.order_by || '0') ? -1 : (a.order_by || '0') > (b.order_by || '0') ? 1 : a.name.localeCompare(b.name);
    const reorder = plan.products.filter(p => p.stock_status !== 'ok').sort(byOrderDate);
    const thisWeek = reorder.filter(p => p.stock_status === 'out' || !p.order_by || p.order_by <= weekEnd);
    const later = reorder.length - thisWeek.length;
    const dueToday = thisWeek.filter(p => p.stock_status === 'out' || !p.order_by || p.order_by <= today);
    const soonest = (a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0);
    const expired = plan.products.filter(p => p.expired_units > 0).sort((a, b) => soonest(b, a));
    const atRisk = plan.products.filter(p => !(p.expired_units > 0) && p.expiry_risk_units > 0).sort(soonest);
    const excess = plan.products.filter(p => p.excess_units > 0).sort((a, b) => b.excess_value - a.excess_value || b.excess_units - a.excess_units);

    // the heading: what needs doing today, in words
    const tasks = [];
    if (dueToday.length) {
        const sup = [...new Set(dueToday.map(p => p.supplier_name).filter(Boolean))];
        tasks.push(`order <b>${plural(dueToday.length, 'product')}</b>${sup.length === 1 ? ' from ' + escHtml(sup[0]) : sup.length > 1 ? ` from ${plural(sup.length, 'supplier')}` : ''}`);
    }
    if (expired.length) tasks.push(`take <b>${plural(expired.length, 'expired product')}</b> off the shelf`);
    document.getElementById('pbTitle').textContent = !tasks.length ? 'Nothing needs you today'
        : tasks.length === 1 ? 'One thing needs you today' : 'Two things need you today';
    const first = s => s.charAt(0).toUpperCase() + s.slice(1);
    document.getElementById('pbLine').innerHTML = tasks.length
        ? first(tasks.join(', and ')) + '. Everything else can wait.'
        : thisWeek.length ? `Nothing to order today. ${plural(thisWeek.length, 'product')} to order later this week.`
        : 'Nothing to order this week and nothing expired. The forecast and the lists are below.';

    renderBoardReorder(thisWeek, later, today, tomorrow);
    renderBoardExpiry(expired, atRisk, today);
    renderBoardForecast();
    renderBoardExcess(excess);
}

function renderBoardReorder(rows, later, today, tomorrow) {
    const orderable = rows.filter(p => p.suggested_order > 0 && p.supplier_id);
    const total = orderable.reduce((a, p) => a + orderCost(p), 0);
    document.getElementById('pbReorderSub').textContent = rows.length
        ? `${plural(rows.length, 'product')} to order this week` + (total ? `, about ${pesos(total)} at cost` : '')
        : 'Nothing to order this week';
    document.getElementById('pbReorderOpen').hidden = !rows.length && !later;
    document.getElementById('pbReorderOpen').firstChild.textContent = rows.length ? `See all ${formatNumber(rows.length)} ` : 'See the list ';
    document.getElementById('pbReorderBody').innerHTML = !rows.length
        ? `<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Every product has enough stock for this week.${later ? ` ${plural(later, 'product')} to order later this month.` : ''}</p>`
        : '<div class="pb-rows">' + rows.slice(0, 4).map(p => {
            const urgent = p.stock_status === 'out' || !p.order_by || p.order_by <= tomorrow;
            const when = !p.order_by || p.order_by <= today ? 'by today' : 'by ' + weekday(p.order_by);
            const left = p.stock <= 0 ? 'None left' : `${formatQty(p.stock)} left, ${p.days_left == null ? 'no recent sales' : 'lasts ' + lastsText(p).toLowerCase()}`;
            const sup = p.supplier_name ? `${escHtml(p.supplier_name)}, delivers in ${plural(p.lead_time_days, 'day')}` : 'No supplier set';
            return `<div class="pb-row" data-board-id="${p.product_id}" data-pane="reorder" tabindex="0" role="button" aria-label="${escHtml(p.name)}: see its forecast">
                ${boardPhoto(p)}
                <div class="pb-name"><b>${escHtml(p.name)}</b><span>${sup}</span></div>
                <div class="pb-left">${boardPaws(p, urgent ? 'red' : 'amber')}<span>${escHtml(left)}</span></div>
                <div class="pb-order"><b>${p.suggested_order > 0 ? 'Order ' + formatNumber(p.suggested_order) : 'On order'}</b><span class="${urgent ? 'is-red' : 'is-amber'}">${escHtml(p.suggested_order > 0 ? when : formatQty(p.on_order) + ' coming')}</span></div>
            </div>`;
        }).join('') + '</div>';
    const manage = typeof canManage === 'function' && canManage();
    const more = rows.length > 4 ? `${plural(rows.length - 4, 'more product')} this week` : '';
    const note = [more, later ? `${formatNumber(later)} more later this month` : ''].filter(Boolean).join(', ');
    document.getElementById('pbReorderFoot').innerHTML = !rows.length ? '' :
        (orderable.length && manage ? `<button type="button" class="btn-primary" data-board-action="order"><span class="material-symbols-outlined">local_shipping</span> Create purchase orders</button>` : '')
        + `<button type="button" class="btn-secondary" data-board-action="export"><span class="material-symbols-outlined">download</span> Export list</button>`
        + (note ? `<span class="pb-note">${escHtml(note)}</span>` : '');
}

function renderBoardExpiry(expired, atRisk, today) {
    const all = expired.length + atRisk.length;
    document.getElementById('pbExpirySub').textContent = all
        ? [expired.length ? `${formatNumber(expired.length)} expired` : '', atRisk.length ? `${formatNumber(atRisk.length)} at risk` : ''].filter(Boolean).join(', ')
        : 'Nothing expired or at risk';
    const open = document.getElementById('pbExpiryOpen');
    open.hidden = !all;
    open.firstChild.textContent = `See all ${formatNumber(all)} `;
    const ago = p => {
        const d = -(p.days_to_expiry ?? 0);
        return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d <= 14 ? `${d} days ago` : shortDate(p.expires_on);
    };
    // three expired and two at risk, or more of one when the other is short
    const showGone = expired.slice(0, atRisk.length ? 3 : 5), showRisk = atRisk.slice(0, expired.length ? 2 : 5);
    const item = (p, tone, tag, sub) => `<div class="pb-mini" data-board-id="${p.product_id}" data-pane="expiry" tabindex="0" role="button" aria-label="${escHtml(p.name)}: see its forecast">
        ${boardPhoto(p)}<div class="pb-name"><b>${escHtml(p.name)}</b><span>${escHtml(sub)}</span></div><span class="pb-tag is-${tone}">${escHtml(tag)}</span></div>`;
    document.getElementById('pbExpiryBody').innerHTML = !all
        ? '<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>No stock has expired, and nothing is likely to expire before it sells.</p>'
        : (showGone.length ? `<div class="pb-shelf"><h4><span class="pb-tag is-red"><span class="material-symbols-outlined" aria-hidden="true">block</span>Take off the shelf</span>expired, still counted in stock</h4>`
            + showGone.map(p => item(p, 'red', 'expired ' + ago(p), `${formatQty(p.expired_units)} on the shelf`)).join('') + '</div>' : '')
        + (showRisk.length ? `<div class="pb-shelf"><h4><span class="pb-tag is-amber"><span class="material-symbols-outlined" aria-hidden="true">sell</span>Sell these first</span>likely still on the shelf when they expire</h4>`
            + showRisk.map(p => item(p, 'amber', p.days_to_expiry === 0 ? 'expires today' : `expires in ${plural(p.days_to_expiry, 'day')}`,
                `${formatQty(p.stock)} on the shelf, about ${formatQty(p.expiry_risk_units)} may be left`)).join('') + '</div>' : '');
    const moreGone = expired.length - showGone.length, moreRisk = atRisk.length - showRisk.length;
    document.getElementById('pbExpiryFoot').innerHTML = moreGone || moreRisk
        ? `<span class="pb-note">${escHtml([moreGone ? `${formatNumber(moreGone)} more expired` : '', moreRisk ? `${formatNumber(moreRisk)} more to sell first` : ''].filter(Boolean).join(' and '))} in the full list</span>` : '';
}

/* The forecast in one figure and one chart: what sold each of the last 30
   days, then what is expected each of the next 30. The expected total is the
   forecast's own; it is spread over the days by the shop's weekday pattern. */
function renderBoardForecast() {
    const t = plan.totals, days = plan.forecast_days || 30;
    // what sold on the days the forecast counts, so a freak day is not set against it
    const check = t.sales_check;
    const sold30 = check ? check.sold_units : plan.products.reduce((a, p) => a + (Number(p.sold_30d) || 0), 0);
    const counted = countedReachesBack();
    const cats = (plan.by_category || []).filter(c => Math.round(c.expected_30d) > 0)
        .map(c => `<span class="pb-tag is-blue">${escHtml(c.name)} ${plural(Math.round(c.expected_30d), 'item')}</span>`).join('');
    const test = t.accuracy_test;
    let trust = '';
    if (test && test.actual_units > 0) {
        const ratio = test.predicted_units / test.actual_units;
        const close = ratio >= 0.8 && ratio <= 1.2;
        const range = test.from && test.to ? ` (${shortDate(test.from)} to ${shortDate(test.to)})` : '';
        trust = `<div class="pb-trust${close ? ' is-ok' : ''}"><span class="material-symbols-outlined" aria-hidden="true">${close ? 'check_circle' : 'info'}</span>`
            + `<span><b>${close ? 'Close last time.' : 'A rough guess.'}</b> Its last check${range} expected ${plural(test.predicted_units, 'item')} and you sold ${formatNumber(test.actual_units)}${close ? '.' : `, so it guessed ${ratio > 1 ? 'high' : 'low'}.`}</span>`
            + `<a href="#guessCard" data-board-go="forecast" data-focus="guessCard">Did it guess right?</a></div>`;
    }
    document.getElementById('pbForecastBody').innerHTML = `
        <div class="pb-fc">
            <div class="pb-fc-fig">
                <span class="pb-fc-lbl">Items expected to sell, ${escHtml(forecastSpan(days))}</span>
                <span class="pb-big">${formatNumber(t.expected_units)}<small>${t.expected_units === 1 ? 'item' : 'items'}</small></span>
                <p>Expected sales: about <b>${pesos(t.expected_revenue)}</b>.<br>Sold in the last 30 days${counted ? ' counted' : ''}: <b>${plural(sold30, 'item')}</b>.</p>
            </div>
            <div class="pb-chart">${boardChart(t.expected_units, days)}</div>
        </div>
        ${cats ? `<div class="pb-cats">${cats}</div>` : ''}
        ${trust}`;
}

function boardChart(expectedTotal, days) {
    const today = ymd(new Date());
    const sold = new Map((planDaily || []).map(r => [String(r.date).slice(0, 10), Number(r.item_count) || 0]));
    const past = [];
    // the history ends yesterday (today is not over), and the 30 forecast days start today
    for (let i = 30; i >= 1; i--) { const d = addDaysYmd(today, -i); past.push({ d, v: sold.get(d) || 0 }); }
    // weekday weights from the shop's own pattern; even when there is none
    const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const avg = order.map(name => { const r = (planDow || []).find(x => x.day === name); return r ? Number(r.avg_daily_sales) || 0 : 1; });
    const next = [];
    for (let i = 0; i < days; i++) next.push({ d: addDaysYmd(today, i) });
    let weight = x => avg[new Date(x.d + 'T00:00:00').getDay()] || 0;
    let weightSum = next.reduce((a, x) => a + weight(x), 0);
    if (!(weightSum > 0)) { weight = () => 1; weightSum = next.length; }
    next.forEach(x => { x.v = expectedTotal * weight(x) / weightSum; });
    const all = planDaily ? past.concat(next) : next;
    // Days the forecast does not count (a freak day, a closure, sales with no
    // items) are drawn hatched and kept off the scale: one day of 618 items
    // had flattened every other bar (10 Nov).
    const ranges = (plan.excluded && plan.excluded.ranges) || [];
    past.forEach(x => { x.out = ranges.find(r => x.d >= r.from && x.d <= r.to) || null; });
    const anyOut = !!planDaily && past.some(x => x.out);
    // the scale: a round number at the top, so the side labels read cleanly
    const top = niceCeil(Math.max(1, ...all.filter(x => !x.out).map(x => x.v)));
    const W = 600, H = 120, n = all.length, gap = 2, bw = W / n - gap;
    const pastCount = planDaily ? past.length : 0;
    const hatch = 'pbHatch' + (++hatchSeq);
    const bars = all.map((x, i) => {
        const out = i < pastCount && x.out;
        // a freak day stands the full height; an empty day left out is a short stub
        const h = out ? (x.v > 0 ? H : H * 0.12) : Math.max(x.v > 0 ? 2 : 0, x.v / top * H);
        return `<rect class="${out ? 'is-out' : i < pastCount ? 'is-sold' : 'is-next'}" x="${(i * (bw + gap)).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" style="--i:${i}${out ? `;fill:url(#${hatch})` : ''}"/>`;
    }).join('');
    const split = pastCount / n * 100;
    const line = pastCount ? `<line class="pb-today" x1="${(split / 100 * W - gap / 2).toFixed(1)}" y1="0" x2="${(split / 100 * W - gap / 2).toFixed(1)}" y2="${H}" vector-effect="non-scaling-stroke"/>` : '';
    // what each bar is, for the label that shows on hover or tap
    const day = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const outWhy = { freak: 'far more than a usual busy day', closed: 'no sales recorded', no_items: 'sales recorded without their items' };
    const tips = all.map((x, i) => i < pastCount
        ? (x.out ? `${day(x.d)}: ${x.v > 0 ? plural(x.v, 'item') + ' sold, ' : ''}not counted (${outWhy[x.out.reason] || 'no usable record'})`
            : `${day(x.d)}: ${plural(x.v, 'item')} sold`)
        : `${day(x.d)}${x.d === today ? ' (today)' : ''}: about ${plural(Math.round(x.v), 'item')} expected`);
    // a date under every week, counted from today both ways (Carlo, 8 Nov:
    // "dapat may pinapakita padin na info kase graph yan")
    const anchor = pastCount;            // today, the first forecast day
    const ticks = all.map((x, i) => ({ x, i })).filter(t => (t.i - anchor) % 7 === 0)
        .map((t, k) => `<span class="${k % 2 ? 'is-minor' : ''}${t.i === anchor ? ' is-today' : ''}" style="left:${((t.i * (bw + gap) + bw / 2) / W * 100).toFixed(2)}%">${escHtml(shortDate(t.x.d))}</span>`).join('');
    const head = pastCount
        ? `<span>Last 30 days, sold</span><span class="is-today" style="left:${split.toFixed(1)}%">Today</span><span>Next ${days} days, expected</span>`
        : `<span class="is-strong">From today</span><span>Next ${days} days, expected</span>`;
    const label = pastCount
        ? `Items sold each day for the last 30 days, then about ${formatNumber(expectedTotal)} items expected over the next ${days} days`
        : `About ${formatNumber(expectedTotal)} items expected over the next ${days} days`;
    return `<div class="pb-axis">${head}</div>
        <div class="pb-plot" data-tips="${encodeURIComponent(JSON.stringify(tips))}">
            <div class="pb-scale" aria-hidden="true"><span style="bottom:100%">${formatNumber(top)} items</span><span style="bottom:50%">${formatNumber(top / 2)}</span><span style="bottom:0">0</span></div>
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escHtml(label)}">${anyOut ? `<defs><pattern id="${hatch}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="pb-hatch" width="2.2" height="5"/></pattern></defs>` : ''}${bars}${line}</svg>
            <div class="pb-tip" role="status" hidden></div>
        </div>
        <div class="pb-ticks" aria-hidden="true">${ticks}</div>
        <div class="pb-legend">${pastCount ? '<span><i class="is-sold"></i>Sold each day</span>' : ''}<span><i class="is-next"></i>Expected each day</span>${anyOut ? '<span><i class="is-out"></i>Not counted</span>' : ''}<span class="pb-hint">Point at a bar to see its day</span></div>`;
}
let hatchSeq = 0;

/** The smallest round number (1, 2 or 5 × a power of ten) at or above v. */
function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 5, 10].map(m => m * p).find(x => x >= v);
}

/* One label for every chart of this kind: the day under the pointer (or the
   finger), and what sold or is expected that day. */
let chartTipWired = false;
function wireChartTips() {
    if (chartTipWired) return;
    chartTipWired = true;
    const show = e => {
        const plot = e.target.closest && e.target.closest('.pb-plot');
        if (!plot) return;
        const svg = plot.querySelector('svg'), tip = plot.querySelector('.pb-tip');
        let tips = [];
        try { tips = JSON.parse(decodeURIComponent(plot.dataset.tips || '%5B%5D')); } catch (err) { return; }
        const r = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(tips.length - 1, Math.floor((e.clientX - r.left) / r.width * tips.length)));
        const rects = svg.querySelectorAll('rect:not(.pb-hatch)');
        rects.forEach((b, k) => b.classList.toggle('is-hover', k === i));
        tip.textContent = tips[i];
        tip.hidden = false;
        // over its bar, but always inside the chart
        const w = tip.offsetWidth, pw = plot.clientWidth;
        const centre = (i + 0.5) / tips.length * svg.clientWidth + (svg.offsetLeft || 0);
        tip.style.left = Math.round(Math.max(0, Math.min(pw - w, centre - w / 2))) + 'px';
    };
    const hide = e => {
        const plot = e.target.closest && e.target.closest('.pb-plot');
        if (!plot) return;
        plot.querySelector('.pb-tip').hidden = true;
        plot.querySelectorAll('rect.is-hover').forEach(b => b.classList.remove('is-hover'));
    };
    document.addEventListener('pointermove', show);
    document.addEventListener('pointerdown', show);
    document.addEventListener('pointerout', e => { if (!e.relatedTarget || !e.target.closest('.pb-plot') || !e.relatedTarget.closest || e.relatedTarget.closest('.pb-plot') !== e.target.closest('.pb-plot')) hide(e); });
}

function renderBoardExcess(rows) {
    document.getElementById('pbExcessSub').textContent = rows.length ? `${plural(rows.length, 'product')}, hold off reordering` : 'No product is overstocked';
    const open = document.getElementById('pbExcessOpen');
    open.hidden = !rows.length;
    open.firstChild.textContent = `See all ${formatNumber(rows.length)} `;
    if (!rows.length) {
        document.getElementById('pbExcessBody').innerHTML = '<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>No product has more than three months of stock, and everything on the shelf has sold in the last 30 days.</p>';
        return;
    }
    const top = rows.slice(0, 3), max = Math.max(1, top[0].excess_value || 0);
    document.getElementById('pbExcessBody').innerHTML = `
        <div class="pb-money">${pesos(plan.totals.excess_value)}<small>tied up on the shelf</small></div>
        <div class="pb-bars">${top.map(p => `<div class="pb-bar" data-board-id="${p.product_id}" data-pane="excess" tabindex="0" role="button" aria-label="${escHtml(p.name)}: see its forecast">
            <b>${escHtml(p.name)}</b><span class="pb-bar-v">${p.excess_value > 0 ? pesos(p.excess_value) : '—'}</span>
            <span class="pb-bar-fill" style="width:${Math.max(4, Math.round((p.excess_value || 0) / max * 100))}%"></span>
            <span class="pb-bar-s">${formatQty(p.stock)} on the shelf, ${p.sold_30d > 0 ? formatQty(p.sold_30d) + ' sold' : 'none sold'} in the last 30 days</span>
        </div>`).join('')}</div>`;
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

/* A product as a card (Carlo picked option 1, 8 Nov): its picture, the shelf,
   one big figure and one action. Why, and the forecast, open in the panel at
   the side when the card is picked. */
function productCard(p, c) {
    return `<div class="pc" data-id="${p.product_id}" tabindex="0" role="button" aria-label="${escHtml(p.name)}: open its forecast">
        ${productPhoto(p, 'pc-pic')}
        <div class="pc-bd">
            <b class="pc-n">${escHtml(p.name)}</b>
            ${c.tag ? `<span class="pb-tag is-${c.tagTone}">${escHtml(c.tag)}</span>` : ''}
            <div class="pc-st">${c.paws || ''}<span>${escHtml(c.line)}</span></div>
            <div class="pc-big"><b>${escHtml(c.big)}</b>${c.money ? `<span class="is-${c.moneyTone || 'plain'}">${escHtml(c.money)}</span>` : ''}</div>
            ${c.action || ''}
        </div>
    </div>`;
}

function reorderCard(p, today) {
    const urgent = p.stock_status === 'out' || !p.order_by || p.order_by <= addDaysYmd(today, 1);
    const manage = typeof canManage === 'function' && canManage();
    const left = p.stock <= 0 ? 'None left' : `${formatQty(p.stock)} left, ${p.days_left == null ? 'no recent sales' : 'lasts ' + lastsText(p).toLowerCase()}`;
    return productCard(p, {
        tag: !p.order_by || p.order_by <= today || p.stock_status === 'out' ? '' : 'by ' + weekday(p.order_by),
        tagTone: urgent ? 'red' : 'amber',
        paws: boardPaws(p, urgent ? 'red' : 'amber'),
        line: left + (p.on_order > 0 ? `, ${formatQty(p.on_order)} on order` : ''),
        big: p.suggested_order > 0 ? `Order ${formatNumber(p.suggested_order)}` : `${formatQty(p.on_order)} on order`,
        money: orderCost(p) ? pesos(orderCost(p)) : '', moneyTone: urgent ? 'red' : 'amber',
        action: p.suggested_order > 0 && p.supplier_id && manage
            ? `<button type="button" class="btn-secondary pc-act" data-order="${p.product_id}">Reorder ${formatNumber(p.suggested_order)}</button>`
            : `<span class="pc-note">${p.suggested_order > 0 && !p.supplier_id ? 'No supplier set' : p.on_order > 0 ? 'Already on order' : ''}</span>`
    });
}

const CARD_PAGE = 10;           // ten cards at a time, then Show all
const cardGroupOpen = {};
/** A heading, its cards (the first twelve until "Show all"), for one group. */
function cardGroup(key, title, chips, items, card, action) {
    const open = cardGroupOpen[key], shown = open ? items : items.slice(0, CARD_PAGE);
    return `<section class="pc-group" aria-label="${escHtml(title)}">
        <div class="pc-gh"><h3>${escHtml(title)}</h3>${chips}${action || ''}</div>
        <div class="pc-grid">${shown.map(card).join('')}</div>
        ${items.length > CARD_PAGE ? `<button type="button" class="btn-secondary pc-more" data-more="${key}">${open ? 'Show fewer' : `Show all ${formatNumber(items.length)}`}</button>` : ''}
    </section>`;
}

let orderLaterOpen = false;
function renderReorder() {
    const today = ymd(new Date());
    const weekEnd = addDaysYmd(today, 7);
    const rows = plan.products.filter(p => p.stock_status !== 'ok')
        .sort((a, b) => (a.order_by || '0') < (b.order_by || '0') ? -1 : (a.order_by || '0') > (b.order_by || '0') ? 1 : a.name.localeCompare(b.name));
    const isToday = p => p.stock_status === 'out' || !p.order_by || p.order_by <= today;
    const now = rows.filter(isToday);
    const week = rows.filter(p => !isToday(p) && p.order_by <= weekEnd);
    const later = rows.filter(p => !isToday(p) && p.order_by > weekEnd);
    const createBtn = document.getElementById('createOrdersBtn');
    if (createBtn) createBtn.hidden = true;            // each group has its own "Order all"
    document.getElementById('orderChips').innerHTML = '';
    const manage = typeof canManage === 'function' && canManage();
    const chips = list => {
        const total = list.reduce((a, p) => a + orderCost(p), 0);
        const sup = [...new Set(list.map(p => p.supplier_name).filter(Boolean))];
        return `<span class="pb-tag is-${list === now ? 'red' : 'amber'}">${plural(list.length, 'product')}${total ? ', ' + pesos(total) : ''}</span>`
            + (sup.length ? `<span class="pb-tag is-slate">${sup.length === 1 ? 'from ' + escHtml(sup[0]) : plural(sup.length, 'supplier')}</span>` : '');
    };
    const orderAll = list => {
        const ids = list.filter(p => p.suggested_order > 0 && p.supplier_id).map(p => p.product_id);
        return ids.length && manage ? `<button type="button" class="btn-primary pc-all" data-order-ids="${ids.join(',')}"><span class="material-symbols-outlined">local_shipping</span> Order all ${formatNumber(ids.length)}</button>` : '';
    };
    const card = p => reorderCard(p, today);
    document.getElementById('orderList').innerHTML = !now.length && !week.length
        ? `<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Nothing to order this week.${later.length ? '' : ' Every product has enough stock for the next three weeks.'}</p>`
        : (now.length ? cardGroup('today', 'Order today', chips(now), now, card, orderAll(now)) : '')
          + (week.length ? cardGroup('week', 'Later this week', chips(week), week, card, orderAll(week)) : '');
    const names = later.slice(0, 3).map(p => p.name).join(', ') + (later.length > 3 ? `, and ${later.length - 3} more` : '');
    document.getElementById('orderLater').innerHTML = !later.length ? '' : `
        <div class="order-later-head"><span class="order-dot green" aria-hidden="true"></span>
            <span><b>Later:</b> ${formatNumber(later.length)} more product${later.length === 1 ? '' : 's'} to order in the next weeks (${escHtml(names)}). Nothing to do yet.</span>
            <button type="button" class="btn-secondary" data-later>${orderLaterOpen ? 'Hide them' : 'Show them'}</button></div>
        ${orderLaterOpen ? `<div class="pc-grid">${later.map(card).join('')}</div>` : ''}`;
    markSelected();
}

function onOrderListClick(e) {
    const one = e.target.closest('[data-order]');
    if (one) { e.stopPropagation(); createPlannedOrders([Number(one.dataset.order)]); return; }
    const all = e.target.closest('[data-order-ids]');
    if (all) { createPlannedOrders(all.dataset.orderIds.split(',').map(Number)); return; }
    const more = e.target.closest('[data-more]');
    if (more) { cardGroupOpen[more.dataset.more] = !cardGroupOpen[more.dataset.more]; renderReorder(); return; }
    if (e.target.closest('[data-later]')) { orderLaterOpen = !orderLaterOpen; renderReorder(); return; }
    const card = e.target.closest('[data-id]');
    if (card) openProductDetail(Number(card.dataset.id), card);
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

/* ---------- Did it guess right? ----------
   Opened by "See why". First the forecast's last checks (up to six
   fortnights), each with what it expected against what sold: one fortnight
   can come close by luck, six say more (10 Nov). Then the last check as the
   shop sees it: the eight best sellers as a scoreboard, each with its two
   bars (Forecast tab option 1, 8 Nov). */
const CHECK_WORD = { close: ['close', 'green', 'check'], high: ['too high', 'amber', 'north'], low: ['too low', 'amber', 'south'] };
const timesWord = n => n === 1 ? 'once' : n === 2 ? 'twice' : `${formatNumber(n)} times`;
const checkRange = k => `${shortDate(k.from)} to ${shortDate(k.to)}`;

function renderChecks() {
    const checks = (plan.totals && plan.totals.checks) || [];
    const box = document.getElementById('guessChecks');
    if (!box) return;
    const n = checks.length, count = m => checks.filter(k => k.mark === m).length;
    const close = count('close'), high = count('high'), low = count('low');
    document.getElementById('guessVerdict').innerHTML = !n ? ''
        : n === 1 ? `<span class="fc-verdict is-${CHECK_WORD[checks[0].mark][1]}"><span class="material-symbols-outlined" aria-hidden="true">${CHECK_WORD[checks[0].mark][2]}</span>Its last check was ${CHECK_WORD[checks[0].mark][0]}</span>`
        : `<span class="fc-verdict is-${close * 3 >= n * 2 ? 'green' : 'plain'}"><span class="material-symbols-outlined" aria-hidden="true">check</span>Close ${formatNumber(close)} of the last ${formatNumber(n)} times</span>`;
    const misses = [high ? `too high ${timesWord(high)}` : '', low ? `too low ${timesWord(low)}` : ''].filter(Boolean).join(', ');
    document.getElementById('guessChecksLine').textContent = (misses ? misses[0].toUpperCase() + misses.slice(1) + '. ' : '')
        + 'Each check hides two weeks, forecasts them, and compares.';
    const top = Math.max(1, ...checks.map(k => Math.max(k.predicted_units, k.actual_units)));
    box.innerHTML = checks.map((k, i) => {
        const w = CHECK_WORD[k.mark] || CHECK_WORD.close;
        return `<div class="fd-t${i === n - 1 ? ' is-last' : ''}">
            <b class="fd-t-when">${escHtml(checkRange(k))}</b>
            <span class="fc-pair" aria-hidden="true"><i class="is-exp" style="height:${Math.max(3, Math.round(k.predicted_units / top * 100))}%"></i><i class="is-sold" style="height:${Math.max(3, Math.round(k.actual_units / top * 100))}%"></i></span>
            <span class="fd-t-fig">expected <b>${formatNumber(k.predicted_units)}</b> items<br>sold <b>${formatNumber(k.actual_units)}</b> items</span>
            <span class="pb-tag is-${w[1]}"><span class="material-symbols-outlined" aria-hidden="true">${w[2]}</span>${w[0]}</span>
        </div>`;
    }).join('');
}

function renderGuess() {
    const card = document.getElementById('guessCard');
    const test = plan.totals && plan.totals.accuracy_test;
    const tested = plan.products.filter(p => p.test_sold != null && p.test_expected != null);
    if (!card) return;
    renderChecks();
    // nothing to show for the last check: its part stays empty (the card itself opens from "See why")
    const lastPart = ['guessLine', 'guessBody', 'guessMeans'].map(id => document.getElementById(id));
    const none = !test || !(test.actual_units > 0) || !tested.length;
    card.querySelector('.fd-sub').hidden = none;
    lastPart.forEach(el => { el.hidden = none; });
    if (none) return;
    const exp = test.predicted_units, sold = test.actual_units;
    const ratio = sold > 0 ? exp / sold : 0;
    const verdict = ratio > 1.2 ? ['Too high', 'amber', 'north'] : ratio < 0.8 ? ['Too low', 'amber', 'south'] : ['Close', 'green', 'check'];
    const range = test.from && test.to ? `${shortDate(test.from)} to ${shortDate(test.to)}` : 'The last two weeks on record';
    // days with no sales recorded inside the test make the guess look worse than it is
    const gap = test.from && (plan.excluded && plan.excluded.ranges || []).some(r => r.to >= test.from && r.from <= test.to);
    const best = tested.slice().sort((a, b) => b.test_sold - a.test_sold || b.test_expected - a.test_expected).slice(0, 8);
    const close = p => Math.abs(p.test_expected - p.test_sold) <= Math.max(1, p.test_sold * 0.25);
    const good = best.filter(close).length;
    document.getElementById('guessLine').textContent = `${range}: ${verdict[0].toLowerCase()}. It expected ${plural(exp, 'item')}, you sold ${formatNumber(sold)}`
        + `${gap && ratio > 1.2 ? ' (some of those days had no sales recorded)' : ''}. Close for ${formatNumber(good)} of your ${plural(best.length, 'best seller')}.`;
    const top = Math.max(1, ...best.map(p => Math.max(p.test_sold, p.test_expected)));
    document.getElementById('guessBody').innerHTML = best.map(p => {
        const e = Math.round(p.test_expected);
        const how = close(p) ? ['close', 'green'] : p.test_expected > p.test_sold ? ['guessed high', 'amber'] : ['guessed low', 'amber'];
        return `<div class="fc-sc" data-id="${p.product_id}" tabindex="0" role="button" aria-label="${escHtml(p.name)}: expected ${e}, sold ${p.test_sold}. Open its forecast">
            ${productPhoto(p, 'pb-ph')}
            <b class="fc-sc-n">${escHtml(p.name)}</b>
            <span class="fc-pair" aria-hidden="true"><i class="is-exp" style="height:${Math.max(3, Math.round(e / top * 100))}%"></i><i class="is-sold" style="height:${Math.max(3, Math.round(p.test_sold / top * 100))}%"></i></span>
            <span class="fc-sc-t">expected ${formatNumber(e)}, sold ${formatNumber(p.test_sold)}</span>
            <span class="pb-tag is-${how[1]}">${how[0]}</span>
        </div>`;
    }).join('');
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
        : '<b>So:</b> trust it most for products marked <b>Sure</b> (their own guess came close); treat the rest as a rough guess and check the shelf yourself.';
    document.getElementById('guessMeans').innerHTML = why + advice;
}

/* ---------- Too much stock, and stock that will expire ---------- */

let excessShown = CARD_PAGE;

function renderExcess() {
    const rows = plan.products.filter(p => p.excess_units > 0).sort((a, b) => b.excess_value - a.excess_value || b.excess_units - a.excess_units);
    document.getElementById('excessSub').textContent = rows.length
        ? `${rows.length} product${rows.length === 1 ? '' : 's'} holding ${pesos(plan.totals.excess_value)} more stock than the next three months need`
        : 'More than three months of stock at the expected rate of sale, or stock that is not selling';
    const box = document.getElementById('excessBody');
    if (!rows.length) {
        box.innerHTML = '<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>No product is overstocked.</p>';
        document.getElementById('excessPagination').innerHTML = '';
        return;
    }
    box.innerHTML = `<div class="pc-grid">${rows.slice(0, excessShown).map(p => productCard(p, {
        tag: p.excess_reason === 'not_selling' ? 'Not selling' : 'Lasts ' + lastsText(p).toLowerCase(), tagTone: 'slate',
        line: `${formatQty(p.stock)} on the shelf, ${p.sold_30d > 0 ? formatQty(p.sold_30d) + ' sold' : 'none sold'} in 30 days`,
        big: p.excess_value > 0 ? pesos(p.excess_value) : `${formatQty(p.excess_units)} too many`,
        money: p.excess_value > 0 ? 'tied up' : '', moneyTone: 'plain',
        action: `<span class="pc-note">${formatQty(p.excess_units)} more than three months need</span>`
    })).join('')}</div>`;
    updatePagination('excessPagination', rows, excessShown, 'showMoreExcess', 'showLessExcess', CARD_PAGE);
    markSelected();
}
function showMoreExcess() { excessShown += CARD_PAGE; renderExcess(); }
function showLessExcess() { excessShown = Math.max(CARD_PAGE, excessShown - CARD_PAGE); renderExcess(); }

function renderExpiry() {
    /* What has expired first (take it off the shelf today), then what is
       likely still on the shelf when it expires, soonest first; red and amber
       so the two are not confused (UAT, 1 Nov). */
    const all = plan.products.filter(p => p.expired_units > 0 || p.expiry_risk_units > 0);
    const soonest = (a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0);
    const atRisk = all.filter(p => !(p.expired_units > 0)).sort(soonest);
    const gone = all.filter(p => p.expired_units > 0).sort((a, b) => soonest(b, a));
    const rows = gone.concat(atRisk);
    document.getElementById('expirySub').textContent = rows.length
        ? `${gone.length ? gone.length + ' already expired with stock on the shelf. ' : ''}`
            + `${atRisk.length ? atRisk.length + ' likely to expire before selling out' + (plan.totals.expiry_risk_value > 0 ? `, worth ${pesos(plan.totals.expiry_risk_value)} at cost` : '') + '.' : ''}`
        : 'Stock expected to still be on the shelf on its expiry date, and stock already expired';
    const box = document.getElementById('expiryBody');
    if (!rows.length) {
        box.innerHTML = '<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Nothing has expired, and nothing is expected to expire unsold.</p>';
        document.getElementById('expiryPagination').innerHTML = '';
        return;
    }
    const ago = p => { const d = -(p.days_to_expiry ?? 0); return d <= 0 ? 'Expired today' : d === 1 ? 'Expired yesterday' : `Expired ${shortDate(p.expires_on)}`; };
    const goneCard = p => productCard(p, {
        tag: ago(p), tagTone: 'red',
        line: `${formatQty(p.stock)} on the shelf, still counted in stock`,
        big: `Remove ${formatQty(p.expired_units)}`
    });
    const riskCard = p => productCard(p, {
        tag: p.days_to_expiry === 0 ? 'Expires today' : `Expires ${shortDate(p.expires_on)}, in ${plural(p.days_to_expiry, 'day')}`, tagTone: 'amber',
        line: `${formatQty(p.stock)} on the shelf, ${p.per_week > 0 ? 'sells about ' + formatDecimal(p.per_week, p.per_week < 10 ? 1 : 0) + ' a week' : 'not selling'}`,
        big: `${formatQty(p.expiry_risk_units)} may be left`,
        money: p.expiry_risk_value > 0 ? pesos(p.expiry_risk_value) + ' at cost' : '', moneyTone: 'amber'
    });
    // both groups show at once, each with its own "Show all"
    const chip = (n, tone) => `<span class="pb-tag is-${tone}">${plural(n, 'product')}</span>`;
    box.innerHTML = (gone.length ? cardGroup('expired', 'Take off the shelf', chip(gone.length, 'red'), gone, goneCard) : '')
        + (atRisk.length ? cardGroup('risk', 'Sell these first', chip(atRisk.length, 'amber'), atRisk, riskCard) : '');
    document.getElementById('expiryPagination').innerHTML = '';
    markSelected();
}

/* "How the forecast works": shown by the button on the board (wireBoard),
   with a worked example taken from one of the shop's own products, and how
   far to trust the numbers in one plain sentence. */
function renderGuide() {
    const guide = document.getElementById('planGuide');
    if (!guide) return;
    // a product that sells regularly and has stock makes the clearest example
    const pick = [...plan.products]
        .filter(p => p.expected_30d >= 3 && soldCounted(p) >= 3 && p.stock > 0 && p.basis !== 'new')
        .sort((a, b) => soldCounted(b) - soldCounted(a))[0];
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
            + step('Sold last month', formatQty(soldCounted(pick)))
            + '<span class="plan-ex-arrow" aria-hidden="true">→</span>' + step('Expects next month', 'about ' + formatNumber(Math.round(pick.expected_30d)))
            + '<span class="plan-ex-arrow" aria-hidden="true">→</span>' + step('On your shelf', formatQty(pick.stock))
            + '<span class="plan-ex-arrow" aria-hidden="true">→</span>' + `<div class="plan-ex-step plan-ex-todo ${todo[1]}"><span>So</span><b>${todo[0]}</b></div>`
            + '</div>';
        ex.hidden = false;
    } else ex.hidden = true;
}

/* ---------- The monthly sales goal (Carlo, 9 Nov: "dapat may goal siya") ----------
   The Admin sets one amount in pesos for every month. The card sets it against
   what has sold this month so far and what the forecast expects for the days
   left, and says whether the shop is on track or what a day it needs. */
let goalData = null, goalEditing = false;
async function loadGoal() {
    try {
        const res = await fetch(`${API_BASE}/sales/goal`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'failed');
        goalData = data.data;
    } catch (e) {
        goalData = { error: true };
    }
    renderGoal();
}

function renderGoal() {
    const box = document.getElementById('fcGoal');
    if (!box || !goalData) return;
    if (goalData.error) { box.innerHTML = '<p class="rp-loading">The sales goal could not be loaded. Press Refresh to try again.</p>'; return; }
    const g = goalData, isAdmin = (getUser() || {}).role === 'admin';
    const monthName = new Date(g.month_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' });
    const head = (title, extra) => `<div class="fc-goal-head"><span class="fc-goal-ic" aria-hidden="true"><span class="material-symbols-outlined">flag</span></span>
        <div><h3 id="fcGoalTitle">${title}</h3>${extra || ''}</div>
        ${g.goal && isAdmin && !goalEditing ? '<button type="button" class="btn-secondary fc-goal-change" data-goal="edit"><span class="material-symbols-outlined">edit</span> Change goal</button>' : ''}</div>`;
    const form = `<form class="fc-goal-form" data-goal="form" novalidate>
        <label for="fcGoalInput">Sales goal for each month, in pesos</label>
        <div class="fc-goal-row"><span class="fc-goal-peso">₱</span><input id="fcGoalInput" class="form-input" inputmode="decimal" maxlength="14" placeholder="500000" value="${g.goal ? Math.round(g.goal) : ''}" aria-describedby="fcGoalMsg">
        <button type="submit" class="btn-primary">Save goal</button>${g.goal ? '<button type="button" class="btn-secondary" data-goal="cancel">Cancel</button>' : ''}</div>
        <p class="fc-goal-msg" id="fcGoalMsg" role="alert"></p></form>`;
    if (!g.goal || goalEditing) {
        box.innerHTML = head(g.goal ? `Change the sales goal` : `Set a sales goal for ${monthName}`,
            '<p>See whether the shop is on track this month, from what has sold so far and what the forecast expects for the days left.</p>')
            + (isAdmin ? form : '<p class="fc-goal-none">The Admin has not set a sales goal yet.</p>');
        wireGoal(box);
        return;
    }
    // what the forecast expects for the days after today, from its 30-day total
    const daysLeft = Math.max(0, g.days_in_month - g.day);
    const perDay = plan ? (Number(plan.totals.expected_revenue) || 0) / (plan.forecast_days || 30) : 0;
    const rest = perDay * daysLeft;
    const byEnd = g.sold_so_far + rest;
    const diff = byEnd - g.goal;
    const onTrack = diff >= 0;
    const lastDay = `${monthName.slice(0, 3)} ${g.days_in_month}`;
    const scale = Math.max(g.goal, byEnd) * 1.08 || 1;
    const pct = v => Math.max(0, Math.min(100, v / scale * 100)).toFixed(2);
    const needPerDay = daysLeft > 0 ? Math.max(0, (g.goal - g.sold_so_far) / daysLeft) : 0;
    box.innerHTML = head(`${monthName} sales goal: ${pesos(g.goal)}`,
            `<p>${onTrack ? 'The shop is on track to reach it.' : 'At the rate the forecast expects, the shop will fall short.'}</p>`)
        + `<div class="fc-goal-figs">
            <div><span>Sold so far, ${monthName.slice(0, 3)} 1 to ${g.day}</span><b>${pesos(g.sold_so_far)}</b><small>${plural(g.sales_so_far, 'sale')}</small></div>
            <div><span>Expected for the rest of ${monthName}</span><b>${pesos(rest)}</b><small>${daysLeft ? `${plural(daysLeft, 'day')} left, about ${pesos(perDay)} a day` : 'today is the last day'}</small></div>
            <div class="is-total"><span>Expected by ${lastDay}</span><b>${pesos(byEnd)}</b><small>${Math.round(byEnd / g.goal * 100)}% of the goal</small></div>
        </div>
        <div class="fc-goal-bar" role="img" aria-label="Sold ${pesos(g.sold_so_far)} and expected ${pesos(rest)} more, against a goal of ${pesos(g.goal)}">
            <i class="is-sold" style="width:${pct(g.sold_so_far)}%"></i><i class="is-next" style="width:${pct(rest)}%"></i>
            <span class="fc-goal-mark" style="left:${pct(g.goal)}%"><em>Goal ${pesos(g.goal)}</em></span>
        </div>
        <div class="fc-goal-key"><span><i class="is-sold"></i>Sold so far</span><span><i class="is-next"></i>Expected for the days left</span></div>
        <div class="pb-trust fc-goal-verdict${onTrack ? ' is-ok' : ''}"><span class="material-symbols-outlined" aria-hidden="true">${onTrack ? 'check_circle' : 'info'}</span>
            <span>${onTrack
                ? `<b>On track.</b> About ${pesos(diff)} more than the goal by ${lastDay}, if sales go as the forecast expects.`
                : `<b>About ${pesos(-diff)} short.</b> ${daysLeft ? `To reach the goal the rest of ${monthName} needs about ${pesos(needPerDay)} a day, against about ${pesos(perDay)} a day expected.` : 'Today is the last day of the month.'}`}</span></div>`;
    wireGoal(box);
}

function wireGoal(box) {
    if (box.dataset.wired) return;
    box.dataset.wired = '1';
    box.addEventListener('click', e => {
        const b = e.target.closest('[data-goal]');
        if (!b || b.tagName === 'FORM') return;
        goalEditing = b.dataset.goal === 'edit';
        renderGoal();
        if (goalEditing) document.getElementById('fcGoalInput')?.focus();
    });
    box.addEventListener('submit', async e => {
        e.preventDefault();
        const input = document.getElementById('fcGoalInput'), msg = document.getElementById('fcGoalMsg');
        const text = input.value.replace(/[₱,\s]/g, '');
        const amount = Number(text);
        const problem = text === '' ? 'Enter the goal in pesos, for example 500000.'
            : !isFinite(amount) ? 'The goal must be a number of pesos, for example 500000.'
            : amount <= 0 ? 'The goal must be more than ₱0.'
            : amount > 1e9 ? 'The goal cannot be more than ₱1,000,000,000.' : '';
        if (problem) { msg.textContent = problem; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        try {
            const res = await fetch(`${API_BASE}/sales/goal`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ goal: amount }) });
            const data = await res.json();
            if (!data.success) { msg.textContent = data.message || 'The goal could not be saved.'; input.setAttribute('aria-invalid', 'true'); return; }
            showToast('Sales goal saved', 'success');
            goalEditing = false;
            goalData.goal = data.data.goal;
            renderGoal();
        } catch (err) {
            msg.textContent = 'The goal could not be saved. Check the connection and try again.';
        }
    });
}

/* ---------- The top of the Forecast tab (option 1, Carlo 8 Nov) ----------
   The 30-day figure with its chart (sold each day, then expected each day),
   what it is worth split by category, and one card per category (or brand):
   items, share of all items, products selling, sold last month. Each figure
   is the sum over products, so the parts add up to the whole (UAT part 4, A14). */
const FC_COLORS = ['var(--primary)', 'color-mix(in srgb, var(--primary) 70%, var(--bg-card))', 'color-mix(in srgb, var(--primary) 45%, var(--bg-card))', 'color-mix(in srgb, var(--primary) 25%, var(--bg-card))'];
function forecastGroups(key) {
    const groups = new Map();
    plan.products.forEach(p => {
        const name = key === 'brand' ? (p.brand || 'Not set') : (p.category || 'No category');
        const g = groups.get(name) || { name, category: key === 'brand' ? null : name, units: 0, revenue: 0, selling: 0, sold: 0 };
        g.units += Number(p.expected_30d) || 0;
        g.revenue += (Number(p.expected_30d) || 0) * (Number(p.unit_price) || 0);
        g.sold += soldCounted(p);
        if ((Number(p.expected_30d) || 0) >= 0.5) g.selling++;
        groups.set(name, g);
    });
    return [...groups.values()].filter(g => g.units > 0 || g.sold > 0).sort((a, b) => b.units - a.units);
}

/* ---------- The Forecast tab, answer first (mock-up D, Carlo 10 Nov) ----------
   For someone who does not read charts: one sentence says what to expect, the
   two figures behind it sit side by side, one line says how far to trust it.
   The server decides all three (sales_check and checks in the overview); this
   only puts them into words. The chart, the categories, the days not counted
   and the checks are closed until their button is pressed, one at a time. */
function renderVerdict() {
    const t = plan.totals, c = t.sales_check, days = plan.forecast_days || 30;
    const hero = document.getElementById('fdHero');
    if (!hero || !c) return;
    const off = c.verdict === 'high' || c.verdict === 'low';
    hero.dataset.tone = off ? 'warn' : c.verdict === 'none' ? 'plain' : 'ok';
    const icon = off ? 'priority_high' : c.verdict === 'none' ? 'schedule' : { more: 'trending_up', less: 'trending_down', same: 'trending_flat' }[c.direction];
    document.getElementById('fdIcon').innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
    document.getElementById('fdSay').textContent = c.verdict === 'high' ? 'This forecast looks too high.'
        : c.verdict === 'low' ? 'This forecast looks too low.'
        : c.verdict === 'none' ? `About ${plural(t.expected_units, 'item')} expected in the next ${days} days.`
        : `You will likely sell ${{ more: 'more', less: 'less', same: 'about the same' }[c.direction]} in the next ${days} days.`;
    document.getElementById('fdWhy').textContent = off ? 'Look at your best sellers yourself before you order from it.'
        : c.verdict === 'none' ? 'Too little sold in the last 30 days to compare it with.'
        : { busier: 'Your last 7 days were busier than the weeks before.', quieter: 'Your last 7 days were quieter than the weeks before.', steady: 'Your sales have been steady over the last 30 days.' }[c.recent];
    // "counted" only when days were left out of those 30, so they reach further back
    const counted = countedReachesBack();
    const span = c.from ? `${shortDate(c.from)} to ${shortDate(addDaysYmd(ymd(new Date()), -1))}${counted ? ', without the days not counted' : ''}` : '';
    document.getElementById('fdVs').innerHTML = `<div class="fd-box is-was" title="${escHtml(span)}"><span>${counted ? 'Last 30 days counted' : 'Last 30 days'}</span><b>${formatNumber(c.sold_units)}</b><small>${c.sold_units === 1 ? 'item' : 'items'} sold</small></div>
        <span class="material-symbols-outlined fd-arrow" aria-hidden="true">arrow_forward</span>
        <div class="fd-box is-next" title="${escHtml(forecastSpan(days))}"><span>Next ${days} days, about</span><b>${formatNumber(t.expected_units)}</b><small>${t.expected_units === 1 ? 'item' : 'items'} expected</small></div>`;

    // how far to trust it: one paw for each of its last checks, filled when it came close
    const checks = t.checks || [], trust = document.getElementById('fdTrust'), n = checks.length;
    trust.hidden = !n;
    if (n) {
        const close = checks.filter(k => k.mark === 'close').length;
        const paws = checks.slice().sort((a, b) => (a.mark === 'close' ? 0 : 1) - (b.mark === 'close' ? 0 : 1))
            .map(k => `<span class="material-symbols-outlined${k.mark === 'close' ? ' is-on' : ''}">pets</span>`).join('');
        const line = n === 1 ? `<b>Its last check was ${CHECK_WORD[checks[0].mark][0]}.</b> One check is too few to lean on: use it as a guide.`
            : `<b>Right ${formatNumber(close)} of its last ${formatNumber(n)} checks.</b> ${close * 3 >= n * 2 ? 'It has been close most of the time.' : 'Use it as a guide, not as an exact number.'}`;
        trust.innerHTML = `<span class="fd-paws" role="img" aria-label="${close} of its last ${n} checks came close">${paws}</span><span class="fd-trust-t">${line}</span>`
            + `<button type="button" class="btn-secondary fd-why" data-fold="why" aria-expanded="false" aria-controls="guessCard">See why <span class="material-symbols-outlined" aria-hidden="true">expand_more</span></button>`;
    }

    // the closed parts say what is inside before they are opened
    const cats = forecastGroups('category').filter(g => Math.round(g.units) > 0);
    document.getElementById('fdCatsTease').textContent = cats.length
        ? `${cats[0].name} ${plural(Math.round(cats[0].units), 'item')}` + (cats.length > 1 ? `, and ${plural(cats.length - 1, 'more category', 'more categories')}` : '')
        : 'What will sell, and what it is worth';
    renderNotCounted();
    syncFolds();
}

/* The days the forecast leaves out, newest first, each with its reason. */
function renderNotCounted() {
    const ranges = ((plan.excluded && plan.excluded.ranges) || []).slice().sort((a, b) => b.from.localeCompare(a.from));
    const fold = document.getElementById('fdFoldOut');
    if (!fold) return;
    fold.hidden = !ranges.length;
    document.getElementById('fdMore').classList.toggle('is-two', !ranges.length);
    if (!ranges.length) { if (fdOpen === 'out') fdOpen = null; return; }
    const when = r => r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} to ${shortDate(r.to)}`;
    const what = r => r.reason === 'freak' ? `${plural(r.items, 'item')} in ${r.days === 1 ? 'one day' : r.days + ' days'}`
        : r.reason === 'closed' ? `${plural(r.days, 'day')} with no sales` : plural(r.days, 'day');
    const why = r => r.reason === 'freak' ? `About ${formatNumber(Math.max(2, Math.round(r.items / r.days / Math.max(1, r.typical))))} times a usual busy day (${plural(r.typical, 'item')}).`
        : r.reason === 'closed' ? 'The shop was closed, or nothing was recorded.'
        : `${plural(r.sales, 'sale was', 'sales were')} recorded without ${r.sales === 1 ? 'its' : 'their'} items.`;
    const icon = { freak: 'bolt', closed: 'door_front', no_items: 'receipt_long' };
    document.getElementById('fdOutTitle').textContent = `${plural(ranges.length, 'period')} not counted`;
    document.getElementById('fdOutTease').textContent = `${when(ranges[0])} (${what(ranges[0])})` + (ranges.length > 1 ? `, and ${formatNumber(ranges.length - 1)} more` : '');
    document.getElementById('fdOutSub').textContent = `${plural(plan.excluded.days, 'day')} the forecast leaves out`;
    document.getElementById('fdOutList').innerHTML = ranges.map(r => `<div class="fd-o"><span class="fd-o-ic" aria-hidden="true"><span class="material-symbols-outlined">${icon[r.reason] || 'event_busy'}</span></span>
        <div><b>${escHtml(when(r))}: ${escHtml(what(r))}</b><span>${escHtml(why(r))}</span></div></div>`).join('');
}

/* One closed part open at a time. Pressing its button again closes it. */
let fdOpen = null;
function openFold(name, toggle) {
    fdOpen = toggle && fdOpen === name ? null : name;
    syncFolds();
    const panel = fdOpen && document.querySelector(`[data-fold-panel="${fdOpen}"]`);
    if (!panel) return;
    // bring it into view when it opened below the screen
    const r = panel.getBoundingClientRect();
    if (r.top > window.innerHeight - 120) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function syncFolds() {
    document.querySelectorAll('.plan-pane[data-pane="forecast"] [data-fold]').forEach(b => {
        const on = b.dataset.fold === fdOpen;
        b.setAttribute('aria-expanded', on ? 'true' : 'false');
        b.classList.toggle('is-open', on);
    });
    document.querySelectorAll('[data-fold-panel]').forEach(p => { p.hidden = p.dataset.foldPanel !== fdOpen; });
}

function renderForecastTop() {
    const t = plan.totals, days = plan.forecast_days || 30;
    renderVerdict();
    document.getElementById('fcUnitsLabel').textContent = `Items sold each day (${pastSpan()}), then about ${plural(t.expected_units, 'item')} expected (${forecastSpan(days)})`;
    document.getElementById('fcRevLabel').textContent = `Expected sales in pesos, next ${days} days (${forecastSpan(days)})`;
    document.getElementById('fcWhatSub').textContent = `items expected to sell, ${forecastSpan(days)}`;
    document.getElementById('fcChart').innerHTML = boardChart(t.expected_units, days);
    document.getElementById('kpiForecastRevenue').textContent = pesos(t.expected_revenue);
    // the pesos split by category: the top three, then the rest together
    const cats = forecastGroups('category').filter(g => g.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const parts = cats.slice(0, 3).concat(cats.length > 3 ? [{ name: cats.length === 4 ? cats[3].name : `${cats.length - 3} others`, revenue: cats.slice(3).reduce((a, g) => a + g.revenue, 0) }] : []);
    const rev = parts.reduce((a, g) => a + g.revenue, 0) || 1;
    const money = v => v >= 1e6 ? formatCompactCurrency(v) : pesos(v);
    document.getElementById('revenueBreakdown').innerHTML = parts.map((g, i) => `<i style="flex:${Math.max(0.5, g.revenue / rev * 100)};background:${FC_COLORS[i]}"></i>`).join('');
    document.getElementById('revenueKeys').innerHTML = parts.map((g, i) => `<span><i style="background:${FC_COLORS[i]}"></i>${escHtml(g.name)} <b>${money(g.revenue)}</b> <small>${Math.round(g.revenue / rev * 100)}%</small></span>`).join('');
    renderDemandCards('categoryDemand', forecastGroups('category'), 'category');
    const brands = forecastGroups('brand').filter(g => g.name !== 'Not set');
    if (brands.length) renderDemandCards('brandDemand', brands, 'brand');
    else document.getElementById('brandDemand').innerHTML = '<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">info</span>No product has a brand set yet. Add a brand to products in Inventory to see which brands are expected to sell.</p>';
}

function renderDemandCards(id, groups, kind) {
    const box = document.getElementById(id);
    if (!box) return;
    if (!groups.length) { box.innerHTML = '<p class="pb-none"><span class="material-symbols-outlined" aria-hidden="true">info</span>Nothing is expected to sell yet.</p>'; return; }
    const total = groups.reduce((a, g) => a + g.units, 0) || 1;
    const top = groups.slice(0, 4), rest = groups.slice(4);
    const icon = g => kind === 'brand' ? 'sell' : categoryIcon({ category: g.name });
    box.innerHTML = top.map(g => {
        const pct = Math.round(g.units / total * 100);
        return `<section class="rp-card panel-card fc-cat" aria-label="${escHtml(g.name)}">
            <span class="fc-cat-ic" aria-hidden="true"><span class="material-symbols-outlined">${icon(g)}</span></span>
            <b class="fc-cat-n">${escHtml(g.name)}</b>
            <span class="fc-cat-u">${formatNumber(Math.round(g.units))}<small>${Math.round(g.units) === 1 ? 'item' : 'items'}</small></span>
            <span class="fc-cat-bar" style="width:${Math.max(3, pct)}%" aria-hidden="true"></span>
            <span class="fc-cat-s">${pct}% of all items, ${plural(g.selling, 'product')} selling. Sold ${formatQty(g.sold)} in the ${soldSpan()}.</span>
        </section>`;
    }).join('') + (rest.length ? `<p class="fc-rest">${plural(rest.length, kind === 'brand' ? 'other brand' : 'other category', kind === 'brand' ? 'other brands' : 'other categories')}: ${plural(Math.round(rest.reduce((a, g) => a + g.units, 0)), 'item')} together.</p>` : '');
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
            + row('Average of the last 28 days, no machine learning', pct(cmp.statistical_baseline))
            + row('What this page uses', pct(cmp.system_forecast), true)
            + '</div>';
    }
    box.innerHTML = html;
}

/* Which of the three groups a product is in: order today, order soon, or no order needed. */
function orderGroup(p) {
    if (p.stock_status === 'ok') return 'ok';
    return p.stock_status === 'out' || !p.order_by || p.order_by <= ymd(new Date()) ? 'today' : 'soon';
}
const perWeekText = v => v >= 1.5 ? `about ${formatNumber(Math.round(v))} a week` : v >= 0.5 ? 'about 1 a week' : v > 0 ? 'less than 1 a week' : '';

/** Why, in one short line under what to do. */
function fdWhyLine(p) {
    const left = formatQty(p.stock);
    if (p.stock_status !== 'ok') {
        const base = p.stock <= 0 ? 'None left on the shelf.'
            : p.stock <= p.reorder_level ? `${left} left, at or below its reorder level of ${formatQty(p.reorder_level)}.`
            : `${left} left, lasts ${lastsText(p).toLowerCase()}.`;
        return base + (p.on_order > 0 ? ` ${formatQty(p.on_order)} already on order.` : '') + (!p.supplier_id ? ' No supplier set.' : '');
    }
    if (p.expired_units > 0) return `${formatQty(p.expired_units)} expired on ${shortDate(p.expires_on)}.`;
    if (p.expiry_risk_units > 0) return `About ${formatQty(p.expiry_risk_units)} may still be here on ${shortDate(p.expires_on)}.`;
    if (p.excess_reason === 'not_selling') return `${left} on the shelf, nothing sold in 30 days.`;
    if (p.excess_units > 0) return `${left} on the shelf, more than three months' worth.`;
    return p.stock <= 0 ? 'None on the shelf, and none expected to sell.'
        : `${left} on the shelf, ${p.days_left == null ? 'no recent sales' : 'lasts ' + lastsText(p).toLowerCase()}.`;
}

/* A product on the Forecast tab (mock-up D): what to do comes first and is the
   biggest thing on the card, then why in one line; how much it sells and how
   sure the forecast is are small, underneath. Where an order can be placed
   from here, what to do is the button that places it. */
function forecastCard(p) {
    const d = doThis(p), sure = HOW_SURE[p.how_sure] || HOW_SURE.rough, today = ymd(new Date());
    const manage = typeof canManage === 'function' && canManage();
    const needs = p.stock_status !== 'ok';
    let tone = d.dot === 'grey' ? 'slate' : { danger: 'red', warning: 'amber', ok: 'green' }[d.tone] || 'slate';
    let text = d.text, action;
    if (needs && p.suggested_order > 0 && p.supplier_id && manage) {
        const when = p.stock_status === 'out' ? 'now' : !p.order_by || p.order_by <= today ? 'today' : 'by ' + shortDate(p.order_by);
        action = `<button type="button" class="${tone === 'red' ? 'btn-primary' : 'btn-secondary'} fd-do" onclick="createPlannedOrders([${Number(p.product_id)}])"><span class="material-symbols-outlined" aria-hidden="true">shopping_cart</span>Order ${formatNumber(p.suggested_order)} ${when}</button>`;
    } else {
        if (needs && !(p.suggested_order > 0) && p.on_order > 0) { text = 'Already on order'; tone = 'amber'; }
        const icon = needs ? (text === 'Already on order' ? 'local_shipping' : 'shopping_cart')
            : { green: 'check_circle', red: 'block', amber: 'schedule', slate: 'pause_circle' }[tone];
        action = `<span class="fd-do is-${tone}"><span class="material-symbols-outlined" aria-hidden="true">${icon}</span>${escHtml(text)}</span>`;
    }
    const sells = perWeekText(p.per_week);
    return `<div class="pc fd-pc" data-id="${p.product_id}" tabindex="0" role="button" aria-label="${escHtml(p.name)}: ${escHtml(text)}. Open its forecast">
        ${productPhoto(p, 'pc-pic')}
        <div class="pc-bd">
            <b class="pc-n">${escHtml(p.name)}</b>
            ${action}
            <span class="fd-line">${escHtml(fdWhyLine(p))}</span>
            <div class="fd-sm"><span>${sells ? 'Sells ' + sells : 'No sales expected'}</span><span class="pb-tag is-${sure.tone === 'ok' ? 'green' : 'slate'}" title="${escHtml(sure.why)}">${sure.text}</span></div>
        </div>
    </div>`;
}

function renderAllProducts() {
    // The search box and the group buttons are usable before the forecast has
    // arrived. What was typed or picked is kept, and applied when it does.
    if (!plan) return;
    const all = plan.products;
    const count = g => all.filter(p => orderGroup(p) === g).length;
    document.getElementById('countAll').textContent = all.length;
    document.getElementById('countToday').textContent = count('today');
    document.getElementById('countSoon').textContent = count('soon');
    document.getElementById('countOk').textContent = count('ok');

    // what needs an order comes first, then by expected sales
    const rank = { today: 0, soon: 1, ok: 2 };
    const rows = all
        .filter(p => planFilter === 'all' || orderGroup(p) === planFilter)
        .filter(p => !planSearch || p.name.toLowerCase().includes(planSearch) || (p.sku || '').toLowerCase().includes(planSearch))
        .sort((a, b) => rank[orderGroup(a)] - rank[orderGroup(b)] || b.expected_30d - a.expected_30d || b.sold_30d - a.sold_30d || a.name.localeCompare(b.name));
    document.getElementById('planListSub').textContent = groupText(planFilter, all)
        + (planSearch ? ` ${formatNumber(rows.length)} match “${planSearch}”.` : '');

    const grid = document.getElementById('predictionsTableBody');
    if (!rows.length) {
        setRow('predictionsTableBody', 6, planSearch ? 'No products match that search.' : 'No products in this group.');
        document.getElementById('predictionsPagination').innerHTML = '';
        return;
    }
    grid.innerHTML = rows.slice(0, predDisplayCount).map(forecastCard).join('');
    updatePagination('predictionsPagination', rows, predDisplayCount, 'showMorePredictions', 'showLessPredictions', PRED_PAGE_SIZE);
    markSelected();
}

/* Every product in plain words (forecast mock-up 2): how sure, and what to do.
   How sure comes from the product's own last test (backend howSure): sure when
   it sells at least 4 a month and its guess for the hidden two weeks came
   within a quarter of what sold (or within 1 item), the same "close" as in
   "Did it guess right?". */
const HOW_SURE = {
    sure: { text: 'Sure', tone: 'ok', why: 'Its last guess came close to what really sold' },
    rough: { text: 'Rough guess', tone: 'plain', why: 'It sells too little to test, or its last guess was further off' },
    new: { text: 'Too new to tell', tone: 'plain', why: 'Under four weeks of sales on record' }
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
    // red, so it is not read as a mild note (Ms Mel, 12 Nov)
    if (p.excess_units > 0) return { text: 'Too much: stop ordering', tone: 'danger', dot: 'red' };
    return { text: 'Enough', tone: 'ok', dot: 'green' };
}

/* The line under the heading: what the chosen group is, in a sentence. */
function groupText(group, all) {
    const list = group === 'all' ? all : all.filter(p => orderGroup(p) === group);
    if (!list.length) return { all: 'No products yet.', today: 'Nothing needs ordering today.', soon: 'Nothing else needs ordering in the next three weeks.', ok: 'No products in this group right now.' }[group];
    const n = plural(list.length, 'product');
    if (group === 'today') return `${n} to order today, so the shelf is not empty before a delivery arrives.`;
    if (group === 'soon') return `${n} to order in the next three weeks, each by the date shown.`;
    if (group === 'ok') return `${n} with enough on the shelf. Some carry another note: sell it first, or too much stock.`;
    return `${n}. Products that need an order come first.`;
}

function showMorePredictions() { predDisplayCount += PRED_PAGE_SIZE; renderAllProducts(); }
function showLessPredictions() { predDisplayCount = Math.max(PRED_PAGE_SIZE, predDisplayCount - PRED_PAGE_SIZE); renderAllProducts(); }

/* ---------- One product ---------- */

/* One product in the panel at the side of the list (Carlo picked option 1,
   8 Nov): four numbers in place of the old paragraph, its weeks as a chart,
   and how sure the forecast is, in one line. */
let detailProductId = null;
async function openProductDetail(productId, fromEl) {
    const p = plan && plan.products.find(x => x.product_id === productId);
    if (!p) return;
    const card = document.getElementById('productDetail'), detail = document.getElementById('planDetail');
    // opened from somewhere the lists are not showing: open the list it belongs to
    if (detail && detail.hidden) showPlanView(p.stock_status !== 'ok' ? 'reorder' : p.expired_units > 0 || p.expiry_risk_units > 0 ? 'expiry' : p.excess_units > 0 ? 'excess' : 'forecast');
    detailProductId = productId;
    card.hidden = false;
    if (detail) detail.classList.add('has-panel');
    markSelected();
    document.getElementById('detailPhoto').innerHTML = productPhoto(p, 'pd-pic');
    document.getElementById('detailTitle').textContent = p.name;
    document.getElementById('detailSub').textContent = [p.sku, p.category, p.supplier_name ? 'from ' + p.supplier_name : ''].filter(Boolean).join(', ');
    document.getElementById('detailBoxes').innerHTML = detailBoxes(p);
    document.getElementById('detailNotes').innerHTML = detailNotes(p);
    const sure = detailSure(p), sureBox = document.getElementById('detailSure');
    sureBox.className = 'pd-sure is-' + sure.tone;
    sureBox.innerHTML = sure.html;
    const manage = typeof canManage === 'function' && canManage();
    document.getElementById('detailFoot').innerHTML =
        (p.stock_status !== 'ok' && p.suggested_order > 0 && p.supplier_id && manage
            ? `<button type="button" class="btn-primary" onclick="createPlannedOrders([${Number(p.product_id)}])"><span class="material-symbols-outlined">local_shipping</span> Reorder ${formatNumber(p.suggested_order)}</button>` : '')
        + '<button type="button" class="btn-secondary" onclick="closeProductDetail()">Close</button>';
    const status = document.getElementById('detailSummary');
    status.hidden = false;
    status.textContent = 'Loading its weeks…';
    if (forecastChart) { forecastChart.destroy(); forecastChart = null; }
    placePanel(card, detail, fromEl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        // this product's own supplier delivery time and what is already on order, as in the list
        const params = new URLSearchParams({ stock: Math.round(p.stock), reorder_level: p.reorder_level, lead_time: p.lead_time_days || plan.lead_time_days, on_order: p.on_order || 0 });
        const response = await fetch(`${PRED_API}/product/${encodeURIComponent(productId)}?${params}`, { headers: getAuthHeaders(), signal: controller.signal });
        const data = await response.json();
        if (detailProductId !== productId) return;          // another product was picked meanwhile
        if (!data.success) { status.textContent = 'No sales on record yet, so there are no weeks to show.'; return; }
        status.hidden = true;
        renderForecastChart(data.data);
    } catch (error) {
        console.error('Error loading product forecast:', error);
        if (detailProductId === productId) status.textContent = error.name === 'AbortError'
            ? 'This chart is taking longer than usual. Try again in a minute.'
            : 'The chart for this product could not be loaded.';
    } finally {
        clearTimeout(timeout);
    }
}

/** Sold, expected, on the shelf, and what to do: four boxes. */
function detailBoxes(p) {
    const perWeek = v => v >= 1.5 ? `about ${formatNumber(Math.round(v))} a week` : v >= 0.5 ? 'about 1 a week' : v > 0 ? 'less than 1 a week' : 'none';
    const box = (label, value, sub, tone) => `<div class="pd-box${tone ? ' is-' + tone : ''}"><span>${label}</span><b>${escHtml(value)}</b><small>${escHtml(sub)}</small></div>`;
    const today = ymd(new Date());
    let so;
    if (p.stock_status !== 'ok') {
        const urgent = p.stock_status === 'out' || !p.order_by || p.order_by <= addDaysYmd(today, 1);
        const when = p.stock_status === 'out' || !p.order_by || p.order_by <= today ? 'today' : 'by ' + weekday(p.order_by);
        so = p.suggested_order > 0
            ? box('So', `Order ${formatNumber(p.suggested_order)}`, when + (orderCost(p) ? ', ' + pesos(orderCost(p)) : ''), urgent ? 'red' : 'amber')
            : box('So', 'On order', `${formatQty(p.on_order)} coming`, 'amber');
    } else if (p.expired_units > 0) so = box('So', `Remove ${formatQty(p.expired_units)}`, 'expired ' + shortDate(p.expires_on), 'red');
    else if (p.expiry_risk_units > 0) so = box('So', 'Sell it first', `about ${formatQty(p.expiry_risk_units)} may be left on ${shortDate(p.expires_on)}`, 'amber');
    else if (p.excess_reason === 'not_selling') so = box('So', 'Stop ordering', 'nothing sold in 30 days', 'slate');
    else if (p.excess_units > 0) so = box('So', 'Hold off', `${pesos(p.excess_value)} more than needed`, 'slate');
    else so = box('So', 'Enough', 'nothing to do', 'green');
    const expected = !(p.expected_high > 0) ? 'None' : p.expected_low === p.expected_high ? 'About ' + formatNumber(p.expected_low) : `${formatNumber(p.expected_low)} to ${formatNumber(p.expected_high)}`;
    const sold = soldCounted(p);
    return box('Sold, ' + soldSpan(), formatQty(sold), sold > 0 ? perWeek(sold / 30 * 7) : 'nothing sold')
        + box('Expected, next 30 days', expected, p.expected_high > 0 ? perWeek(p.per_week) : 'little or none expected')
        + box('On the shelf', formatQty(p.stock), (p.stock <= 0 ? 'none left' : p.days_left == null ? 'no recent sales' : 'lasts ' + lastsText(p).toLowerCase()) + (p.on_order > 0 ? `, ${formatQty(p.on_order)} on order` : ''))
        + so;
}

/** Short extras, only when they apply: the suggested reorder point, expiry, a new product. */
function detailNotes(p) {
    const notes = [];
    if (p.recommended_reorder_point != null && p.recommended_reorder_point !== p.reorder_level) {
        notes.push(['tune', `Suggested reorder point ${formatNumber(p.recommended_reorder_point)}, set to ${formatQty(p.reorder_level)}`]);
    }
    if (p.stock_status !== 'ok' && p.expired_units > 0) notes.push(['block', `${formatQty(p.expired_units)} expired: take them off the shelf`]);
    if (p.stock_status !== 'ok' && p.expiry_risk_units > 0) notes.push(['schedule', `About ${formatQty(p.expiry_risk_units)} may expire unsold on ${shortDate(p.expires_on)}`]);
    if (p.basis === 'new') notes.push(['fiber_new', `New: ${plural(p.days_on_record, 'day')} of sales on record`]);
    return notes.map(n => `<span class="pd-note"><span class="material-symbols-outlined" aria-hidden="true">${n[0]}</span>${escHtml(n[1])}</span>`).join('');
}

/** How sure, in one line, from the product's own last test. */
function detailSure(p) {
    let tone = 'warn', text;
    if (p.basis === 'new' || p.how_sure === 'new') { tone = 'plain'; text = `<b>Too new to tell.</b> Under four weeks of sales on record.`; }
    else if (p.test_expected != null && p.test_sold != null) {
        const said = `Last check it expected ${formatNumber(Math.round(p.test_expected))}, and ${formatNumber(p.test_sold)} sold.`;
        if (p.how_sure === 'sure') { tone = 'ok'; text = `<b>Sure.</b> ${said}`; } else text = `<b>Rough guess.</b> ${said}`;
    } else text = '<b>Rough guess.</b> Its forecast has not been tested yet.';
    return { tone, html: `<span class="material-symbols-outlined" aria-hidden="true">${tone === 'ok' ? 'check_circle' : 'info'}</span><span>${text}</span>` };
}

/* Beside the list, the panel opens level with the card that was clicked, so
   nobody has to scroll back up to read it (Carlo, 8 Nov). It is kept inside
   the screen and inside the list. Stacked on a narrow screen, the panel sits
   above the list, so the page goes up to it instead. */
function placePanel(card, detail, fromEl) {
    card.style.marginTop = '0px';
    const beside = detail && getComputedStyle(detail).display === 'grid';
    if (!beside) {
        const r = card.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight - 80) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const d = detail.getBoundingClientRect(), h = card.getBoundingClientRect().height;
    const want = fromEl && fromEl.isConnected ? fromEl.getBoundingClientRect().top : 16;
    // keep the whole panel on screen where it fits, and never above the screen's top
    const onScreen = Math.max(16, Math.min(want, window.innerHeight - h - 16));
    const offset = Math.max(0, Math.min(onScreen - d.top, d.height - h));
    card.style.marginTop = Math.round(offset) + 'px';
    const r = card.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** The card of the product in the panel stays outlined in its list. */
function markSelected() {
    document.querySelectorAll('#planDetail [data-id].is-sel').forEach(e => e.classList.remove('is-sel'));
    const card = document.getElementById('productDetail');
    if (detailProductId == null || !card || card.hidden) return;
    document.querySelectorAll(`#planDetail [data-id="${detailProductId}"]`).forEach(e => e.classList.add('is-sel'));
}

function closeProductDetail() {
    const card = document.getElementById('productDetail');
    if (card) { card.hidden = true; card.style.marginTop = ''; }
    const detail = document.getElementById('planDetail');
    if (detail) detail.classList.remove('has-panel');
    detailProductId = null;
    markSelected();
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

    /* The best day and the best-selling item, said in words above the chart
       (Ms Mel, 12 Nov: "ano pinaka mabentang araw and ano pinaka mabentang item") */
    const best = document.getElementById('patternBest');
    if (best) {
        const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
        const top = dow.length ? dow.reduce((a, b) => (Number(b.avg_daily_sales) || 0) > (Number(a.avg_daily_sales) || 0) ? b : a) : null;
        const item = plan && plan.products ? [...plan.products].sort((a, b) => soldCounted(b) - soldCounted(a))[0] : null;
        const chips = [];
        if (top && Number(top.avg_daily_sales) > 0) chips.push(`<span class="pattern-best"><span class="material-symbols-outlined" aria-hidden="true">calendar_month</span><span><small>Best day</small><b>${escHtml(DAY_NAME[top.day] || top.day)}</b> about ${formatDecimal(Number(top.avg_daily_sales), 0)} items a day</span></span>`);
        if (item && soldCounted(item) > 0) chips.push(`<span class="pattern-best"><span class="material-symbols-outlined" aria-hidden="true">star</span><span><small>Best-selling item, last 30 days</small><b>${escHtml(item.name)}</b> ${formatNumber(soldCounted(item))} sold</span></span>`);
        best.innerHTML = chips.join('');
        best.hidden = !chips.length;
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
