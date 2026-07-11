const PRED_API = `${API_BASE}/predictions`;
let forecastChart = null;
let seasonalChart = null;
let dowChart = null;
let allProducts = [];
let allPredictions = [];
let predictionsMeta = null;   // totals + backtested accuracy from /predictions/all
let currentSegments = null;   // fast / slow / risk / steady product lists
const PRED_PAGE_SIZE = 10;
let predDisplayCount = PRED_PAGE_SIZE;

// load is triggered by reports.js when the Analytics tab is clicked

async function loadProductList() {
    try {
        const response = await fetch(`${API_BASE}/products`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allProducts = Array.isArray(data.data) ? data.data : [];
            const sel = document.getElementById('productSelector');
            if (!sel) return;
            sel.innerHTML = '<option value="">Select a product for detailed forecast</option>';
            allProducts.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name} (SKU: ${p.sku || 'N/A'})`;
                sel.appendChild(opt);
            });
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

function onProductChange() {
    const sel = document.getElementById('productSelector');
    const metricsGrid = document.getElementById('metricsGrid');
    const chartsSection = document.getElementById('chartsSection');
    const advice = document.getElementById('forecastAdvice');
    if (sel && sel.value) {
        metricsGrid.style.display = 'grid';
        chartsSection.style.display = 'grid';
        loadProductPrediction(sel.value);
    } else {
        metricsGrid.style.display = 'none';
        chartsSection.style.display = 'none';
        if (advice) advice.style.display = 'none';
    }
}

async function loadProductPrediction(productId) {
    try {
        const product = allProducts.find(p => p.id == productId);
        const stock = product ? (product.stock_quantity || 0) : 0;
        const reorderLevel = product ? (product.reorder_level || 10) : 10;
        const url = `${PRED_API}/product/${productId}?stock=${stock}&reorder_level=${reorderLevel}&lead_time=7`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, { headers: getAuthHeaders(), signal: controller.signal });
        clearTimeout(timeout);
        const data = await response.json();
        if (data.success) {
            renderForecastChart(data.data);
            renderPredictionMetrics(data.data);
        } else {
            clearCharts();
            showToast(data.error || 'Insufficient sales data for this product', 'warning');
        }
    } catch (error) {
        console.error('Error loading prediction:', error);
        clearCharts();
        if (error.name === 'AbortError') {
            showToast('Prediction request timed out. Please try again.', 'warning');
        } else {
            showToast('Prediction service unavailable. Try again later.', 'error');
        }
    }
}

function clearCharts() {
    if (forecastChart) { forecastChart.destroy(); forecastChart = null; }
    document.getElementById('predictedSales').textContent = '--';
    document.getElementById('confidenceScore').textContent = '--';
    document.getElementById('reorderPoint').textContent = '--';
    document.getElementById('trendIndicator').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">trending_flat</span> --';
    const advice = document.getElementById('forecastAdvice');
    if (advice) advice.style.display = 'none';
}

function renderForecastChart(data) {
    const canvas = document.getElementById('demandForecastChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (forecastChart) forecastChart.destroy();

    const historical = data.historical_data || [];
    const predicted = data.predictions || [];

    if (historical.length === 0 && predicted.length === 0) return;

    const labels = [];
    const histValues = [];
    const predValues = [];
    const lowerValues = [];
    const upperValues = [];

    if (historical.length > 0) {
        const recentHistorical = historical.slice(-60);
        recentHistorical.forEach(h => {
            labels.push(h.date || '');
            histValues.push(parseFloat(h.quantity || 0));
        });
    }

    const gap = historical.length > 0 ? 1 : 0;
    if (gap) {
        labels.push('');
        histValues.push(null);
        predValues.push(null);
    }

    while (lowerValues.length < labels.length) { lowerValues.push(null); upperValues.push(null); }

    if (predicted.length > 0) {
        predicted.forEach(p => {
            labels.push(p.date || `Day ${p.day || ''}`);
            predValues.push(parseFloat(p.predicted_quantity || 0));
            lowerValues.push(p.lower_bound != null ? parseFloat(p.lower_bound) : null);
            upperValues.push(p.upper_bound != null ? parseFloat(p.upper_bound) : null);
        });
    }

    while (histValues.length < labels.length) histValues.push(null);

    const hasBand = upperValues.some(v => v != null);
    const datasets = [
        {
            label: 'Historical Sales',
            data: histValues,
            borderColor: '#6FB3DF',
            backgroundColor: 'rgba(111, 179, 223, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 2
        },
        {
            label: 'Predicted Sales',
            data: predValues,
            borderColor: '#F0B95A',
            backgroundColor: 'rgba(240, 185, 90, 0.08)',
            borderDash: [5, 5],
            fill: false,
            tension: 0.3,
            pointRadius: 2
        }
    ];

    if (hasBand) {
        datasets.push({
            label: 'Forecast Range (upper)',
            data: upperValues,
            borderColor: 'rgba(240, 185, 90, 0)',
            backgroundColor: 'rgba(240, 185, 90, 0.15)',
            fill: false,
            pointRadius: 0,
            tension: 0.3
        });
        datasets.push({
            label: 'Forecast Range',
            data: lowerValues,
            borderColor: 'rgba(240, 185, 90, 0)',
            backgroundColor: 'rgba(240, 185, 90, 0.15)',
            fill: '-1',
            pointRadius: 0,
            tension: 0.3
        });
    }

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        filter: (item) => item.text !== 'Forecast Range (upper)'
                    }
                },
                tooltip: {
                    filter: (item) => item.dataset.label !== 'Forecast Range (upper)' && item.dataset.label !== 'Forecast Range'
                }
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Units Sold' } } }
        }
    });
}

function renderPredictionMetrics(data) {
    const nextMonth = data.next_month_prediction;
    const confidence = data.confidence_score;
    const trend = data.trend || 'stable';
    const reorder = data.reorder_recommendation || {};

    document.getElementById('predictedSales').textContent = nextMonth != null ? formatDecimal(nextMonth, 1) : '--';
    document.getElementById('confidenceScore').textContent = confidence != null ? formatDecimal(confidence, 1) + '%' : '--';

    const reorderPoint = reorder.recommended_reorder_point;
    document.getElementById('reorderPoint').textContent = reorderPoint != null ? reorderPoint : '--';

    const trendEl = document.getElementById('trendIndicator');
    const t = (trend || '').toLowerCase();
    let trendAdvice = '';
    if (trendEl) {
        if (t.includes('up')) {
            trendEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">trending_up</span> Increasing';
            trendEl.style.color = '#7FC98F';
            trendAdvice = 'Demand is rising — consider increasing stock';
        } else if (t.includes('down')) {
            trendEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">trending_down</span> Decreasing';
            trendEl.style.color = '#E8746C';
            trendAdvice = 'Demand is declining — avoid overstocking';
        } else {
            trendEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">trending_flat</span> Stable';
            trendEl.style.color = '#F0B95A';
            trendAdvice = 'Demand is steady — maintain current levels';
        }
    }

    // Merge long recommendation text into a single full-width advice banner
    // (previously crammed into the small Trend card, causing overflow)
    const adviceEl = document.getElementById('forecastAdvice');
    const chipsEl = document.getElementById('forecastAdviceChips');
    if (adviceEl && chipsEl) {
        const chips = [];
        if (trendAdvice) {
            const cls = t.includes('up') ? 'good' : t.includes('down') ? 'bad' : 'neutral';
            chips.push({ text: trendAdvice, cls: cls, icon: t.includes('up') ? 'trending_up' : t.includes('down') ? 'trending_down' : 'trending_flat' });
        }
        if (reorder.days_until_stockout != null && reorder.days_until_stockout < 999) {
            chips.push({ text: 'Estimated stockout in ~' + reorder.days_until_stockout + ' days', cls: reorder.days_until_stockout <= 14 ? 'bad' : 'neutral', icon: 'schedule' });
        }
        if (reorder.reorder_triggered && reorder.recommended_order_quantity > 0) {
            chips.push({ text: 'Suggest ordering ~' + reorder.recommended_order_quantity + ' units', cls: 'warn', icon: 'shopping_cart' });
        }
        if (reorder.safety_stock != null && reorder.safety_stock > 0) {
            chips.push({ text: 'Keep ' + reorder.safety_stock + ' units as safety stock', cls: 'neutral', icon: 'shield' });
        }
        chipsEl.innerHTML = chips.map(function (c) {
            return '<span class="advice-chip ' + c.cls + '"><span class="material-symbols-outlined" style="font-size:14px;">' + c.icon + '</span> ' + c.text + '</span>';
        }).join('');
        adviceEl.style.display = chips.length ? 'flex' : 'none';
    }
}

async function loadAllPredictions() {
    const tableBody = document.getElementById('predictionsTableBody');
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="8" class="text-center"><span class="material-symbols-outlined" style="font-size:16px;">hourglass_top</span> Analyzing sales history and computing forecasts...</td></tr>';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const allPromise = fetch(`${PRED_API}/all`, { headers: getAuthHeaders(), signal: controller.signal })
        .then(r => r.json())
        .then(d => { if (d.success) { allPredictions = d.data.predictions || []; predictionsMeta = d.data; } })
        .catch(e => { if (e.name !== 'AbortError') console.error('Error loading all predictions:', e); });

    const summaryPromise = fetch(`${PRED_API}/summary`, { headers: getAuthHeaders(), signal: controller.signal })
        .then(r => r.json())
        .then(d => { if (d.success) renderSeasonalChart(d.data.seasonal_trends || []); })
        .catch(e => { if (e.name !== 'AbortError') console.error('Error loading summary:', e); });

    const trendsPromise = fetch(`${PRED_API}/trends`, { headers: getAuthHeaders(), signal: controller.signal })
        .then(r => r.json())
        .then(d => { if (d.success) renderDowChart((d.data.seasonality && d.data.seasonality.day_of_week_patterns) || []); })
        .catch(e => { if (e.name !== 'AbortError') console.error('Error loading trends:', e); });

    await Promise.all([allPromise, summaryPromise, trendsPromise]);
    clearTimeout(timeout);

    if (allPredictions.length === 0) {
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="8" class="text-center"><span class="material-symbols-outlined" style="font-size:16px;">warning_amber</span> No sales history yet — forecasts will appear once products have recorded sales.</td></tr>';
    } else {
        renderPerformanceAnalysis();
        mergeAndRenderTable();
    }
}

function renderPerformanceAnalysis() {
    const enabled = allProducts.length > 0 && allPredictions.length > 0;
    document.getElementById('fastMoversCount').textContent = '—';
    document.getElementById('slowMoversCount').textContent = '—';
    document.getElementById('atRiskCount').textContent = '—';
    document.getElementById('steadyCount').textContent = '—';
    if (!enabled) return;

    // Quartile thresholds: retail demand is long-tailed, so a mean split
    // dumps nearly everything into "slow". Top quartile = fast, bottom
    // quartile = slow, stockout-risk overrides, the rest are steady.
    const demands = allPredictions.map(p => p.next_month_prediction || 0).sort((a, b) => a - b);
    const q = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0;
    const q75 = q(demands, 0.75);
    const q25 = q(demands, 0.25);

    const analyzed = allProducts.map(product => {
        const pred = allPredictions.find(p => p.product_id === product.id);
        const predictedDemand = pred ? (pred.next_month_prediction || 0) : 0;
        const stock = product.stock_quantity || 0;
        const dailyAvg = predictedDemand / 30;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;
        return {
            product, pred, predictedDemand, stock, dailyAvg, daysUntilStockout,
            trend: pred ? pred.trend : null,
            momentum: pred ? pred.trend_momentum : null,
            confidence: pred ? pred.confidence_score : null,
            atRisk: daysUntilStockout <= 14,
            highDemand: predictedDemand > 0 && predictedDemand >= q75,
            lowDemand: predictedDemand <= q25
        };
    });

    currentSegments = {
        fast: analyzed.filter(a => a.highDemand).sort((a, b) => b.predictedDemand - a.predictedDemand),
        risk: analyzed.filter(a => a.atRisk).sort((a, b) => a.daysUntilStockout - b.daysUntilStockout),
        slow: analyzed.filter(a => a.lowDemand && !a.highDemand).sort((a, b) => a.predictedDemand - b.predictedDemand),
        steady: analyzed.filter(a => !a.highDemand && !a.lowDemand && !a.atRisk).sort((a, b) => b.predictedDemand - a.predictedDemand)
    };

    document.getElementById('fastMoversCount').textContent = currentSegments.fast.length;
    document.getElementById('slowMoversCount').textContent = currentSegments.slow.length;
    document.getElementById('atRiskCount').textContent = currentSegments.risk.length;
    document.getElementById('steadyCount').textContent = currentSegments.steady.length;

    renderAnalyticsKpis(analyzed);
    showSegment('fast');
    renderNeedsAttentionList(currentSegments.risk, currentSegments.slow);
}

function renderNeedsAttentionList(atRisk, slowMovers) {
    const container = document.getElementById('needsAttentionList');
    if (!container) return;
    const combined = [
        ...atRisk.map(a => ({ ...a, attentionReason: 'stockout' })),
        ...slowMovers.filter(s => !atRisk.find(a => a.product.id === s.product.id)).map(s => ({ ...s, attentionReason: 'declining' }))
    ].sort((a, b) => {
        if (a.attentionReason === 'stockout' && b.attentionReason !== 'stockout') return -1;
        if (a.attentionReason !== 'stockout' && b.attentionReason === 'stockout') return 1;
        return a.daysUntilStockout - b.daysUntilStockout;
    });
    if (combined.length === 0) {
        container.innerHTML = '<div class="perf-placeholder">All products are in good shape</div>';
        return;
    }
    container.innerHTML = combined.slice(0, 8).map((item, i) => `
        <div class="perf-item">
            <div class="perf-item-rank rank-risk">#${i + 1}</div>
            <div class="perf-item-info">
                <div class="perf-item-name">${escHtml(item.product.name)}</div>
                <div class="perf-item-detail">Stock: ${formatNumber(item.stock)} · ${formatDecimal(item.dailyAvg, 1)}/day avg</div>
            </div>
            <div class="perf-item-stats">
                <div class="perf-stat-value">${formatNumber(item.predictedDemand)}</div>
                <div class="perf-stat-label">demand</div>
            </div>
            <div class="perf-item-badge ${item.attentionReason === 'stockout' ? 'perf-badge-risk' : 'perf-badge-slow'}">${item.attentionReason === 'stockout' ? `<span class="material-symbols-outlined" style="font-size:14px;">warning_amber</span> ${item.daysUntilStockout}d` : '<span class="material-symbols-outlined" style="font-size:14px;">speed</span> Slow'}</div>
        </div>
    `).join('');
}

function renderAnalyticsKpis(analyzed) {
    const meta = predictionsMeta || {};
    const setKpi = (id, val, title) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = val;
        if (title) el.title = title;
    };
    setKpi('kpiForecastUnits', meta.total_predicted_units != null ? formatNumber(meta.total_predicted_units) + ' units' : '--');
    setKpi('kpiForecastRevenue', meta.total_predicted_revenue != null ? formatCompactCurrency(meta.total_predicted_revenue) : '--',
        meta.total_predicted_revenue != null ? formatCurrency(meta.total_predicted_revenue) : '');
    setKpi('kpiAccuracy', meta.overall_accuracy != null ? formatDecimal(meta.overall_accuracy, 1) + '%' : 'n/a',
        meta.overall_accuracy != null ? 'Validated on ' + (meta.backtested_products || 0) + ' products with enough history' : 'Needs 3+ weeks of history to validate');
    const risky = analyzed.filter(a => a.daysUntilStockout <= 30 && a.predictedDemand > 0).length;
    setKpi('kpiAtRisk', risky + ' product' + (risky === 1 ? '' : 's'));
    if (window.fetchMotion) {
        fetchMotion.stagger('#analyticsKpis .stat-card, .perf-card', 50);
        fetchMotion.countUpAll('#analyticsKpis .stat-value');
        fetchMotion.countUpAll('.perf-card .perf-value');
    }
}

const SEGMENT_META = {
    fast: { title: 'Top Fast Movers', sub: 'Highest predicted demand — keep these shelves full', icon: 'emoji_events', color: 'var(--accent)' },
    slow: { title: 'Slow Movers', sub: 'Below-average demand — avoid over-ordering, consider promos', icon: 'hourglass_bottom', color: 'var(--warning)' },
    risk: { title: 'Stockout Risk', sub: 'Projected to run out within 14 days at forecast demand', icon: 'warning', color: 'var(--danger)' },
    steady: { title: 'Steady Sellers', sub: 'Stable demand with healthy cover — the backbone of revenue', icon: 'check_circle', color: 'var(--success)' }
};

function showSegment(name) {
    if (!currentSegments) return;
    const meta = SEGMENT_META[name] || SEGMENT_META.fast;
    const items = currentSegments[name] || [];
    const titleEl = document.getElementById('spotlightTitle');
    const subEl = document.getElementById('spotlightSub');
    if (titleEl) titleEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;color:${meta.color};">${meta.icon}</span> ${meta.title} (${items.length})`;
    if (subEl) subEl.textContent = meta.sub;
    document.querySelectorAll('.perf-card.perf-clickable').forEach(c => c.classList.remove('perf-active'));
    document.querySelector(`.perf-card[onclick*="${name}"]`)?.classList.add('perf-active');

    const container = document.getElementById('spotlightList');
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = '<div class="perf-placeholder">No products in this segment right now</div>';
        return;
    }
    const badge = {
        fast: (it) => '<div class="perf-item-badge perf-badge-fast"><span class="material-symbols-outlined" style="font-size:14px;">rocket_launch</span> Fast</div>',
        slow: () => '<div class="perf-item-badge perf-badge-slow"><span class="material-symbols-outlined" style="font-size:14px;">speed</span> Slow</div>',
        risk: (it) => `<div class="perf-item-badge perf-badge-risk"><span class="material-symbols-outlined" style="font-size:14px;">warning_amber</span> ${it.daysUntilStockout}d</div>`,
        steady: () => '<div class="perf-item-badge perf-badge-steady"><span class="material-symbols-outlined" style="font-size:14px;">check</span> Stable</div>'
    }[name];
    container.innerHTML = items.slice(0, 8).map((item, i) => {
        const cover = item.daysUntilStockout >= 999 ? 'No demand' : `${item.daysUntilStockout}d of cover`;
        const conf = item.confidence != null ? ` · ${item.confidence}% conf.` : '';
        return `
        <div class="perf-item">
            <div class="perf-item-rank${name === 'risk' ? ' rank-risk' : ''}">#${i + 1}</div>
            <div class="perf-item-info">
                <div class="perf-item-name">${escHtml(item.product.name)}</div>
                <div class="perf-item-detail">Stock: ${formatNumber(item.stock)} · ${formatDecimal(item.dailyAvg, 1)}/day · ${cover}${conf}</div>
            </div>
            <div class="perf-item-stats">
                <div class="perf-stat-value">${formatNumber(item.predictedDemand)}</div>
                <div class="perf-stat-label">next mo.</div>
            </div>
            ${badge(item)}
        </div>`;
    }).join('');
}

