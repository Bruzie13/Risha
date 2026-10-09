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
        setRow('reorderTableBody', 5, msg);
        setRow('predictionsTableBody', 7, msg);
    } finally {
        clearTimeout(timeout);
        planLoading = false;
    }
}

function refreshAnalytics() {
    predDisplayCount = PRED_PAGE_SIZE;
    reorderDisplayCount = PRED_PAGE_SIZE;
    setRow('reorderTableBody', 5, 'Working out what to reorder…');
    setRow('predictionsTableBody', 7, 'Loading products…');
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
        if (row) openProductDetail(Number(row.dataset.id));
    });
    document.getElementById('reorderTableBody').addEventListener('click', e => {
        const row = e.target.closest('tr[data-id]');
        if (row) openProductDetail(Number(row.dataset.id));
    });
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
    showNotice('planNotice', plan.last_sale_date == null
        ? 'No sales have been recorded yet. Forecasts will appear once the shop starts recording sales.'
        : stale
            ? `The last sale on record was ${planDate(plan.last_sale_date)}, ${plan.days_since_last_sale} days ago. `
              + 'Forecasts are based on recent sales, so they will stay low until new sales are recorded. Stock levels and reorder levels below are still current.'
            : '');
    document.getElementById('planCaption').textContent =
        `Based on sales from the last ${plan.window_days} days. Forecasts cover the next ${plan.forecast_days} days.`
        + (plan.last_sale_date && !stale ? ` Last sale recorded ${planDate(plan.last_sale_date)}.` : '');
    const lead = document.getElementById('howLead');
    if (lead) lead.textContent = plan.lead_time_days;

    document.getElementById('kpiForecastUnits').textContent = formatNumber(t.expected_units) + (t.expected_units === 1 ? ' item' : ' items');
    document.getElementById('kpiForecastRevenue').textContent = formatCurrency(t.expected_revenue);
    document.getElementById('kpiToReorder').textContent = formatNumber(t.to_reorder);
    document.getElementById('kpiToReorderNote').textContent = t.to_reorder
        ? (t.out_of_stock ? `${t.out_of_stock} already out of stock` : `of ${t.products} products`)
        : 'Nothing needs ordering';
    document.getElementById('kpiAccuracy').textContent = t.accuracy != null ? formatDecimal(t.accuracy, 0) + '%' : 'Not available';
    document.getElementById('kpiAccuracyNote').textContent = t.accuracy != null
        ? 'How close the forecast came in a test on the last two weeks'
        : 'Needs recent sales to test against';

    renderReorder();
    renderAllProducts();
}

function renderReorder() {
    const tbody = document.getElementById('reorderTableBody');
    const rows = plan.products.filter(p => p.stock_status !== 'ok');
    if (!rows.length) {
        setRow('reorderTableBody', 5, 'Nothing needs reordering right now.');
        document.getElementById('reorderPagination').innerHTML = '';
        return;
    }
    tbody.innerHTML = rows.slice(0, reorderDisplayCount).map(p => `
        <tr data-id="${p.product_id}" tabindex="0">
            <td><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td>${badge(p.stock_status)}<span class="rp-sub">${escHtml(reorderReason(p))}</span></td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="num">${p.per_week > 0 ? formatDecimal(p.per_week, 1) : '—'}</td>
            <td class="num rp-strong">${formatNumber(p.suggested_order)}</td>
        </tr>`).join('');
    updatePagination('reorderPagination', rows, reorderDisplayCount, 'showMoreReorder', 'showLessReorder', PRED_PAGE_SIZE);
}

function showMoreReorder() { reorderDisplayCount += PRED_PAGE_SIZE; renderReorder(); }
function showLessReorder() { reorderDisplayCount = PRED_PAGE_SIZE; renderReorder(); }

