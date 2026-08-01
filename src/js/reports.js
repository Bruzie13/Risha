let salesChart = null;
let topProductsChart = null;
let paymentChart = null;
let categoryChart = null;
let currentReportData = null;
let currentPeriod = 'daily';
const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    // the audit API is admin-only — hide its tab from everyone else
    if (getUserRole() !== 'admin') document.querySelector('.report-tab[data-tab="audit"]')?.remove();
    setupTabs();
    setupDateRange();
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'analytics' || tabParam === 'audit') {
        const btn = document.querySelector(`.report-tab[data-tab="${tabParam}"]`);
        if (btn) btn.click();
    } else {
        await loadReport('daily');
    }
});

function setupTabs() {
    document.querySelectorAll('.report-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.report-tab').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            const period = btn.dataset.tab || 'daily';
            currentPeriod = period;
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            const tabEl = document.getElementById(`tab-${period}`);
            if (tabEl) {
                tabEl.classList.add('active');
                tabEl.style.removeProperty('display');
            }
            if (period === 'analytics') {
                if (typeof loadAllPredictions === 'function') {
                    if (typeof predDisplayCount !== 'undefined') predDisplayCount = 10;
                    loadProductList();
                    loadAllPredictions();
                }
            } else if (period === 'audit') {
                if (typeof loadAuditLogs === 'function') loadAuditLogs();
            } else {
                displayCount = PAGE_SIZE;
                const startDate = document.getElementById('startDate')?.value;
                const endDate = document.getElementById('endDate')?.value;
                if (startDate && endDate) {
                    loadReport(period, startDate, endDate);
                } else {
                    loadReport(period);
                }
            }
        });
    });
}

function setupDateRange() {
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    if (startDate && endDate) {
        const today = new Date();
        endDate.value = today.toISOString().split('T')[0];
        const thirtyAgo = new Date(today);
        thirtyAgo.setDate(thirtyAgo.getDate() - 30);
        startDate.value = thirtyAgo.toISOString().split('T')[0];
    }
}

function applyDateRange() {
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    if (startDate && endDate && currentPeriod !== 'analytics' && currentPeriod !== 'audit') {
        loadReport(currentPeriod, startDate, endDate);
    }
}

function resetDateRange() {
    const today = new Date();
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
    const thirtyAgo = new Date(today);
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    document.getElementById('startDate').value = thirtyAgo.toISOString().split('T')[0];
    currentPeriod = 'daily';
    displayCount = PAGE_SIZE;
    document.querySelectorAll('.report-tab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });
    document.querySelector('.report-tab[data-tab="daily"]')?.classList.add('active');
    document.querySelector('.report-tab[data-tab="daily"]')?.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.tab-content').forEach(t => {
        t.classList.remove('active');
        t.style.removeProperty('display');
    });
    document.getElementById('tab-daily')?.classList.add('active');
    loadReport('daily');
}

async function loadReport(period, dateFrom, dateTo) {
    try {
        let url = `${API_BASE}/sales/report?period=${period}`;
        if (dateFrom && dateTo) {
            url += `&date_from=${dateFrom}&date_to=${dateTo}`;
        }
        const response = await fetch(url, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            currentReportData = data.data;
            renderSummary(data.data.summary);
            renderReportTable(period, data.data);
            renderReportCharts(data.data);
        } else {
            showToast('Failed to load report', 'error');
        }
    } catch (error) {
        console.error('Error loading report:', error);
        showToast('Failed to load report', 'error');
    }
}

function renderSummary(summary) {
    if (!summary) return;
    document.getElementById('summaryRevenue').textContent = formatCurrency(summary.total_revenue || 0);
    document.getElementById('summaryTransactions').textContent = (Number(summary.total_transactions) || 0).toLocaleString();
    document.getElementById('summaryAvg').textContent = formatCurrency(summary.avg_transaction_value || 0);
    document.getElementById('summaryItems').textContent = (Number(summary.total_items_sold) || 0).toLocaleString();
}