function mergeAndRenderTable() {
    const tbody = document.getElementById('predictionsTableBody');
    if (!tbody) return;

    if (allProducts.length === 0 || allPredictions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading predictions...</td></tr>';
        return;
    }

    const rows = allProducts.map(product => {
        const pred = allPredictions.find(p => p.product_id === product.id);
        const predictedDemand = pred ? (pred.next_month_prediction || 0) : 0;
        const trend = pred ? (pred.trend || 'stable') : 'stable';
        const momentum = pred ? parseFloat(pred.trend_momentum) : null;
        const confidence = pred ? (pred.confidence_score || 0) : null;
        const stock = product.stock_quantity || 0;
        const dailyAvg = predictedDemand / 30;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;
        const reorderRecommended = daysUntilStockout <= 30;
        return { product, predictedDemand, trend, momentum, confidence, stock, dailyAvg, daysUntilStockout, reorderRecommended };
    });

    rows.sort((a, b) => {
        const aRisk = a.daysUntilStockout <= 30 ? 0 : 1;
        const bRisk = b.daysUntilStockout <= 30 ? 0 : 1;
        if (aRisk !== bRisk) return aRisk - bRisk;
        return a.daysUntilStockout - b.daysUntilStockout;
    });

    const limited = rows.slice(0, predDisplayCount);
    tbody.innerHTML = limited.map(r => {
        const stockoutDisplay = r.daysUntilStockout >= 999 ? '—' : r.daysUntilStockout + 'd';
        const trendIcon = r.trend === 'up' ? 'trending_up' : r.trend === 'down' ? 'trending_down' : 'trending_flat';
        const trendColor = r.trend === 'up' ? 'var(--success)' : r.trend === 'down' ? 'var(--danger)' : 'var(--text-muted)';
        const trendLabel = r.trend === 'up' ? 'Rising' : r.trend === 'down' ? 'Falling' : 'Stable';
        const momentumChip = (r.momentum != null && isFinite(r.momentum) && r.momentum !== 0)
            ? ` <span style="font-size:11px;color:${r.momentum > 0 ? 'var(--success)' : 'var(--danger)'};font-weight:700;">${r.momentum > 0 ? '+' : ''}${formatDecimal(r.momentum, 1)}%</span>`
            : '';
        const confCell = r.confidence != null
            ? `<div style="display:flex;align-items:center;gap:8px;min-width:110px;">
                   <div style="flex:1;height:5px;border-radius:3px;background:var(--gray-100,#eee);overflow:hidden;"><div style="height:100%;width:${r.confidence}%;border-radius:3px;background:${r.confidence >= 70 ? 'var(--success)' : r.confidence >= 45 ? 'var(--warning)' : 'var(--danger)'};"></div></div>
                   <span style="font-size:12px;font-weight:700;color:var(--text-secondary);">${r.confidence}%</span>
               </div>`
            : '—';
        return `
            <tr>
                <td><strong>${escHtml(r.product.name)}</strong></td>
                <td>${formatNumber(r.stock)}</td>
                <td>${r.predictedDemand > 0 ? formatDecimal(r.predictedDemand, 1) : '—'}</td>
                <td>${r.dailyAvg > 0 ? formatDecimal(r.dailyAvg, 1) : '—'}</td>
                <td${r.daysUntilStockout <= 14 ? ' style="color:var(--danger);font-weight:700;"' : ''}>${stockoutDisplay}</td>
                <td><span style="color:${trendColor};display:inline-flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:16px;">${trendIcon}</span> ${trendLabel}</span>${momentumChip}</td>
                <td>${confCell}</td>
                <td>
                    ${r.reorderRecommended
                        ? '<span class="reorder-badge yes">Yes</span>'
                        : '<span class="reorder-badge no">No</span>'
                    }
                </td>
            </tr>
        `;
    }).join('');

    updatePagination('predictionsPagination', rows, predDisplayCount, 'showMorePredictions');
}

