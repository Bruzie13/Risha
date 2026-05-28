const PRED_API = `${API_BASE}/predictions`;
let forecastChart = null;
let seasonalChart = null;
let allProducts = [];
let allPredictions = [];

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await loadProductList();
    await loadAllPredictions();
});

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
    if (sel && sel.value) {
        metricsGrid.style.display = 'grid';
        chartsSection.style.display = 'grid';
        loadProductPrediction(sel.value);
    } else {
        metricsGrid.style.display = 'none';
        chartsSection.style.display = 'none';
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
            showToast('Prediction request timed out. ML service may still be loading.', 'warning');
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
    document.getElementById('trendIndicator').textContent = '➡️ --';
    const tt = document.getElementById('trendText');
    if (tt) tt.textContent = 'Select a product with sufficient sales data';
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

    if (predicted.length > 0) {
        predicted.forEach(p => {
            labels.push(p.date || `Day ${p.day || ''}`);
            predValues.push(parseFloat(p.predicted_quantity || 0));
        });
    }

    while (histValues.length < labels.length) histValues.push(null);

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Historical Sales',
                    data: histValues,
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2
                },
                {
                    label: 'Predicted Sales',
                    data: predValues,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Units Sold' } } }
        }
    });
}

function renderPredictionMetrics(data) {
    const nextMonth = data.next_month_prediction;
    const confidence = data.confidence_score;
    const trend = data.trend || 'stable';
    const reorder = data.reorder_recommendation || {};

    document.getElementById('predictedSales').textContent = nextMonth != null ? nextMonth.toFixed(1) : '--';
    document.getElementById('confidenceScore').textContent = confidence != null ? confidence.toFixed(1) + '%' : '--';

    const reorderPoint = reorder.recommended_reorder_point;
    document.getElementById('reorderPoint').textContent = reorderPoint != null ? reorderPoint : '--';

    const trendEl = document.getElementById('trendIndicator');
    const trendTextEl = document.getElementById('trendText');
    if (trendEl) {
        const t = (trend || '').toLowerCase();
        if (t.includes('up')) {
            trendEl.textContent = '📈 Increasing';
            trendEl.style.color = '#10b981';
            if (trendTextEl) trendTextEl.textContent = 'Demand is rising — consider increasing stock';
        } else if (t.includes('down')) {
            trendEl.textContent = '📉 Decreasing';
            trendEl.style.color = '#ef4444';
            if (trendTextEl) trendTextEl.textContent = 'Demand is declining — avoid overstocking';
        } else {
            trendEl.textContent = '➡️ Stable';
            trendEl.style.color = '#f59e0b';
            if (trendTextEl) trendTextEl.textContent = 'Demand is steady — maintain current levels';
        }
    }

    if (reorder.days_until_stockout != null && reorder.days_until_stockout < 999) {
        if (trendTextEl) {
            trendTextEl.textContent += ` | Stockout in ~${reorder.days_until_stockout} days`;
        }
    }
}

async function loadAllPredictions() {
    const tableBody = document.getElementById('predictionsTableBody');
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="text-center">⏳ Loading predictions... (this may take 30-60 seconds on first load as ML models train)</td></tr>';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const allPromise = fetch(`${PRED_API}/all`, { headers: getAuthHeaders(), signal: controller.signal })
        .then(r => r.json())
        .then(d => { if (d.success) allPredictions = d.data.predictions || []; })
        .catch(e => { if (e.name !== 'AbortError') console.error('Error loading all predictions:', e); });

    const summaryPromise = fetch(`${PRED_API}/summary`, { headers: getAuthHeaders(), signal: controller.signal })
        .then(r => r.json())
        .then(d => { if (d.success) renderSeasonalChart(d.data.seasonal_trends || []); })
        .catch(e => { if (e.name !== 'AbortError') console.error('Error loading summary:', e); });

    await Promise.all([allPromise, summaryPromise]);
    clearTimeout(timeout);

    if (allPredictions.length === 0) {
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="text-center">⚠️ Prediction service is still initializing. Select a product below to get a forecast, or try again later.</td></tr>';
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

    const avgDemand = allPredictions.reduce((s, p) => s + (p.next_month_prediction || 0), 0) / allPredictions.length;

    const analyzed = allProducts.map(product => {
        const pred = allPredictions.find(p => p.product_id === product.id);
        const predictedDemand = pred ? (pred.next_month_prediction || 0) : 0;
        const stock = product.stock_quantity || 0;
        const dailyAvg = predictedDemand / 30;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;
        const highDemand = predictedDemand >= avgDemand * 1.1;
        const lowDemand = predictedDemand <= avgDemand * 0.7;
        const atRisk = daysUntilStockout <= 30;

        return { product, predictedDemand, stock, dailyAvg, daysUntilStockout, atRisk, highDemand, lowDemand };
    });

    const fastMovers = analyzed.filter(a => a.highDemand).sort((a, b) => b.predictedDemand - a.predictedDemand);
    const atRiskProducts = analyzed.filter(a => a.atRisk).sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
    const slowMovers = analyzed.filter(a => a.lowDemand && !a.atRisk).sort((a, b) => a.predictedDemand - b.predictedDemand);
    const steady = analyzed.filter(a => !a.highDemand && !a.lowDemand && !a.atRisk).sort((a, b) => b.predictedDemand - a.predictedDemand);

    document.getElementById('fastMoversCount').textContent = fastMovers.length;
    document.getElementById('slowMoversCount').textContent = slowMovers.length;
    document.getElementById('atRiskCount').textContent = atRiskProducts.length;
    document.getElementById('steadyCount').textContent = steady.length;

    renderFastMoversList(fastMovers);
    renderNeedsAttentionList(atRiskProducts, slowMovers);
}

function renderFastMoversList(items) {
    const container = document.getElementById('fastMoversList');
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = '<div class="perf-placeholder">No fast-moving products detected</div>';
        return;
    }
    container.innerHTML = items.slice(0, 8).map((item, i) => `
        <div class="perf-item">
            <div class="perf-item-rank">#${i + 1}</div>
            <div class="perf-item-info">
                <div class="perf-item-name">${item.product.name}</div>
                <div class="perf-item-detail">Stock: ${item.stock} | ${item.dailyAvg.toFixed(1)}/day avg</div>
            </div>
            <div class="perf-item-stats">
                <div class="perf-stat-value">${item.predictedDemand.toFixed(0)}</div>
                <div class="perf-stat-label">next mo.</div>
            </div>
            <div class="perf-item-badge perf-badge-fast">🚀 Fast</div>
        </div>
    `).join('');
}