function renderReportTable(period, data) {
    const tableBodyIds = {
        'daily': 'dailyTableBody',
        'weekly': 'weeklyTableBody',
        'monthly': 'monthlyTableBody'
    };
    const paginationIds = {
        'daily': 'dailyPagination',
        'weekly': 'weeklyPagination',
        'monthly': 'monthlyPagination'
    };
    const tbody = document.getElementById(tableBodyIds[period]);
    if (!tbody) return;

    const rows = data.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">No data for this period</td></tr>`;
        return;
    }

    const limited = rows.slice(0, displayCount);
    const paginationId = paginationIds[period];

    if (period === 'daily') {
        tbody.innerHTML = limited.map(r => `
            <tr>
                <td class="rt-label">${r.date ? new Date(r.date).toLocaleDateString() : 'N/A'}</td>
                <td class="rt-num">${r.total_sales ?? 0}</td>
                <td class="rt-amount">${formatCurrency(r.total_amount ?? 0)}</td>
                <td class="rt-num">${formatNumber(parseFloat(r.item_count ?? r.total_items) || 0)}</td>
            </tr>
        `).join('');
    } else if (period === 'weekly') {
        tbody.innerHTML = limited.map(r => `
            <tr>
                <td class="rt-label">${escHtml(r.week || 'N/A')}</td>
                <td class="rt-num">${escHtml(r.week_number || 'N/A')}</td>
                <td class="rt-amount">${formatCurrency(r.total_amount ?? 0)}</td>
                <td class="rt-num">${r.total_sales ?? 0}</td>
            </tr>
        `).join('');
    } else if (period === 'monthly') {
        tbody.innerHTML = limited.map(r => `
            <tr>
                <td class="rt-label">${escHtml(r.month_name || r.month || 'N/A')}</td>
                <td class="rt-num">${r.total_transactions ?? 0}</td>
                <td class="rt-amount">${formatCurrency(r.total_amount ?? 0)}</td>
                <td class="rt-num">${r.total_sales ?? '-'}</td>
            </tr>
        `).join('');
    }

    updatePagination(paginationId, rows, displayCount, 'showMoreReport', 'showLessReport', PAGE_SIZE);
}

function showMoreReport() {
    displayCount += PAGE_SIZE;
    const data = currentReportData;
    if (data) renderReportTable(currentPeriod, data);
}

function showLessReport() {
    displayCount = 0;
    showMoreReport();
}

function renderReportCharts(data) {
    renderSalesChart(data.rows || []);
    renderTopProductsChart(data.top_products || []);
    renderPaymentChart(data.summary?.payment_breakdown || []);
    renderCategoryChart(data.summary?.category_breakdown || []);
}

function renderSalesChart(rows) {
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;
    if (!Array.isArray(rows) || rows.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (salesChart) salesChart.destroy();
    // API returns rows newest-first; the time axis should read left → right
    rows = [...rows];
    const firstDate = new Date(rows[0]?.date);
    const lastDate = new Date(rows[rows.length - 1]?.date);
    if (!isNaN(firstDate) && !isNaN(lastDate)) {
        rows.sort((a, b) => new Date(a.date) - new Date(b.date));
    } else {
        rows.reverse();
    }
    const labels = rows.map(r => {
        const d = new Date(r.date);
        return isNaN(d.getTime()) ? (r.week || r.month || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const salesCount = rows.map(r => r.total_sales ?? r.total ?? r.transaction_count ?? 0);
    const revenue = rows.map(r => parseFloat(r.total_amount ?? r.amount ?? r.revenue ?? 0));
    salesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Sales Count', data: salesCount, backgroundColor: '#61B6E7', borderRadius: 5, yAxisID: 'y' },
                { label: 'Revenue (₱)', data: revenue, backgroundColor: '#F1867B', borderRadius: 5, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' } } },
            scales: {
                y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Sales Count' } },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Revenue (₱)' } }
            }
        }
    });
}

