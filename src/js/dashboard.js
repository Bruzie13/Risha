let expirationData = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    renderGreeting();
    await loadUserInfo();
    await loadDashboardStats();
    await loadDayBrief();
    await loadNotifications();
    await loadCharts();
    await loadAdvancedMetrics();
    await loadExpirationRisk();
    await loadRecentSales();
    await loadRecentPOs();
    await loadLowStockAlerts();
    watchThemeForCharts();
    if (typeof setInterval !== 'undefined') {
        setInterval(refreshDashboard, 30000);
        setInterval(loadRecentSales, 10000);
    }
});

function renderGreeting() {
    const user = getUser();
    const name = (user?.full_name || user?.username || '').trim();
    const first = name.split(' ')[0] || 'there';
    const el = document.getElementById('dashGreeting');
    if (el) el.textContent = first;
    const initialsEl = document.getElementById('heroInitials');
    if (initialsEl && name) {
        initialsEl.textContent = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }
    const roleEl = document.getElementById('heroRoleChip');
    if (roleEl) roleEl.textContent = user?.role || 'staff';
    const dateEl = document.getElementById('dateDisplay');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Day brief: replaces the generic greeting sub-line with today's real numbers
let briefAttention = { low: 0, expiring: 0 };

async function loadDayBrief() {
    const el = document.getElementById('dashGreetingSub');
    if (!el) return;
    try {
        const res = await fetch(`${API_BASE}/sales/daily-sales?days=1`, { headers: getAuthHeaders() });
        const json = await res.json();
        const today = new Date();
        const row = (json.data || []).find(r => {
            const d = parseExpiryDate(r.date);
            return d && d.getTime() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        });
        const txns = row ? Number(row.transaction_count) : 0;
        const revenue = row ? Number(row.daily_total) : 0;
        const h = today.getHours();
        const shift = h < 12 ? 'Morning shift' : h < 18 ? 'Afternoon shift' : 'Evening shift';
        const attention = (briefAttention.low || 0) + (briefAttention.expiring || 0);
        const sep = '<span class="brief-sep">·</span>';
        const salesPart = txns > 0
            ? `<strong>${formatNumber(txns)}</strong> sale${txns === 1 ? '' : 's'} rung up${sep}<strong>${formatCurrency(revenue)}</strong> in the till`
            : 'no sales yet — register is warmed up';
        const attentionPart = attention > 0
            ? `${sep}<strong class="brief-alert">${formatNumber(attention)}</strong> item${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention`
            : `${sep}shelves looking good`;
        el.innerHTML = `${shift}${sep}${salesPart}${attentionPart}`;
    } catch {
        el.textContent = "Here's what's happening in your pet shop today.";
    }
}

async function loadUserInfo() {
    const user = getUser();
    if (!user) return;
    const nameEl = document.getElementById('userName');
    const avatarEl = document.querySelector('.avatar-initials');
    if (nameEl) nameEl.textContent = user.full_name || user.username || user.email;
    if (avatarEl) {
        const name = user.full_name || user.username || user.email;
        avatarEl.textContent = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }
}

function kpiCard(label, icon, iconClass, value, foot, valueColor) {
    return `<div class="kpi-card">
        <div class="kpi-top">
            <span class="kpi-label">${label}</span>
            <span class="kpi-icon ${iconClass}"><span class="material-symbols-outlined">${icon}</span></span>
        </div>
        <div class="kpi-value"${valueColor ? ` style="color:${valueColor};"` : ''}>${value}</div>
        <div class="kpi-foot">${foot}</div>
    </div>`;
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/stats`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const s = data.data;
            const low = s.low_stock_count ?? 0;
            const expiring = s.expiring_count ?? 0;
            briefAttention = { low, expiring };
            document.getElementById('metricCards').innerHTML =
                kpiCard('Total Products', 'inventory_2', 'blue',
                    formatNumber(s.total_products ?? 0),
                    `<span class="trend-pill up">▲ ${formatNumber(s.active_products ?? 0)}</span> active`) +
                kpiCard('Total Revenue', 'payments', 'coral',
                    `<span title="${formatCurrency(s.total_sales_amount ?? 0)}">${formatCompactCurrency(s.total_sales_amount ?? 0)}</span>`,
                    `${formatNumber(s.total_sales ?? 0)} transactions`) +
                kpiCard('Low Stock', 'warning', 'amber',
                    formatNumber(low),
                    low > 0 ? '<span class="trend-pill down">Needs attention</span>' : '<span class="trend-pill up">All good</span>',
                    low > 0 ? 'var(--warning)' : null) +
                kpiCard('Expiring Soon', 'schedule', 'red',
                    formatNumber(expiring),
                    'Within 30 days',
                    expiring > 0 ? 'var(--danger)' : null) +
                kpiCard('Inventory Value', 'account_balance', 'green',
                    '<span id="inventoryValue">—</span>',
                    'Retail estimate');
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

async function loadAdvancedMetrics() {
    try {
        const prodRes = await fetch(`${API_BASE}/products`, { headers: getAuthHeaders() }).then(r => r.json());
        const products = prodRes.data || [];
        let totalRetail = 0;
        products.forEach(p => {
            totalRetail += parseFloat(p.unit_price || 0) * (p.stock_quantity || 0);
        });
        const valueEl = document.getElementById('inventoryValue');
        if (valueEl) {
            valueEl.textContent = formatCompactCurrency(totalRetail);
            valueEl.title = formatCurrency(totalRetail);
        }
    } catch (e) {
        console.error('Error loading advanced metrics:', e);
    }
}

async function loadNotifications() {
    try {
        const response = await fetch(`${API_BASE}/notifications/count`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const count = data.data.count || 0;
            const el = document.getElementById('alertCount');
            if (el) el.textContent = count;
            const chip = document.getElementById('alertChip');
            if (chip) chip.classList.toggle('has-alerts', count > 0);
            const el2 = document.getElementById('notifBadge');
            if (el2) {
                el2.textContent = count;
                el2.style.display = count > 0 ? 'flex' : 'none';
                if (count > 0) el2.classList.add('has-alerts');
                else el2.classList.remove('has-alerts');
            }
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

/* ── Live / Offline connection status ──
   "Live" is backed by the 10-second Recent Sales poll: a successful poll marks
   the dashboard Live, a failed poll (server down, no internet) marks it Offline.
   Browser online/offline events flip it immediately without waiting for a poll. */
let liveState = null;

function setLiveStatus(ok) {
    if (liveState === ok) return;
    liveState = ok;
    const chip = document.getElementById('liveChip');
    const chipText = document.getElementById('liveChipText');
    if (chip) {
        chip.classList.toggle('offline', !ok);
        chip.title = ok ? 'Data refreshes every 10 seconds' : 'Connection lost — data may be outdated';
    }
    if (chipText) chipText.textContent = ok ? 'Live' : 'Offline';
    const status = document.getElementById('recentSalesLiveStatus');
    if (status) {
        status.textContent = ok ? 'Live' : 'Offline';
        status.style.color = ok ? 'var(--success)' : 'var(--danger)';
    }
    const dot = document.getElementById('recentSalesLiveDot');
    if (dot) {
        dot.style.background = ok ? 'var(--success)' : 'var(--danger)';
        dot.style.animation = ok ? '' : 'none';
    }
}

window.addEventListener('offline', () => setLiveStatus(false));
window.addEventListener('online', () => { setLiveStatus(true); loadRecentSales(); });

let dashSalesDisplayCount = 5;
let recentSalesSeenIds = new Set();

async function loadRecentSales() {
    try {
        const response = await fetch(`${API_BASE}/sales?limit=20`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        setLiveStatus(true);
        const list = document.getElementById('recentSalesList');
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        let items = (data.data || []).filter(function(s) {
            return s.created_at && new Date(s.created_at) >= threeDaysAgo;
        });
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">No activity in the last 3 days</div>';
            document.getElementById('recentSalesPagination').innerHTML = '';
            return;
        }
        const existingIds = new Set();
        list.querySelectorAll('.timeline-item').forEach(el => {
            if (el.dataset.saleId) existingIds.add(el.dataset.saleId);
        });
        const newItems = items.filter(s => !existingIds.has(String(s.id)) && !recentSalesSeenIds.has(String(s.id)));
        newItems.forEach(s => recentSalesSeenIds.add(String(s.id)));
        const newCount = newItems.length;
        const limited = items.slice(0, dashSalesDisplayCount);
        list.innerHTML = limited.map((s, i) => {
            const isNew = i < newCount;
            const state = s.status === 'completed' ? 'completed' : s.status === 'pending' ? 'pending' : 'other';
            const avatarClass = state === 'completed' ? '' : state;
            return `<div class="timeline-item" data-sale-id="${s.id}"${isNew ? ' style="animation:feed-slide-in 0.35s ease;"' : ''}>
                <div class="timeline-avatar ${avatarClass}"><span class="material-symbols-outlined" style="font-size:17px;">receipt_long</span></div>
                <div class="timeline-content">
                    <div class="timeline-title">#${s.id} — ${escHtml(s.customer_name || 'Walk-in')}</div>
                    <div class="timeline-sub">${s.created_at ? formatTime(s.created_at) : ''}</div>
                </div>
                <div class="timeline-right">
                    <div class="timeline-value">${formatCurrency(s.total_amount || 0)}</div>
                    <div class="timeline-status ${state}">${s.status || 'completed'}</div>
                </div>
            </div>`;
        }).join('');
        updatePagination('recentSalesPagination', items, dashSalesDisplayCount, 'showMoreDashSales');
        if (newCount > 0) {
            const status = document.getElementById('recentSalesLiveStatus');
            if (status) status.textContent = `${newCount} new`;
            setTimeout(() => {
                const s = document.getElementById('recentSalesLiveStatus');
                if (s && liveState) s.textContent = 'Live';
            }, 3000);
        }
    } catch (e) {
        // Network failure or server error — flag Offline but keep showing the
        // last data we had instead of wiping the list.
        setLiveStatus(false);
        const list = document.getElementById('recentSalesList');
        if (list && !list.querySelector('.timeline-item')) {
            list.innerHTML = '<div class="empty-state">Can\'t reach the server — retrying every 10 seconds…</div>';
        }
    }
}

function showMoreDashSales() {
    dashSalesDisplayCount += 5;
    loadRecentSales();
}

async function loadRecentPOs() {
    try {
        const response = await fetch(`${API_BASE}/purchase-orders`, { headers: getAuthHeaders() });
        const data = await response.json();
        const list = document.getElementById('recentPOList');
        const items = data.data || [];
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">No purchase orders yet</div>';
            return;
        }
        list.innerHTML = items.slice(0, 5).map(po => {
            const badge = po.status === 'received' ? 'status-completed'
                : po.status === 'pending' ? 'status-pending'
                : po.status === 'cancelled' ? 'status-inactive' : 'status-shipped';
            return `<div class="dash-item">
                <div class="item-info">
                    <div class="item-name">${escHtml(po.po_number) || 'PO#' + po.id}</div>
                    <div class="item-sub">${escHtml(po.supplier_name) || 'Supplier #' + po.supplier_id}</div>
                </div>
                <div class="item-right">
                    <div class="item-value">${formatCurrency(po.total_amount || 0)}</div>
                    <span class="status-badge ${badge}" style="margin-top:3px;">${po.status}</span>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        document.getElementById('recentPOList').innerHTML = '<div class="empty-state">Failed to load</div>';
    }
}

