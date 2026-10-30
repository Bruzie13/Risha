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
    // deciding on a void is for those who can void
    if (!canManage()) document.querySelector('.report-tab[data-tab="voids"]')?.remove();
    else loadVoidRequests(false);
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
            } else if (currentTab === 'voids') {
                loadVoidRequests(false);
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

/* The From and To boxes run from the first sale recorded in FETCH (when the
   shop started selling here) to today: there is nothing to report before the
   first sale, and nothing in the future. Sales are listed newest first, so the
   first sale is the last one in the list. */
let firstSaleDay = '';
async function setReportDateBounds() {
    try {
        const head = await (await fetch(`${API_BASE}/sales?limit=1`, { headers: getAuthHeaders() })).json();
        const total = Number(head.total) || 0;
        if (total > 0) {
            const last = await (await fetch(`${API_BASE}/sales?limit=1&offset=${total - 1}`, { headers: getAuthHeaders() })).json();
            const oldest = last.success && last.data && last.data[0];
            if (oldest && !isNaN(new Date(oldest.created_at))) firstSaleDay = ymd(new Date(oldest.created_at));
        }
    } catch (e) { /* the boxes still stop at today */ }
    const start = document.getElementById('startDate');
    ['startDate', 'endDate'].forEach(id => {
        const box = document.getElementById(id);
        box.max = localTodayYmd();
        if (firstSaleDay) box.min = firstSaleDay;
    });
    if (firstSaleDay && start.value < firstSaleDay) start.value = firstSaleDay;
}

function prettyYmd(day) {
    return new Date(day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* What is wrong with the dates chosen, or null. */
function reportDateProblem(from, to) {
    if (!from || !to) return 'Choose both a start and an end date.';
    const today = localTodayYmd();
    if (from > today || to > today) return 'Choose today or an earlier date: there are no sales in the future.';
    if (firstSaleDay && (from < firstSaleDay || to < firstSaleDay)) {
        return `The first sale in FETCH was on ${prettyYmd(firstSaleDay)}. Choose that day or later.`;
    }
    if (from > to) return 'The start date is after the end date.';
    return null;
}

function setupSalesControls() {
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);
    document.getElementById('endDate').value = ymd(today);
    document.getElementById('startDate').value = ymd(monthAgo);
    setReportDateBounds();
    // a day typed outside the range is put back to the nearest allowed day, with the
    // reason; on leaving the box, since while a year is typed it reads as 0002, 0020…
    ['startDate', 'endDate'].forEach(id => document.getElementById(id).addEventListener('blur', e => {
        const box = e.target, today = localTodayYmd();
        if (!box.value) return;
        if (box.value > today) {
            box.value = today;
            showToast('Choose today or an earlier date: there are no sales in the future.', 'error');
        } else if (firstSaleDay && box.value < firstSaleDay) {
            box.value = firstSaleDay;
            showToast(`The first sale in FETCH was on ${prettyYmd(firstSaleDay)}. Choose that day or later.`, 'error');
        }
    }));

    document.querySelectorAll('#rangeSeg button').forEach(b => b.addEventListener('click', () => {
        currentRange = b.dataset.range;
        setSeg('rangeSeg', 'range', currentRange);
        document.getElementById('reportRangeError').textContent = '';
        closeReportRange();
        loadSales();
    }));
    document.getElementById('reportRangeBtn').addEventListener('click', () => {
        const pop = document.getElementById('reportRangePop');
        if (pop.hidden) openReportRange(); else closeReportRange();
    });
    document.querySelectorAll('#groupSeg button').forEach(b => b.addEventListener('click', () => {
        currentGroup = b.dataset.group;
        setSeg('groupSeg', 'group', currentGroup);
        loadSales();
    }));
}

function applyDateRange() {
    const from = document.getElementById('startDate').value;
    const to = document.getElementById('endDate').value;
    const problem = reportDateProblem(from, to);
    const err = document.getElementById('reportRangeError');
    if (problem) { err.textContent = problem; return; }
    err.textContent = '';
    currentRange = 'custom';
    setSeg('rangeSeg', 'range', 'custom');
    closeReportRange();
    loadSales();
}

/* The Period field: it reads the period chosen ("Last 30 days", or the dates
   picked) and opens a panel with the quick picks and From/To. */
const RANGE_WORDS = { 7: 'Last 7 days', 30: 'Last 30 days', month: 'This month', all: 'All time' };
function showReportRange() {
    const el = document.getElementById('reportRangeText');
    if (!el) return;
    if (currentRange !== 'custom') { el.textContent = RANGE_WORDS[currentRange] || 'Last 30 days'; return; }
    const { from, to } = rangeDates();
    const short = day => new Date(day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    el.textContent = from === to ? prettyYmd(from)
        : `${from.slice(0, 4) === to.slice(0, 4) ? short(from) : prettyYmd(from)} – ${prettyYmd(to)}`;
}
function openReportRange() {
    document.getElementById('reportRangePop').hidden = false;
    document.getElementById('reportRangeBtn').setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', outsideReportRange), 0);
    document.addEventListener('keydown', escReportRange);
}
function closeReportRange() {
    const pop = document.getElementById('reportRangePop');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.getElementById('reportRangeBtn').setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outsideReportRange);
    document.removeEventListener('keydown', escReportRange);
}
function outsideReportRange(e) { if (!e.target.closest('#reportRange')) closeReportRange(); }
function escReportRange(e) { if (e.key === 'Escape') { closeReportRange(); document.getElementById('reportRangeBtn').focus(); } }

/* ---------- Loading ---------- */

async function loadSales() {
    showReportRange();
    const { from, to } = rangeDates();
    displayCount = PAGE_SIZE;
    try {
        const params = new URLSearchParams({ period: currentGroup });
        if (from && to) { params.set('date_from', from); params.set('date_to', to); }
        const response = await fetch(`${API_BASE}/sales/report?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        // a refusal with a reason (dates that cannot be read) is shown as given
        if (!data.success && response.status === 400 && data.message) { showToast(data.message, 'warning'); return; }
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
        const [before, daily] = await Promise.all([previousPeriod(from, to), dailyRows(from, to, data.data.rows)]);
        renderSummary(data.data.summary || {}, before);
        renderGaps(from, to, daily);
        renderSalesTable();
        renderSalesChart(data.data.rows || [], from, to);
        renderBars('topProductsList', (data.data.top_products || []).map(p => ({
            label: p.name, value: Number(p.quantity) || 0, text: formatQty(p.quantity) + ' sold'
        })));
        renderBars('categoryList', (data.data.summary?.category_breakdown || []).map(c => ({
            label: c.category_name || 'Uncategorised', value: Number(c.total_revenue) || 0, text: formatCurrency(c.total_revenue)
        })));
        renderCategoryTotals(data.data.summary || {});
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
        ? (from === to ? niceDate(a) : `${niceDate(a, a.getFullYear() !== b.getFullYear())} – ${niceDate(b)}`) + ', compared with the same number of days just before'
        : 'All sales on record';
    document.getElementById('overTimeSub').textContent = currentGroup === 'daily'
        ? 'revenue per day; every day of the period is shown' : `revenue per ${GROUP_WORD[currentGroup]}`;
    const word = GROUP_WORD[currentGroup];
    document.getElementById('salesChartTitle').textContent = `Revenue by ${word}`;
    document.getElementById('salesTableTitle').textContent = `Breakdown by ${word}`;
    document.getElementById('salesTablePeriodHead').textContent = GROUP_HEAD[currentGroup];
}

function renderSummary(summary, before) {
    const sales = Number(summary.total_transactions) || 0, items = Number(summary.total_items_sold) || 0;
    document.getElementById('summaryRevenue').textContent = formatCurrency(summary.total_revenue || 0);
    document.getElementById('summaryTransactions').textContent = `${formatNumber(sales)} sale${sales === 1 ? '' : 's'}`;
    document.getElementById('summaryAvg').textContent = formatCurrency(summary.avg_transaction_value || 0);
    document.getElementById('summaryItems').textContent = `${formatQty(items)} item${items === 1 ? '' : 's'}`;
    const p = before && before.summary;
    const span = before ? `vs ${prettySpan(before.from, before.to)}` : '';
    setDelta('deltaRevenue', summary.total_revenue, p && p.total_revenue, formatCurrency, span);
    setDelta('deltaTransactions', summary.total_transactions, p && p.total_transactions, formatNumber);
    setDelta('deltaAvg', summary.avg_transaction_value, p && p.avg_transaction_value, formatCurrency);
    setDelta('deltaItems', summary.total_items_sold, p && p.total_items_sold, formatQty);
}

/* "↓ 69% vs Sep 1 – Sep 30 (₱249,950.05)": how a figure compares with the
   same number of days just before. Red down, green up; nothing for All time. */
function setDelta(id, now, then, fmt, span) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'rp-delta';
    if (then == null) { el.textContent = ''; return; }
    const a = Number(now) || 0, b = Number(then) || 0;
    if (!b) { el.textContent = a ? `No sales in the days before${span ? ' (' + span.replace(/^vs /, '') + ')' : ''}` : ''; return; }
    const pct = Math.round((a - b) / b * 100);
    el.classList.add(pct > 0 ? 'up' : pct < 0 ? 'down' : 'same');
    el.textContent = `${pct > 0 ? '↑' : pct < 0 ? '↓' : '='} ${Math.abs(pct)}%${span ? ' ' + span : ''} (${fmt(b)})`;
}

// "Sep 1 – Sep 30" (the year only when it is not this year)
const prettySpan = (from, to) => {
    const a = parseYmd(from), b = parseYmd(to);
    const thisYear = b.getFullYear() === new Date().getFullYear();
    return from === to ? niceDate(a, !thisYear) : `${niceDate(a, a.getFullYear() !== b.getFullYear())} – ${niceDate(b, !thisYear)}`;
};
const shiftDay = (day, n) => { const d = parseYmd(day); d.setDate(d.getDate() + n); return ymd(d); };

/* The same number of days just before the period, for the comparisons. */
async function previousPeriod(from, to) {
    if (!from || !to) return null;
    const days = Math.round((parseYmd(to) - parseYmd(from)) / 86400000) + 1;
    const pTo = shiftDay(from, -1), pFrom = shiftDay(pTo, -(days - 1));
    try {
        const res = await fetch(`${API_BASE}/sales/report?period=daily&date_from=${pFrom}&date_to=${pTo}`, { headers: getAuthHeaders() });
        const data = await res.json();
        return data.success ? { from: pFrom, to: pTo, summary: data.data.summary || {} } : null;
    } catch (e) { return null; }
}

/* Sales per day for the period (the report's own rows when it is shown by day). */
async function dailyRows(from, to, rows) {
    if (currentGroup === 'daily') return rows || [];
    if (!from || !to) return [];
    try {
        const res = await fetch(`${API_BASE}/sales/report?period=daily&date_from=${from}&date_to=${to}`, { headers: getAuthHeaders() });
        const data = await res.json();
        return data.success ? data.data.rows || [] : [];
    } catch (e) { return []; }
}

/* Every day from `from` to `to`, oldest first, with the day's row or null. */
function everyDay(from, to, rows) {
    const byDay = new Map((rows || []).map(r => [String(r.date).slice(0, 10), r]));
    const out = [];
    for (let d = from; d <= to; d = shiftDay(d, 1)) out.push({ day: d, row: byDay.get(d) || null });
    return out;
}

/* Runs of days with no sales, as "Oct 11 – 25". Today is left out until it
   is over: a day still going is not a day without sales. */
function noSaleRuns(from, to, rows) {
    const today = ymd(new Date());
    const last = to >= today ? shiftDay(today, -1) : to;
    if (!from || !last || last < from) return { days: 0, runs: [] };
    const runs = []; let start = null, days = 0;
    everyDay(from, last, rows).forEach(({ day, row }, i, all) => {
        const none = !row || !rowSales(row);
        if (none) { days++; if (!start) start = day; }
        if (start && (!none || i === all.length - 1)) { runs.push([start, none ? day : shiftDay(day, -1)]); start = null; }
    });
    return { days, runs };
}

function renderGaps(from, to, daily) {
    const el = document.getElementById('summaryGaps');
    const { days, runs } = noSaleRuns(from, to, daily);
    if (!days) { el.textContent = ''; return; }
    const short = d => niceDate(parseYmd(d), false);
    const named = runs.slice(0, 3).map(([a, b]) => a === b ? short(a) : `${short(a)} – ${b.slice(0, 7) === a.slice(0, 7) ? parseYmd(b).getDate() : short(b)}`);
    el.textContent = `${formatNumber(days)} day${days === 1 ? '' : 's'} had no sales (${named.join(', ')}${runs.length > 3 ? ` and ${runs.length - 3} more` : ''})`;
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
function showLessReport() { displayCount = Math.max(PAGE_SIZE, displayCount - PAGE_SIZE); renderSalesTable(); }

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
        animation: { duration: 400, easing: 'easeOutQuart' },
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.text, font: { family: t.font, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
            y: { beginAtZero: true, border: { display: false }, grid: { color: t.grid }, ticks: { color: t.text, font: { family: t.font, size: 11 }, maxTicksLimit: 5 } }
        }
    };
}

/* Days with no sales, three or more in a row, drawn as a hatched band with
   its words, so a closed fortnight shows as one instead of disappearing. */
const noSalesBands = {
    id: 'noSalesBands',
    beforeDatasetsDraw(chart, args, opts) {
        const bands = opts && opts.bands;
        if (!bands || !bands.length) return;
        const { ctx, chartArea: area, scales: { x } } = chart;
        const step = x.getPixelForValue(1) - x.getPixelForValue(0);
        ctx.save();
        bands.forEach(([i, j]) => {
            const left = x.getPixelForValue(i) - step / 2, right = x.getPixelForValue(j) + step / 2;
            ctx.fillStyle = opts.fill;
            ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
            ctx.strokeStyle = opts.line; ctx.lineWidth = 1;
            for (let k = left - (area.bottom - area.top); k < right; k += 8) {
                ctx.beginPath();
                ctx.moveTo(Math.max(k, left), area.bottom - Math.max(0, left - k));
                ctx.lineTo(Math.min(k + (area.bottom - area.top), right), area.top + Math.max(0, k + (area.bottom - area.top) - right));
                ctx.stroke();
            }
            if (right - left > 90) {
                ctx.fillStyle = opts.text; ctx.textAlign = 'center';
                ctx.font = `600 12px ${opts.font}`;
                ctx.fillText('No sales recorded', (left + right) / 2, area.top + (area.bottom - area.top) * 0.4);
            }
        });
        ctx.restore();
    }
};

function renderSalesChart(rows, from, to) {
    const canvas = document.getElementById('salesChart');
    const empty = document.getElementById('salesChartEmpty');
    if (salesChart) { salesChart.destroy(); salesChart = null; }
    const has = Array.isArray(rows) && rows.length > 0;
    canvas.parentElement.hidden = !has;
    empty.hidden = has;
    if (!has || typeof Chart === 'undefined') return;

    // the API returns newest first; a time axis reads left to right. By day,
    // every day of the period has its place, sales or not.
    let ordered = [...rows].reverse();
    const bands = [];
    if (currentGroup === 'daily') {
        const first = from || String(ordered[0].date).slice(0, 10), last = to || String(ordered[ordered.length - 1].date).slice(0, 10);
        ordered = everyDay(first, last, rows).map(({ day, row }) => row || { date: day, total_amount: 0, total_sales: 0, item_count: 0, none: true });
        const today = ymd(new Date());
        let start = -1;
        ordered.forEach((r, i) => {
            const none = r.none && String(r.date).slice(0, 10) < today;
            if (none && start < 0) start = i;
            if ((!none || i === ordered.length - 1) && start >= 0) {
                const end = none ? i : i - 1;
                if (end - start + 1 >= 3) bands.push([start, end]);
                start = -1;
            }
        });
    }
    const t = chartTheme();
    const options = baseChartOptions(t);
    options.scales.y.ticks.callback = v => formatCompactCurrency(v);
    options.plugins.tooltip = {
        displayColors: false,
        callbacks: {
            title: items => periodLabel(ordered[items[0].dataIndex]),
            label: item => {
                const r = ordered[item.dataIndex];
                if (r.none) return 'No sales recorded';
                return [formatCurrency(rowRevenue(r)), `${formatNumber(rowSales(r))} sales · ${formatQty(rowItems(r))} items`];
            }
        }
    };
    options.plugins.noSalesBands = { bands, fill: t.grid, line: t.barSoft, text: t.text, font: t.font };
    salesChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ordered.map(shortLabel),
            datasets: [{ data: ordered.map(rowRevenue), backgroundColor: t.bar, borderRadius: 2, maxBarThickness: 36 }]
        },
        options,
        plugins: [noSalesBands]
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

/* Under the category bars: the lines that take the categories to the revenue
   figure. The bars add up items sold before discounts; revenue is what was
   charged. Sales recorded with no items belong to no category, and discounts
   come off. Shown whenever either exists, so the card always adds up. */
function renderCategoryTotals(summary) {
    const el = document.getElementById('categoryTotals');
    if (!el) return;
    const noItems = summary.unitemised || { sales: 0, revenue: 0 };
    const discounts = Number(summary.discounts_given) || 0;
    const unexplained = Number(summary.unexplained) || 0;
    if (!(Number(noItems.revenue) > 0) && !(discounts > 0) && Math.abs(unexplained) < 0.005) { el.hidden = true; el.innerHTML = ''; return; }
    const row = (label, value, cls = '') => `<div class="rp-adds-row ${cls}"><span>${label}</span><span>${value}</span></div>`;
    let html = row('Items sold, all categories', formatCurrency(summary.category_total || 0));
    if (Number(noItems.revenue) > 0) {
        html += row(`Sales recorded without items <small>${formatNumber(noItems.sales)} sale${Number(noItems.sales) === 1 ? '' : 's'}, in no category</small>`, '+ ' + formatCurrency(noItems.revenue));
    }
    if (discounts > 0) html += row('Discounts given', '− ' + formatCurrency(discounts));
    if (Math.abs(unexplained) >= 0.005) html += row('Other differences', (unexplained < 0 ? '− ' : '+ ') + formatCurrency(Math.abs(unexplained)));
    html += row('Revenue', formatCurrency(summary.total_revenue || 0), 'rp-adds-total');
    el.innerHTML = html;
    el.hidden = false;
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

/* The report as an Excel workbook (js/xlsx.js): one sheet for each part of the
   page, each an Excel table with the same chart the page draws beside it. The
   periods run oldest first, so the chart reads left to right like the page's. */
function exportExcel() {
    const data = currentReportData || {};
    const rows = data.rows || [];
    if (!rows.length) { showToast('There is nothing to export for this period', 'warning'); return; }
    const word = GROUP_WORD[currentGroup];
    const sheets = [{
        name: 'Sales by ' + word,
        columns: [{ head: GROUP_HEAD[currentGroup], width: 24, type: 'text' }, { head: 'Sales made', width: 12, type: 'int' },
            { head: 'Items sold', width: 12, type: 'int' }, { head: 'Revenue', width: 16, type: 'money' }],
        rows: [...rows].reverse().map(r => [periodLabel(r), rowSales(r), rowItems(r), rowRevenue(r)]),
        total: { label: 'TOTAL', sum: [1, 2, 3] },
        chart: { title: 'Revenue by ' + word, cat: 0, val: 3 }
    }];
    const top = data.top_products || [];
    if (top.length) sheets.push({
        name: 'Best-selling products',
        columns: [{ head: 'Product', width: 34, type: 'text' }, { head: 'Quantity sold', width: 14, type: 'int' }],
        rows: top.map(p => [p.name, Number(p.quantity) || 0]),
        chart: { title: 'Best-selling products (quantity sold)', cat: 0, val: 1 }
    });
    const cats = data.summary?.category_breakdown || [];
    if (cats.length) sheets.push({
        name: 'Sales by category',
        columns: [{ head: 'Category', width: 24, type: 'text' }, { head: 'Items sold', width: 12, type: 'int' },
            { head: 'Sold before discounts', width: 22, type: 'money' }],
        rows: cats.map(c => [c.category_name || 'Uncategorised', Number(c.total_quantity) || 0, Number(c.total_revenue) || 0]),
        total: { label: 'TOTAL', sum: [1, 2] },
        chart: { title: 'Sales by category (before discounts)', cat: 0, val: 2 }
    });
    downloadWorkbook(`sales_by_${word}_${ymd(new Date())}.xlsx`, sheets);
    showToast('Sales report exported with ' + sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's') + ' and charts', 'success');
}

/* ---------- Void requests ----------
   A cashier cannot void a sale; they flag it and say why. The decision is
   made here, away from the day-to-day sales list. */

let voidData = { waiting: [], voided: [] };
let voidedShown = PAGE_SIZE;

function voidWhen(ms) {
    return new Date(Number(ms)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function loadVoidRequests(announce) {
    try {
        const res = await fetch(`${API_BASE}/sales/void-requests`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'failed');
        voidData = data.data;
        renderVoidRequests();
        if (announce) showToast('Void requests refreshed', 'success');
    } catch (error) {
        console.error('Void requests failed to load:', error);
        const body = document.getElementById('voidWaitingBody');
        if (body) body.innerHTML = '<tr><td colspan="5" class="rp-loading">Void requests could not be loaded.</td></tr>';
    }
}

function renderVoidRequests() {
    const count = document.getElementById('voidTabCount');
    if (count) { count.textContent = voidData.waiting.length + ' waiting'; count.title = 'Void requests waiting for your decision'; count.hidden = !voidData.waiting.length; }

    const waiting = document.getElementById('voidWaitingBody');
    if (!waiting) return;
    waiting.innerHTML = voidData.waiting.length ? voidData.waiting.map(v => `
        <tr>
            <td><span class="rp-strong">#${Number(v.id)}</span>
                <span class="rp-sub">${escHtml(v.cashier || 'Unknown cashier')} · sold ${escHtml(voidWhen(v.sold_at))}</span>
                <span class="rp-sub">Customer: ${escHtml(v.customer_name || 'Walk-in')}</span></td>
            <td class="rp-pre">${escHtml(v.items || '—')}</td>
            <td>${escHtml(v.reason || '—')}<span class="rp-sub">Asked ${escHtml(voidWhen(v.requested_at))}</span></td>
            <td class="num rp-strong">${formatCurrency(v.final_amount)}</td>
            <td class="num rp-row-actions">
                <button class="btn-delete" data-void-approve="${Number(v.id)}">Void sale</button>
                <button class="btn-view" data-void-keep="${Number(v.id)}">Keep sale</button>
            </td>
        </tr>`).join('') : '<tr><td colspan="5" class="rp-loading">No void requests are waiting.</td></tr>';

    renderVoided();
}

function renderVoided() {
    const rows = voidData.voided;
    const total = rows.reduce((sum, v) => sum + (Number(v.final_amount) || 0), 0);
    document.getElementById('voidedSub').textContent = rows.length
        ? `${rows.length} sale${rows.length === 1 ? '' : 's'} worth ${formatCurrency(total)} cancelled after being recorded`
        : 'Sales that were cancelled after being recorded';
    const body = document.getElementById('voidedBody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="rp-loading">No sales have been voided in the last 90 days.</td></tr>'; document.getElementById('voidedPagination').innerHTML = ''; return; }
    body.innerHTML = rows.slice(0, voidedShown).map(v => {
        // the void reason is appended to the sale's notes as "VOIDED: …"
        const reason = String(v.notes || '').split('VOIDED:').pop().trim();
        return `<tr>
            <td><span class="rp-strong">#${Number(v.id)}</span><span class="rp-sub">Sold ${escHtml(voidWhen(v.sold_at))}</span></td>
            <td>${escHtml(v.cashier || '—')}</td>
            <td>${escHtml(voidWhen(v.voided_at))}<span class="rp-sub">${v.was_requested ? 'Asked for by the cashier' : 'Voided directly by a manager'}</span></td>
            <td>${escHtml(reason || '—')}</td>
            <td class="num">${formatCurrency(v.final_amount)}</td>
        </tr>`;
    }).join('');
    updatePagination('voidedPagination', rows, voidedShown, 'showMoreVoided', 'showLessVoided', PAGE_SIZE);
}
function showMoreVoided() { voidedShown += PAGE_SIZE; renderVoided(); }
function showLessVoided() { voidedShown = Math.max(PAGE_SIZE, voidedShown - PAGE_SIZE); renderVoided(); }

document.addEventListener('click', e => {
    const approve = e.target.closest('[data-void-approve]');
    const keep = e.target.closest('[data-void-keep]');
    if (approve) decideVoid(Number(approve.dataset.voidApprove), true);
    else if (keep) decideVoid(Number(keep.dataset.voidKeep), false);
});

function decideVoid(id, approve) {
    const request = voidData.waiting.find(v => Number(v.id) === id);
    if (!request) return;
    const run = async () => {
        try {
            const res = await fetch(`${API_BASE}/sales/${id}/${approve ? 'void' : 'void-request/dismiss'}`, {
                method: 'POST', headers: getAuthHeaders(),
                body: JSON.stringify(approve ? { reason: 'Cashier request: ' + (request.reason || 'no reason given') } : {})
            });
            const data = await res.json();
            if (!data.success) { showToast(data.message || 'That could not be completed', 'error'); return; }
            showToast(approve ? 'Sale voided and its items returned to stock' : 'Request dismissed. The sale stands.', 'success');
            loadVoidRequests(false);
        } catch (error) {
            console.error('Void decision failed:', error);
            showToast('That could not be completed', 'error');
        }
    };
    if (approve) {
        showConfirmDialog('Void sale #' + id,
            `This cancels the sale of ${formatCurrency(request.final_amount)} and returns its items to stock. It stays on record as voided.`,
            run, 'Void sale', '<span class="material-symbols-outlined" style="color:var(--danger);">undo</span>');
    } else {
        showConfirmDialog('Keep sale #' + id, 'The request is dismissed and the sale stays as it is.', run, 'Keep sale');
    }
}

// showToast comes from auth.js — one toast design everywhere
