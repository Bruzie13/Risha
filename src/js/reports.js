/* Reports → Sales tab, and the tab switching for the whole page.
   Stock planning lives in analytics.js, the activity log in audit.js. */

let salesChart = null;
let currentReportData = null;
let currentRange = '30';        // '7' | '30' | 'month' | 'all' | 'custom'
let currentGroup = 'daily';     // 'daily' | 'weekly' | 'monthly'
let currentTab = 'sales';
let firstSalesLoad = true;
const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;

const GROUP_WORD = { daily: 'day', weekly: 'week', monthly: 'month' };
const GROUP_HEAD = { daily: 'Date', weekly: 'Week', monthly: 'Month' };

window.addEventListener('load', () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    // the activity log API is admin-only — hide its tab from everyone else
    if (getUserRole() !== 'admin') document.querySelector('.report-tab[data-tab="audit"]')?.remove();
    setupTabs();
    setupSalesControls();
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    const wanted = tabParam && document.querySelector(`.report-tab[data-tab="${CSS.escape(tabParam)}"]`);
    if (wanted) wanted.click();
    else loadSales();
});

/* ---------- Tabs ---------- */

function setupTabs() {
    document.querySelectorAll('.report-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.report-tab').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            currentTab = btn.dataset.tab || 'sales';
            document.querySelectorAll('.tab-content').forEach(t => {
                t.classList.remove('active');
                t.style.display = 'none';
            });
            const tabEl = document.getElementById(`tab-${currentTab}`);
            if (tabEl) {
                tabEl.classList.add('active');
                tabEl.style.removeProperty('display');
            }
            if (currentTab === 'analytics') {
                if (typeof loadStockPlanning === 'function') loadStockPlanning();
            } else if (currentTab === 'audit') {
                if (typeof loadAuditLogs === 'function') loadAuditLogs();
            } else if (!currentReportData) {
                loadSales();
            }
        });
    });
}

/* ---------- Dates ----------
   All dates are the shop's calendar days. They are built from local date
   parts: toISOString() converts to UTC first and hands back yesterday for
   anyone working before 8am Philippine time. */

function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function niceDate(d, withYear) {
    return d.toLocaleDateString('en-US', withYear === false
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The { from, to } the current period buttons stand for; nulls mean all time. */
function rangeDates() {
    const today = new Date();
    if (currentRange === 'all') return { from: null, to: null };
    if (currentRange === 'custom') {
        return { from: document.getElementById('startDate').value || null, to: document.getElementById('endDate').value || null };
    }
    const from = new Date(today);
    if (currentRange === 'month') from.setDate(1);
    else from.setDate(from.getDate() - (Number(currentRange) - 1));
    return { from: ymd(from), to: ymd(today) };
}

/* ---------- Controls ---------- */

function setSeg(id, attr, value) {
    document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset[attr] === value));
}

function setupSalesControls() {
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);
    document.getElementById('endDate').value = ymd(today);
    document.getElementById('startDate').value = ymd(monthAgo);

    document.querySelectorAll('#rangeSeg button').forEach(b => b.addEventListener('click', () => {
        currentRange = b.dataset.range;
        setSeg('rangeSeg', 'range', currentRange);
        document.getElementById('customRange').hidden = currentRange !== 'custom';
        if (currentRange !== 'custom') loadSales();
    }));
    document.querySelectorAll('#groupSeg button').forEach(b => b.addEventListener('click', () => {
        currentGroup = b.dataset.group;
        setSeg('groupSeg', 'group', currentGroup);
        loadSales();
    }));
}

function applyDateRange() {
    const from = document.getElementById('startDate').value;
    const to = document.getElementById('endDate').value;
    if (!from || !to) { showToast('Choose both a start and an end date', 'warning'); return; }
    if (from > to) { showToast('The start date is after the end date', 'warning'); return; }
    loadSales();
}

/* ---------- Loading ---------- */