async function loadLowStockAlerts() {
    try {
        const response = await fetch(`${API_BASE}/products/low-stock`, { headers: getAuthHeaders() });
        const data = await response.json();
        const list = document.getElementById('lowStockList');
        const items = data.data || [];
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">All products are well-stocked</div>';
            return;
        }
        list.innerHTML = items.slice(0, 5).map(p => {
            const stock = p.stock_quantity ?? 0;
            const reorder = p.reorder_level ?? 10;
            const fillPct = Math.min(100, Math.round((stock / Math.max(reorder, 1)) * 100));
            const barClass = stock === 0 ? 'danger' : fillPct < 30 ? 'danger' : 'warning';
            return `<div class="stock-bar-item">
                <div class="stock-bar-info">
                    <div class="stock-bar-name">${escHtml(p.name)}</div>
                    <div class="stock-bar-sub">SKU: ${escHtml(p.sku || 'N/A')} · Reorder: ${formatNumber(reorder)}</div>
                </div>
                <div class="stock-bar-track">
                    <div class="stock-bar-fill ${barClass}" style="width:${Math.max(4, fillPct)}%"></div>
                </div>
                <div class="stock-bar-num" style="color:${stock === 0 ? 'var(--danger)' : 'var(--warning)'}">${formatNumber(stock)}</div>
            </div>`;
        }).join('');
    } catch (e) {
        document.getElementById('lowStockList').innerHTML = '<div class="empty-state">Failed to load</div>';
    }
}

