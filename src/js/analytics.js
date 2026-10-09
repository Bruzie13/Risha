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
        setRow('reorderTableBody', 6, msg);
        setRow('predictionsTableBody', 7, msg);
    } finally {
        clearTimeout(timeout);
        planLoading = false;
    }
}

function refreshAnalytics() {
    predDisplayCount = PRED_PAGE_SIZE;
    reorderDisplayCount = PRED_PAGE_SIZE;
    setRow('reorderTableBody', 6, 'Working out what to reorder…');
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
    ['reorderTableBody', 'excessBody', 'expiryBody'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            const row = e.target.closest('tr[data-id]');
            if (row) openProductDetail(Number(row.dataset.id));
        });
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
    document.getElementById('planCaption').textContent =
        `Based on ${plan.history_days ? plan.history_days + ' days of sales on record (the model reads up to 12 months)' : 'sales on record'}. Forecasts cover the next ${plan.forecast_days} days.`
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
    renderExcess();
    renderExpiry();
    renderAllProducts();
    renderDemandGroups();
    renderModel();
}

function renderReorder() {
    const tbody = document.getElementById('reorderTableBody');
    const rows = plan.products.filter(p => p.stock_status !== 'ok');
    const orderable = rows.filter(p => p.suggested_order > 0 && p.supplier_id);
    const createBtn = document.getElementById('createOrdersBtn');
    if (createBtn) createBtn.hidden = !(orderable.length && typeof canManage === 'function' && canManage());
    if (!rows.length) {
        setRow('reorderTableBody', 6, 'Nothing needs reordering right now.');
        document.getElementById('reorderPagination').innerHTML = '';
        return;
    }
    const today = ymd(new Date());
    tbody.innerHTML = rows.slice(0, reorderDisplayCount).map(p => {
        const suggestion = p.suggested_order > 0
            ? formatNumber(p.suggested_order)
            : (p.on_order > 0 ? '<span class="rp-sub">Already on order</span>' : '—');
        return `
        <tr data-id="${p.product_id}" tabindex="0">
            <td><span class="rp-strong">${escHtml(p.name)}</span><span class="rp-sub">${escHtml(p.supplier_name ? 'From ' + p.supplier_name : 'No supplier set — cannot be ordered from here')}</span></td>
            <td>${badge(p.stock_status)}<span class="rp-sub">${escHtml(reorderReason(p))}</span></td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="num">${p.on_order > 0 ? formatQty(p.on_order) : '—'}</td>
            <td>${p.order_by ? (p.order_by <= today ? '<span class="rp-urgent">Today</span>' : escHtml(planDate(p.order_by))) : '—'}</td>
            <td class="num rp-strong">${suggestion}</td>
        </tr>`;
    }).join('');
    updatePagination('reorderPagination', rows, reorderDisplayCount, 'showMoreReorder', 'showLessReorder', PRED_PAGE_SIZE);
}

function showMoreReorder() { reorderDisplayCount += PRED_PAGE_SIZE; renderReorder(); }
function showLessReorder() { reorderDisplayCount = Math.max(PRED_PAGE_SIZE, reorderDisplayCount - PRED_PAGE_SIZE); renderReorder(); }

/* Turn the reorder list into purchase orders — one per supplier, each emailed
   to its supplier, with the quantities the forecast suggests. */
function createPlannedOrders() {
    const lines = plan.products.filter(p => p.stock_status !== 'ok' && p.suggested_order > 0 && p.supplier_id);
    if (!lines.length) { showToast('Nothing on the list can be ordered right now', 'warning'); return; }
    const suppliers = new Set(lines.map(p => p.supplier_id)).size;
    const skipped = plan.products.filter(p => p.stock_status !== 'ok' && p.suggested_order > 0 && !p.supplier_id).length;
    showConfirmDialog('Create purchase orders',
        `This creates ${suppliers} purchase order${suppliers === 1 ? '' : 's'} covering ${lines.length} product${lines.length === 1 ? '' : 's'}, `
        + `with the suggested quantities, and <strong>emails each order to its supplier straight away</strong>.`
        + (skipped ? ` ${skipped} product${skipped === 1 ? ' has' : 's have'} no supplier set and will be left out.` : ''),
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
                showSuccessDialog('Purchase orders created', escHtml(data.message || 'Done.') + warnings, { icon: 'local_shipping' });
                loadStockPlanning(true);
            } catch (error) {
                console.error('Creating orders failed:', error);
                showToast('The orders could not be created', 'error');
            }
        }, 'Create and email');
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
    const rows = plan.products.filter(p => p.expired_units > 0 || p.expiry_risk_units > 0)
        .sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0));
    const expired = rows.filter(p => p.expired_units > 0).length;
    document.getElementById('expirySub').textContent = rows.length
        ? `${expired ? expired + ' already expired with stock on the shelf. ' : ''}${rows.length - expired} more likely to expire before selling out`
            + (plan.totals.expiry_risk_value > 0 ? `, worth ${formatCurrency(plan.totals.expiry_risk_value)} at cost` : '')
        : 'Stock expected to still be on the shelf on its expiry date, and stock already expired';
    if (!rows.length) { setRow('expiryBody', 5, 'Nothing is expected to expire unsold.'); document.getElementById('expiryPagination').innerHTML = ''; return; }
    document.getElementById('expiryBody').innerHTML = rows.slice(0, expiryShown).map(p => {
        const gone = p.expired_units > 0;
        const when = gone
            ? `<span class="rp-urgent">Expired</span><span class="rp-sub">${escHtml(planDate(p.expires_on))}</span>`
            : `${escHtml(planDate(p.expires_on))}<span class="rp-sub">in ${p.days_to_expiry} day${p.days_to_expiry === 1 ? '' : 's'}</span>`;
        const left = gone ? p.expired_units : p.expiry_risk_units;
        return `<tr data-id="${p.product_id}" tabindex="0">
            <td><span class="rp-strong">${escHtml(p.name)}</span>${p.sku ? `<span class="rp-sub">${escHtml(p.sku)}</span>` : ''}</td>
            <td>${when}</td>
            <td class="num">${formatQty(p.stock)}</td>
            <td class="num">${formatQty(left)}${gone ? '<span class="rp-sub">remove from the shelf</span>' : ''}</td>
            <td class="num rp-strong">${gone ? '—' : (p.expiry_risk_value > 0 ? formatCurrency(p.expiry_risk_value) : '—')}</td>
        </tr>`;
    }).join('');
    updatePagination('expiryPagination', rows, expiryShown, 'showMoreExpiry', 'showLessExpiry', PRED_PAGE_SIZE);
}
function showMoreExpiry() { expiryShown += PRED_PAGE_SIZE; renderExpiry(); }
function showLessExpiry() { expiryShown = Math.max(PRED_PAGE_SIZE, expiryShown - PRED_PAGE_SIZE); renderExpiry(); }

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