function renderAllProducts() {
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

    const tbody = document.getElementById('predictionsTableBody');
    if (!rows.length) {
        setRow('predictionsTableBody', 7, planSearch ? 'No products match that search.' : 'No products in this group.');
        document.getElementById('predictionsPagination').innerHTML = '';
        return;
    }
    tbody.innerHTML = rows.slice(0, predDisplayCount).map(p => `
        <tr data-id="${p.product_id}" tabindex="0">
            <td><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="num">${p.sold_30d > 0 ? formatQty(p.sold_30d) : '—'}</td>
            <td class="num">${p.expected_30d >= 0.5 ? formatNumber(Math.round(p.expected_30d)) : '—'}</td>
            <td>${escHtml(lastsText(p))}</td>
            <td>${p.expected_30d >= 0.5 ? TREND_LABEL[p.trend] || 'Steady' : '—'}</td>
            <td>${badge(p.stock_status)}</td>
        </tr>`).join('');
    updatePagination('predictionsPagination', rows, predDisplayCount, 'showMorePredictions', 'showLessPredictions', PRED_PAGE_SIZE);
}

function showMorePredictions() { predDisplayCount += PRED_PAGE_SIZE; renderAllProducts(); }
function showLessPredictions() { predDisplayCount = PRED_PAGE_SIZE; renderAllProducts(); }

/* ---------- One product ---------- */

async function openProductDetail(productId) {
    const p = plan && plan.products.find(x => x.product_id === productId);
    if (!p) return;
    const card = document.getElementById('productDetail');
    card.hidden = false;
    document.getElementById('detailTitle').textContent = p.name;
    document.getElementById('detailSub').textContent = p.sku ? `SKU ${p.sku}` : '';
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

function detailSentence(p) {
    const parts = [`${formatQty(p.stock)} in stock.`];
    parts.push(p.expected_30d >= 0.5
        ? `Expected to sell about ${formatNumber(Math.round(p.expected_30d))} in the next 30 days (around ${formatDecimal(p.per_week, 1)} a week).`
        : 'Little or nothing is expected to sell in the next 30 days.');
    if (p.stock > 0 && p.days_left != null) parts.push(`At that rate the stock lasts ${lastsText(p).toLowerCase()}.`);
    if (p.stock_status !== 'ok') parts.push(`${STOCK_LABEL[p.stock_status].text}: suggested order ${formatNumber(p.suggested_order)}.`);
    if (p.confidence && p.expected_30d >= 0.5) {
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

function renderForecastChart(data) {
    const canvas = document.getElementById('demandForecastChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (forecastChart) forecastChart.destroy();

    const history = (data.historical_data || []).slice(-60);
    const predicted = data.predictions || [];
    const labels = [], actual = [], forecast = [], lower = [], upper = [];
    const short = s => { const d = planDate(s); return d ? d.replace(/, \d{4}$/, '') : ''; };

    history.forEach(h => { labels.push(short(h.date)); actual.push(Number(h.quantity) || 0); forecast.push(null); lower.push(null); upper.push(null); });
    predicted.forEach(pt => {
        labels.push(short(pt.date));
        actual.push(null);
        forecast.push(Number(pt.predicted_quantity) || 0);
        lower.push(pt.lower_bound != null ? Number(pt.lower_bound) : null);
        upper.push(pt.upper_bound != null ? Number(pt.upper_bound) : null);
    });

    const t = chartTheme();
    const options = baseChartOptions(t);
    options.interaction = { mode: 'index', intersect: false };
    options.plugins.tooltip = {
        filter: item => item.dataset.label !== 'range' && item.raw != null,
        callbacks: { label: item => `${item.dataset.label}: ${formatDecimal(item.raw, 1)}` }
    };
    options.scales.x.ticks.maxTicksLimit = 10;
    forecastChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'range', data: upper, borderWidth: 0, pointRadius: 0, fill: false, tension: 0.25 },
                { label: 'range', data: lower, borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: t.barSoft + '55', tension: 0.25 },
                { label: 'Sold', data: actual, borderColor: t.bar, borderWidth: 1.75, pointRadius: 0, tension: 0.2 },
                { label: 'Forecast', data: forecast, borderColor: t.bar, borderWidth: 1.75, borderDash: [5, 4], pointRadius: 0, tension: 0.25 }
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
    const lines = [['Product', 'SKU', 'Status', 'Why', 'In stock', 'Reorder level', 'Sells per week', 'Suggested order'].map(csvCell).join(',')];
    rows.forEach(p => lines.push([p.name, p.sku || '', STOCK_LABEL[p.stock_status].text, reorderReason(p),
        p.stock, p.reorder_level, p.per_week, p.suggested_order].map(csvCell).join(',')));
    downloadCSV(`reorder_list_${ymd(new Date())}.csv`, lines);
    showToast('Reorder list exported', 'success');
}