/* ── Charts ── */
let salesChartInstance = null;
let categoryChartInstance = null;
let lastChartData = null;

function chartTheme() {
    const css = getComputedStyle(document.documentElement);
    return {
        text: css.getPropertyValue('--text-muted').trim() || '#8A94A8',
        grid: css.getPropertyValue('--border-subtle').trim() || '#F0F3F8',
        card: css.getPropertyValue('--bg-card').trim() || '#FFFFFF'
    };
}

const CHART_PALETTE = ['#F1867B', '#61B6E7', '#F3B950', '#57BE8C', '#9F86DC', '#94A3B8', '#E88BB5', '#6BC6BD'];

async function loadCharts() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/charts`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            lastChartData = data.data;
            renderSalesTrendChart(data.data.sales || data.data);
            renderInventoryChart(data.data.category_breakdown);
        }
    } catch (error) {
        console.error('Error loading chart data:', error);
    }
}

function renderSalesTrendChart(data) {
    const canvas = document.getElementById('salesChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (salesChartInstance) salesChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const theme = chartTheme();
    const items = (Array.isArray(data) ? [...data] : []).sort((a, b) =>
        new Date(a.date || a.sale_date || a.created_at) - new Date(b.date || b.sale_date || b.created_at));
    const labels = items.map(d => {
        const dt = new Date(d.date || d.sale_date || d.created_at);
        return isNaN(dt.getTime()) ? (d.label || '') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = items.map(d => parseFloat(d.daily_total || d.total_amount || d.total || d.value || 0));
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(238, 106, 95, 0.22)');
    gradient.addColorStop(1, 'rgba(238, 106, 95, 0)');
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{
                label: 'Revenue (₱)',
                data: values.length ? values : [0],
                borderColor: '#EE6A5F',
                backgroundColor: gradient,
                fill: true,
                tension: 0.42,
                borderWidth: 2.5,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointBackgroundColor: '#EE6A5F',
                pointBorderColor: theme.card,
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: theme.text, font: { size: 11 }, maxTicksLimit: 8 }, grid: { display: false }, border: { display: false } },
                y: { beginAtZero: true, ticks: { color: theme.text, font: { size: 11 }, maxTicksLimit: 6 }, grid: { color: theme.grid }, border: { display: false } }
            }
        }
    });
}

function renderInventoryChart(categories) {
    const canvas = document.getElementById('categoryChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (categoryChartInstance) categoryChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const theme = chartTheme();
    const items = Array.isArray(categories) && categories.length ? categories : [{ label: 'No Data', value: 1 }];
    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: items.map(c => c.label || c.name || 'N/A'),
            datasets: [{
                data: items.map(c => c.value || c.count || 1),
                backgroundColor: CHART_PALETTE.slice(0, items.length),
                borderColor: theme.card,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: theme.text, font: { size: 11 }, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 12 }
                }
            }
        }
    });
}

function watchThemeForCharts() {
    const observer = new MutationObserver(() => {
        if (lastChartData) {
            renderSalesTrendChart(lastChartData.sales || lastChartData);
            renderInventoryChart(lastChartData.category_breakdown);
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

async function refreshDashboard() {
    await loadDashboardStats();
    await loadDayBrief();
    await loadAdvancedMetrics();
    await loadNotifications();
    await loadExpirationRisk();
    await loadRecentSales();
    await loadRecentPOs();
    await loadLowStockAlerts();
}

// expiration_date may arrive as 'YYYY-MM-DD' or a UTC ISO datetime — convert to
// local time first, then strip to the local calendar day
function parseExpiryDate(raw) {
    if (!raw) return null;
    const s = String(raw);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysFromToday(date) {
    if (!date) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((date - today) / 86400000);
}

async function loadExpirationRisk() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/expiration-risk`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            expirationData = data.data;
            const grid = document.getElementById('expiryGrid');
            grid.innerHTML = `
                <div class="expiry-radar-card critical" onclick="showExpirationProducts('critical')">
                    <div class="radar-num">${data.data.critical.count}</div>
                    <div class="radar-label">Critical ≤30d</div>
                </div>
                <div class="expiry-radar-card warning" onclick="showExpirationProducts('warning')">
                    <div class="radar-num">${data.data.warning.count}</div>
                    <div class="radar-label">Warning 31-60d</div>
                </div>
                <div class="expiry-radar-card notice" onclick="showExpirationProducts('notice')">
                    <div class="radar-num">${data.data.notice.count}</div>
                    <div class="radar-label">Notice 61-90d</div>
                </div>
            `;
            const productList = document.getElementById('expiryProductList');
            const allExpiring = [...(data.data.critical.products || []), ...(data.data.warning.products || []), ...(data.data.notice.products || [])].slice(0, 5);
            if (allExpiring.length > 0) {
                productList.innerHTML = allExpiring.map(p => {
                    const exp = parseExpiryDate(p.expiration_date);
                    const days = p.days_until_expiry ?? daysFromToday(exp);
                    const daysClass = days !== null && days <= 30 ? 'danger' : days !== null && days <= 60 ? 'warning' : 'info';
                    return `<div class="product-expiry-item">
                        <div class="pei-info">
                            <div class="pei-name">${escHtml(p.name)}</div>
                            <div class="pei-sub">Expires ${exp ? exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'} · Stock: ${formatNumber(p.stock_quantity || 0)}</div>
                        </div>
                        <div class="pei-days ${daysClass}">${days !== null ? days + ' days' : '—'}</div>
                    </div>`;
                }).join('');
            } else {
                productList.innerHTML = '';
            }
        }
    } catch (error) {
        console.error('Error loading expiration risk:', error);
    }
}