function showMorePredictions() {
    predDisplayCount += PRED_PAGE_SIZE;
    mergeAndRenderTable();
}

function renderSeasonalChart(seasonalTrends) {
    const canvas = document.getElementById('seasonalTrendsChart');
    if (!canvas) return;
    if (!Array.isArray(seasonalTrends) || seasonalTrends.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (seasonalChart) seasonalChart.destroy();
    const labels = seasonalTrends.map(s => s.month_name || s.month || '');
    const values = seasonalTrends.map(s => parseFloat(s.avg_quantity || s.avg_sales || 0));
    const colors = ['#6FB3DF', '#7FC98F', '#F0B95A', '#E8746C', '#B78FD6', '#F49AC1', '#66C2B5', '#F5A25F', '#7FA8E8', '#A8CE6A', '#6EC6DC', '#D48AE0'];
    seasonalChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Avg Daily Sales',
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Units Sold' } } }
        }
    });
}

function renderDowChart(patterns) {
    const canvas = document.getElementById('dowTrendsChart');
    if (!canvas) return;
    if (!Array.isArray(patterns) || patterns.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (dowChart) dowChart.destroy();
    const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const sorted = [...patterns].sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day));
    const labels = sorted.map(p => p.day || '');
    const values = sorted.map(p => parseFloat(p.avg_daily_sales || 0));
    const maxVal = Math.max(...values);
    dowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Avg Daily Sales',
                data: values,
                backgroundColor: values.map(v => v === maxVal ? '#6FB3DF' : 'rgba(111, 179, 223, 0.45)'),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Units Sold' } } }
        }
    });
}

function refreshAnalytics() {
    predDisplayCount = PRED_PAGE_SIZE;
    const sel = document.getElementById('productSelector');
    if (sel && sel.value) loadProductPrediction(sel.value);
    loadAllPredictions();
    showToast('Analytics refreshed!', 'success');
}

// showToast comes from auth.js — one toast design everywhere