function renderModel() {
    const model = plan.model || {};
    const cmp = model.comparison;
    const body = document.getElementById('modelCompareBody');
    const note = document.getElementById('modelCompareNote');
    const pct = v => v == null ? '—' : formatDecimal(v, 1) + '%';
    if (!cmp) {
        body.innerHTML = '<tr><td colspan="2" class="rp-loading">Not available yet. The test compares the forecast with the last two weeks of sales, and too few sales were recorded in that time to judge it fairly.</td></tr>';
        note.textContent = '';
    } else {
        const best = Math.max(cmp.random_forest ?? 0, cmp.gradient_boosting ?? 0, cmp.ensemble ?? 0);
        const row = (label, value, hint, strong) => `<tr><td>${strong ? '<span class="rp-strong">' + label + '</span>' : label}<span class="rp-sub">${hint}</span></td><td class="num ${strong ? 'rp-strong' : ''}">${pct(value)}</td></tr>`;
        body.innerHTML =
            row('Random Forest alone', cmp.random_forest, 'Many decision trees, averaged', false)
            + row('Gradient Boosting alone', cmp.gradient_boosting, 'Trees that each correct the last', false)
            + row('Both together (the ensemble)', cmp.ensemble, 'The average of the two models', cmp.ensemble === best)
            + row('Simple trend only', cmp.statistical_baseline, 'No machine learning, for comparison', false)
            + row('What this page uses', cmp.system_forecast, 'The ensemble balanced with the simple trend', true);
        note.textContent = `Tested on ${cmp.products} product${cmp.products === 1 ? '' : 's'} that sold ${formatNumber(cmp.actual_units)} items in the test period. `
            + 'Accuracy is how close the forecast total came to the items actually sold.';
    }
    document.getElementById('modelSub').textContent = model.runtime && !/python/.test(model.runtime)
        ? 'The machine-learning model could not be run, so these forecasts use the simple trend only'
        : 'The model is tested on the most recent two weeks, which it is not shown';

    const weights = (model.feature_weights || []).filter(w => w.weight > 0.005);
    const box = document.getElementById('featureWeights');
    if (!weights.length) { box.innerHTML = '<p class="rp-empty">Available once a product has enough sales history to train on.</p>'; return; }
    renderBars('featureWeights', weights.slice(0, 8).map(w => ({
        label: w.feature.charAt(0).toUpperCase() + w.feature.slice(1), value: w.weight, text: Math.round(w.weight * 100) + '%'
    })));
}

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
    if (p.stock_status !== 'ok') {
        parts.push(p.suggested_order > 0
            ? `${STOCK_LABEL[p.stock_status].text}: order ${formatNumber(p.suggested_order)}${p.order_by ? ' by ' + planDate(p.order_by) : ''}.`
            : `${STOCK_LABEL[p.stock_status].text}, and ${formatQty(p.on_order)} already on order.`);
    }
    if (p.recommended_reorder_point != null) {
        parts.push(`Recommended reorder point: ${formatNumber(p.recommended_reorder_point)}, which includes a safety stock of ${formatNumber(p.safety_stock)}`
            + (p.recommended_reorder_point !== p.reorder_level ? ` (it is currently set to ${formatQty(p.reorder_level)}).` : ' (matches the current setting).'));
    }
    if (p.expiry_risk_units > 0) parts.push(`About ${formatQty(p.expiry_risk_units)} may still be unsold when it expires on ${planDate(p.expires_on)}.`);
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