async function loadSales() {
    const { from, to } = rangeDates();
    displayCount = PAGE_SIZE;
    try {
        const params = new URLSearchParams({ period: currentGroup });
        if (from && to) { params.set('date_from', from); params.set('date_to', to); }
        const response = await fetch(`${API_BASE}/sales/report?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Report failed');

        const empty = !Number(data.data.summary?.total_transactions);
        // First visit only: an empty default period tells the owner nothing,
        // so fall back to everything on record and say that is what happened.
        if (empty && firstSalesLoad && currentRange === '30') {
            firstSalesLoad = false;
            currentRange = 'all';
            setSeg('rangeSeg', 'range', 'all');
            await loadSales();
            showNotice('salesNotice', 'No sales were recorded in the last 30 days, so this shows all sales on record.');
            return;
        }
        firstSalesLoad = false;
        currentReportData = data.data;
        renderCaption(from, to);
        showNotice('salesNotice', empty ? 'No sales were recorded in this period.' : '');
        renderSummary(data.data.summary || {});
        renderSalesTable();
        renderSalesChart(data.data.rows || []);
        renderBars('topProductsList', (data.data.top_products || []).map(p => ({
            label: p.name, value: Number(p.quantity) || 0, text: formatQty(p.quantity) + ' sold'
        })));
        renderBars('categoryList', (data.data.summary?.category_breakdown || []).map(c => ({
            label: c.category_name || 'Uncategorised', value: Number(c.total_revenue) || 0, text: formatCurrency(c.total_revenue)
        })));
        renderPaymentNote(data.data.summary?.payment_breakdown || []);
    } catch (error) {
        console.error('Error loading report:', error);
        showToast('Could not load the sales report', 'error');
    }
}

function showNotice(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
}

function renderCaption(from, to) {
    const el = document.getElementById('rangeCaption');
    const a = parseYmd(from), b = parseYmd(to);
    el.textContent = a && b
        ? (from === to ? niceDate(a) : `${niceDate(a, a.getFullYear() !== b.getFullYear())} – ${niceDate(b)}`)
        : 'All sales on record';
    const word = GROUP_WORD[currentGroup];
    document.getElementById('salesChartTitle').textContent = `Revenue by ${word}`;
    document.getElementById('salesTableTitle').textContent = `Breakdown by ${word}`;
    document.getElementById('salesTablePeriodHead').textContent = GROUP_HEAD[currentGroup];
}

function renderSummary(summary) {
    document.getElementById('summaryRevenue').textContent = formatCurrency(summary.total_revenue || 0);
    document.getElementById('summaryTransactions').textContent = formatNumber(summary.total_transactions || 0);
    document.getElementById('summaryAvg').textContent = formatCurrency(summary.avg_transaction_value || 0);
    document.getElementById('summaryItems').textContent = formatQty(summary.total_items_sold || 0);
}

/* ---------- Rows ---------- */

/** One readable label per row, whatever the grouping. */
function periodLabel(r) {
    if (currentGroup === 'daily') {
        const d = parseYmd(r.date);
        return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    }
    if (currentGroup === 'weekly') {
        // Weeks run Sunday to Saturday, matching how the report groups them.
        const first = parseYmd(r.first_day);
        if (!first) return r.week || '—';
        const start = new Date(first);
        start.setDate(start.getDate() - start.getDay());
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return `${niceDate(start, start.getFullYear() !== end.getFullYear())} – ${niceDate(end)}`;
    }
    const d = parseYmd((r.month || '') + '-01');
    return d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : (r.month_name || '—');
}

function shortLabel(r) {
    if (currentGroup === 'daily') { const d = parseYmd(r.date); return d ? niceDate(d, false) : ''; }
    if (currentGroup === 'weekly') {
        const first = parseYmd(r.first_day);
        if (!first) return r.week || '';
        first.setDate(first.getDate() - first.getDay());
        return niceDate(first, false);
    }
    const d = parseYmd((r.month || '') + '-01');
    return d ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '';
}

const rowSales = r => Number(r.total_sales ?? r.total_transactions) || 0;
const rowRevenue = r => Number(r.total_amount) || 0;
const rowItems = r => Number(r.item_count) || 0;

function renderSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    const rows = currentReportData?.rows || [];
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="rp-loading">No sales in this period.</td></tr>';
        document.getElementById('salesPagination').innerHTML = '';
        return;
    }
    tbody.innerHTML = rows.slice(0, displayCount).map(r => `
        <tr>
            <td>${escHtml(periodLabel(r))}</td>
            <td class="num">${formatNumber(rowSales(r))}</td>
            <td class="num">${formatQty(rowItems(r))}</td>
            <td class="num rp-strong">${formatCurrency(rowRevenue(r))}</td>
        </tr>`).join('');
    updatePagination('salesPagination', rows, displayCount, 'showMoreReport', 'showLessReport', PAGE_SIZE);
}

function showMoreReport() { displayCount += PAGE_SIZE; renderSalesTable(); }
function showLessReport() { displayCount = PAGE_SIZE; renderSalesTable(); }

/* ---------- Charts ---------- */

/** Chart colours come from the theme so light and dark mode both read well. */
function chartTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return {
        bar: v('--chart-1', '#2F5DA8'),
        barSoft: v('--chart-1-soft', '#B9C8E3'),
        text: v('--text-muted', '#6B7280'),
        grid: v('--border-subtle', '#EEF0F2'),
        font: v('--font-sans', 'Inter, sans-serif')
    };
}

function baseChartOptions(t) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.text, font: { family: t.font, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
            y: { beginAtZero: true, border: { display: false }, grid: { color: t.grid }, ticks: { color: t.text, font: { family: t.font, size: 11 }, maxTicksLimit: 5 } }
        }
    };
}

function renderSalesChart(rows) {
    const canvas = document.getElementById('salesChart');
    const empty = document.getElementById('salesChartEmpty');
    if (salesChart) { salesChart.destroy(); salesChart = null; }
    const has = Array.isArray(rows) && rows.length > 0;
    canvas.parentElement.hidden = !has;
    empty.hidden = has;
    if (!has || typeof Chart === 'undefined') return;

    // the API returns newest first; a time axis reads left to right
    const ordered = [...rows].reverse();
    const t = chartTheme();
    const options = baseChartOptions(t);
    options.scales.y.ticks.callback = v => formatCompactCurrency(v);
    options.plugins.tooltip = {
        displayColors: false,
        callbacks: {
            title: items => periodLabel(ordered[items[0].dataIndex]),
            label: item => {
                const r = ordered[item.dataIndex];
                return [formatCurrency(rowRevenue(r)), `${formatNumber(rowSales(r))} sales · ${formatQty(rowItems(r))} items`];
            }
        }
    };
    salesChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ordered.map(shortLabel),
            datasets: [{ data: ordered.map(rowRevenue), backgroundColor: t.bar, borderRadius: 2, maxBarThickness: 36 }]
        },
        options
    });
}

/** Ranked list with a proportional bar — easier to read than a doughnut. */
function renderBars(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!items.length) { el.innerHTML = '<p class="rp-empty">Nothing to show for this period.</p>'; return; }
    const max = Math.max(...items.map(i => i.value), 1);
    el.innerHTML = items.map(i => `
        <div class="rp-bar-row">
            <div class="rp-bar-top"><span class="rp-bar-label">${escHtml(i.label)}</span><span class="rp-bar-value">${escHtml(i.text)}</span></div>
            <div class="rp-bar-track"><div class="rp-bar-fill" style="width:${Math.max(2, Math.round(i.value / max * 100))}%"></div></div>
        </div>`).join('');
}

function renderPaymentNote(payments) {
    const el = document.getElementById('paymentNote');
    if (!el) return;
    const named = payments.filter(p => Number(p.total) > 0);
    if (!named.length) { el.textContent = ''; return; }
    const cap = s => String(s || 'other').charAt(0).toUpperCase() + String(s || 'other').slice(1);
    el.textContent = named.length === 1
        ? `All sales in this period were paid in ${String(named[0].payment_method || 'cash').toLowerCase()}.`
        : 'Paid by: ' + named.map(p => `${cap(p.payment_method)} ${formatCurrency(p.total)}`).join(' · ');
}

/* ---------- Export ---------- */

/** One CSV cell: quoted, and never able to run as a spreadsheet formula. */
function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCSV(filename, lines) {
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function exportCSV() {
    const rows = currentReportData?.rows || [];
    if (!rows.length) { showToast('There is nothing to export for this period', 'warning'); return; }
    const lines = [[GROUP_HEAD[currentGroup], 'Sales made', 'Items sold', 'Revenue'].map(csvCell).join(',')];
    rows.forEach(r => lines.push([periodLabel(r), rowSales(r), rowItems(r), rowRevenue(r).toFixed(2)].map(csvCell).join(',')));
    const s = currentReportData.summary;
    if (s) {
        lines.push('');
        lines.push(['Total', s.total_transactions ?? 0, Number(s.total_items_sold) || 0, Number(s.total_revenue || 0).toFixed(2)].map(csvCell).join(','));
    }
    downloadCSV(`sales_by_${GROUP_WORD[currentGroup]}_${ymd(new Date())}.csv`, lines);
    showToast('Sales report exported', 'success');
}

// showToast comes from auth.js — one toast design everywhere