function renderNeedsAttentionList(atRisk, slowMovers) {
    const container = document.getElementById('needsAttentionList');
    if (!container) return;

    const combined = [
        ...atRisk.map(a => ({ ...a, attentionReason: 'stockout', label: `Stockout in ${a.daysUntilStockout}d` })),
        ...slowMovers.filter(s => !atRisk.find(a => a.product.id === s.product.id)).map(s => ({ ...s, attentionReason: 'declining', label: 'Demand declining' }))
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
                <div class="perf-item-name">${item.product.name}</div>
                <div class="perf-item-detail">Stock: ${item.stock} | ${item.dailyAvg.toFixed(1)}/day avg</div>
            </div>
            <div class="perf-item-stats">
                <div class="perf-stat-value">${item.predictedDemand.toFixed(0)}</div>
                <div class="perf-stat-label">demand</div>
            </div>
            <div class="perf-item-badge ${item.attentionReason === 'stockout' ? 'perf-badge-risk' : 'perf-badge-slow'}">${item.attentionReason === 'stockout' ? `⚠️ ${item.daysUntilStockout}d` : '🐢 Slow'}</div>
        </div>
    `).join('');
}

function mergeAndRenderTable() {
    const tbody = document.getElementById('predictionsTableBody');
    if (!tbody) return;

    if (allProducts.length === 0 || allPredictions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading predictions...</td></tr>';
        return;
    }

    const rows = allProducts.map(product => {
        const pred = allPredictions.find(p => p.product_id === product.id);
        const predictedDemand = pred ? (pred.next_month_prediction || 0) : 0;
        const trend = pred ? (pred.trend || 'stable') : 'stable';
        const stock = product.stock_quantity || 0;
        const dailyAvg = predictedDemand / 30;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;
        const reorderRecommended = daysUntilStockout <= 30;

        return { product, predictedDemand, trend, stock, dailyAvg, daysUntilStockout, reorderRecommended };
    });

    rows.sort((a, b) => {
        const aRisk = a.daysUntilStockout <= 30 ? 0 : 1;
        const bRisk = b.daysUntilStockout <= 30 ? 0 : 1;
        if (aRisk !== bRisk) return aRisk - bRisk;
        return a.daysUntilStockout - b.daysUntilStockout;
    });

    tbody.innerHTML = rows.map(r => {
        const stockoutDisplay = r.daysUntilStockout >= 999 ? 'N/A' : r.daysUntilStockout;
        const trendIcon = r.trend === 'up' ? '📈' : r.trend === 'down' ? '📉' : '➡️';
        return `
            <tr>
                <td><strong>${r.product.name}</strong></td>
                <td>${r.stock}</td>
                <td>${r.predictedDemand > 0 ? r.predictedDemand.toFixed(1) : 'N/A'}</td>
                <td>${r.dailyAvg > 0 ? r.dailyAvg.toFixed(1) : 'N/A'}</td>
                <td>${stockoutDisplay}</td>
                <td>${trendIcon} ${r.trend.charAt(0).toUpperCase() + r.trend.slice(1)}</td>
                <td>
                    ${r.reorderRecommended
                        ? '<span class="reorder-badge yes">Yes</span>'
                        : '<span class="reorder-badge no">No</span>'
                    }
                </td>
            </tr>
        `;
    }).join('');
}

function renderSeasonalChart(seasonalTrends) {
    const canvas = document.getElementById('seasonalTrendsChart');
    if (!canvas) return;
    if (!Array.isArray(seasonalTrends) || seasonalTrends.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (seasonalChart) seasonalChart.destroy();
    const labels = seasonalTrends.map(s => s.month_name || s.month || '');
    const values = seasonalTrends.map(s => parseFloat(s.avg_quantity || s.avg_sales || 0));
    const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#d946ef'];
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

function refreshAnalytics() {
    const sel = document.getElementById('productSelector');
    if (sel && sel.value) loadProductPrediction(sel.value);
    loadAllPredictions();
    showToast('Analytics refreshed!', 'success');
}

function showToast(message, type) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-weight:500;z-index:9999;transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#3b82f6';
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}