function renderTopProductsChart(products) {
    const canvas = document.getElementById('topProductsChart');
    if (!canvas) return;
    if (!Array.isArray(products) || products.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (topProductsChart) topProductsChart.destroy();
    const labels = products.map(p => p.name || p.label || '');
    const values = products.map(p => parseInt(p.quantity || p.count || 0));
    const colors = ['#61B6E7', '#F3B950', '#57BE8C', '#F1867B', '#9F86DC'];
    topProductsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Units Sold', data: values, backgroundColor: colors.slice(0, labels.length), borderRadius: 5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true } }
        }
    });
}

function renderPaymentChart(payments) {
    const canvas = document.getElementById('paymentChart');
    if (!canvas) return;
    if (!Array.isArray(payments) || payments.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (paymentChart) paymentChart.destroy();
    const labels = payments.map(p => (p.payment_method || 'unknown').charAt(0).toUpperCase() + (p.payment_method || 'unknown').slice(1));
    const values = payments.map(p => parseFloat(p.total || 0));
    const colors = ['#57BE8C', '#61B6E7', '#F3B950', '#F1867B'];
    paymentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 2, hoverOffset: 6 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)}`
                    }
                }
            }
        }
    });
}

function renderCategoryChart(categories) {
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;
    if (!Array.isArray(categories) || categories.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (categoryChart) categoryChart.destroy();
    const labels = categories.map(c => c.category_name || 'Unknown');
    const values = categories.map(c => parseFloat(c.total_revenue || 0));
    const colors = ['#61B6E7', '#57BE8C', '#F3B950', '#F1867B', '#9F86DC', '#E88BB5', '#6BC6BD', '#F5A25F'];
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 2, hoverOffset: 6 }]
        },
        options: {
            // maintainAspectRatio:false keeps the doughnut inside the fixed-height
            // .chart-wrapper — without it the canvas grows square and overflows the card
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)}`
                    }
                }
            }
        }
    });
}

function exportCSV() {
    if (!currentReportData) { showToast('No data to export', 'error'); return; }
    const rows = currentReportData.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) { showToast('No data to export', 'error'); return; }

    let headers, csvRows;
    if (currentPeriod === 'daily') {
        headers = ['Date', 'Transactions', 'Total Amount', 'Items Sold'];
        csvRows = [headers.join(',')];
        rows.forEach(r => {
            csvRows.push([
                r.date || '',
                r.total_sales ?? 0,
                r.total_amount ?? 0,
                r.item_count ?? ''
            ].join(','));
        });
    } else if (currentPeriod === 'weekly') {
        headers = ['Week', 'Week Number', 'Total Amount', 'Transactions'];
        csvRows = [headers.join(',')];
        rows.forEach(r => {
            csvRows.push([
                r.week || '',
                r.week_number || '',
                r.total_amount ?? 0,
                r.total_sales ?? 0
            ].join(','));
        });
    } else {
        headers = ['Month', 'Total Transactions', 'Total Amount', 'Transactions'];
        csvRows = [headers.join(',')];
        rows.forEach(r => {
            csvRows.push([
                r.month || r.month_name || '',
                r.total_transactions ?? 0,
                r.total_amount ?? 0,
                r.total_sales ?? ''
            ].join(','));
        });
    }

    if (currentReportData.summary) {
        csvRows.push('');
        csvRows.push('=== SUMMARY ===');
        csvRows.push(`Total Revenue,${currentReportData.summary.total_revenue ?? 0}`);
        csvRows.push(`Total Transactions,${currentReportData.summary.total_transactions ?? 0}`);
        csvRows.push(`Avg Per Transaction,${currentReportData.summary.avg_transaction_value ?? 0}`);
        csvRows.push(`Total Items Sold,${currentReportData.summary.total_items_sold ?? 0}`);
    }

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales_report_${currentPeriod}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showToast('CSV exported!', 'success');
}

function formatCurrency(val) {
    return '₱' + Number(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2});
}

// showToast comes from auth.js — one toast design everywhere