async function autoReorderDashboard() {
    showConfirmDialog('Auto-Reorder', 'Auto-generate purchase orders for all low-stock products? Suppliers will be emailed.', async () => {
        try {
            const response = await fetch(`${API_BASE}/purchase-orders/auto-generate`, {
                method: 'POST', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                const count = Array.isArray(data.data) ? data.data.length : 0;
                if (count > 0) {
                    showSuccessDialog('Reorder placed', `${count} purchase order${count === 1 ? '' : 's'} generated — suppliers have been emailed.`, { icon: 'local_shipping' });
                } else {
                    showSuccessDialog('No orders generated', data.message || 'Nothing needed reordering — see the notes for details.', { tone: 'info' });
                }
                await loadDashboardStats();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Auto-reorder error:', error);
            showToast('Failed to auto-reorder', 'error');
        }
    }, 'Yes, Reorder', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">inventory</span>');
}

function showExpirationProducts(riskLevel) {
    if (!expirationData || !expirationData[riskLevel]) return;
    const group = expirationData[riskLevel];
    const labels = { critical: 'Critical (≤30 days)', warning: 'Warning (31–60 days)', notice: 'Notice (61–90 days)' };
    document.getElementById('expirationModalTitle').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">schedule</span> ' + labels[riskLevel] + ' (' + group.count + ' product(s))';
    const body = document.getElementById('expirationModalBody');
    if (!group.products.length) {
        body.innerHTML = '<div class="empty-state">No products in this range</div>';
    } else {
        body.innerHTML = group.products.map(p => {
            const exp = parseExpiryDate(p.expiration_date);
            return `
            <div class="details-row">
                <span class="details-label">${escHtml(p.name)}</span>
                <span class="details-value" style="color:${riskLevel === 'critical' ? 'var(--danger)' : riskLevel === 'warning' ? 'var(--warning)' : 'var(--info)'};font-weight:600;">${exp ? exp.toLocaleDateString() : 'N/A'} · ${formatNumber(p.stock_quantity || 0)} qty</span>
            </div>
        `;
        }).join('');
    }
    document.getElementById('expirationModal').classList.add('active');
}

function closeExpirationModal() {
    document.getElementById('expirationModal').classList.remove('active');
}

function navigateTo(page) {
    window.location.href = page;
}

function formatTime(t) {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('expirationModal')) closeExpirationModal();
});
