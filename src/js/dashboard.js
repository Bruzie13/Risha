let expirationData = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await loadUserInfo();
    await loadDashboardStats();
    await loadNotifications();
    await loadCharts();
    await loadAdvancedMetrics();
    await loadExpirationRisk();
    await loadRecentSales();
    await loadRecentPOs();
    await loadLowStockAlerts();
    if (typeof setInterval !== 'undefined') setInterval(refreshDashboard, 30000);
});

async function loadUserInfo() {
    const user = getUser();
    if (!user) return;
    const nameEl = document.getElementById('userName');
    const avatarEl = document.querySelector('.avatar');
    if (nameEl) nameEl.textContent = user.full_name || user.username || user.email;
    if (avatarEl) {
        const name = user.full_name || user.username || user.email;
        avatarEl.textContent = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/stats`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const s = data.data;
            const metricCards = document.getElementById('metricCards');
            metricCards.innerHTML = `
                <div class="data-orb">
                    <div class="orb-ring cyan">◈</div>
                    <div class="orb-value">${s.total_products ?? 0}</div>
                    <div class="orb-label">Total Products</div>
                    <div class="orb-change up">+${s.active_products ?? 0} active</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring amber">◆</div>
                    <div class="orb-value">₱${(s.total_sales_amount ?? 0).toLocaleString('en-US', {minimumFractionDigits:2})}</div>
                    <div class="orb-label">Total Revenue</div>
                    <div class="orb-change up">${s.total_sales ?? 0} transactions</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring rose">◉</div>
                    <div class="orb-value" style="color:${(s.low_stock_count ?? 0) > 0 ? 'var(--accent-rose)' : 'var(--text-primary)'}">${s.low_stock_count ?? 0}</div>
                    <div class="orb-label">Low Stock Items</div>
                    <div class="orb-change ${(s.low_stock_count ?? 0) > 0 ? 'down' : 'up'}">${(s.low_stock_count ?? 0) > 0 ? 'Needs attention' : 'All good'}</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring lilac">◇</div>
                    <div class="orb-value">${s.expiring_count ?? 0}</div>
                    <div class="orb-label">Expiring Soon</div>
                    <div class="orb-change ${(s.expiring_count ?? 0) > 0 ? 'down' : 'up'}">Within 30 days</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

async function loadAdvancedMetrics() {
    try {
        const [prodRes, saleRes] = await Promise.all([
            fetch(`${API_BASE}/products`).then(r => r.json()),
            fetch(`${API_BASE}/sales/top-products`).then(r => r.json())
        ]);
        const products = prodRes.data || [];
        let totalValue = 0, totalCost = 0, totalRevenue = 0;
        products.forEach(p => {
            const stock = p.stock_quantity || 0;
            const cost = parseFloat(p.cost_price || 0);
            const price = parseFloat(p.unit_price || 0);
            totalCost += cost * stock;
            totalRevenue += price * stock;
        });
    } catch (e) {
        console.error('Error loading advanced metrics:', e);
    }
}

async function loadNotifications() {
    try {
        const response = await fetch(`${API_BASE}/notifications/unread`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const count = data.data.length || data.data.count || 0;
            const el = document.getElementById('alertCount');
            if (el) el.textContent = count;
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

async function loadRecentSales() {
    try {
        const response = await fetch(`${API_BASE}/sales?limit=20`, { headers: getAuthHeaders() });
        const data = await response.json();
        const list = document.getElementById('recentSalesList');
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const items = (data.data || []).filter(function(s) {
            return s.created_at && new Date(s.created_at) >= threeDaysAgo;
        });
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">No activity in the last 3 days</div>';
            return;
        }
        list.innerHTML = items.map(s => {
            const dotClass = s.status === 'completed' ? 'cyan' : s.status === 'pending' ? 'amber' : 'lilac';
            return `<div class="timeline-item">
                <div class="timeline-dot ${dotClass}"></div>
                <div class="timeline-content">
                    <div class="timeline-title">#${s.id} — ${s.customer_name || 'Walk-in'}</div>
                    <div class="timeline-sub">${s.created_at ? formatTime(s.created_at) : ''}</div>
                </div>
                <div class="timeline-right">
                    <div class="timeline-value">₱${parseFloat(s.total_amount || 0).toFixed(2)}</div>
                    <div class="timeline-status" style="color:var(--${dotClass === 'cyan' ? 'accent-cyan' : dotClass === 'amber' ? 'accent-amber' : 'accent-lilac'})">${s.status || 'completed'}</div>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        document.getElementById('recentSalesList').innerHTML = '<div class="empty-state">Failed to load</div>';
    }
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
            const statusClass = po.status === 'received' ? 'green' : po.status === 'pending' ? 'gold' : po.status === 'cancelled' ? 'red' : 'blue';
            return `<div class="dash-item">
                <div class="item-dot ${statusClass}"></div>
                <div class="item-info">
                    <div class="item-name">${po.po_number || 'PO#' + po.id}</div>
                    <div class="item-sub">${po.supplier_name || 'Supplier #' + po.supplier_id}</div>
                </div>
                <div class="item-right">
                    <div class="item-value">₱${parseFloat(po.total_amount || 0).toFixed(2)}</div>
                    <div class="item-status" style="color:var(--${statusClass === 'green' ? 'accent-cyan' : statusClass === 'gold' ? 'accent-amber' : 'accent-rose'})">${po.status}</div>
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
                    <div class="stock-bar-sub">SKU: ${escHtml(p.sku || 'N/A')} · Reorder: ${reorder}</div>
                </div>
                <div class="stock-bar-track">
                    <div class="stock-bar-fill ${barClass}" style="width:${Math.max(4, fillPct)}%"></div>
                </div>
                <div class="stock-bar-num" style="color:${stock === 0 ? 'var(--accent-rose)' : 'var(--accent-amber)'}">${stock}</div>
            </div>`;
        }).join('');
    } catch (e) {
        document.getElementById('lowStockList').innerHTML = '<div class="empty-state">Failed to load</div>';
    }
}

let salesChartInstance = null;
let categoryChartInstance = null;
let lowStockChartInstance = null;

async function loadCharts() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/charts`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            renderSalesTrendChart(data.data.sales || data.data);
            renderInventoryChart(data.data.category_breakdown);
            renderLowStockChart(data.data.stock_status);
        }
    } catch (error) {
        console.error('Error loading chart data:', error);
    }
}

function renderSalesTrendChart(data) {
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;
    if (salesChartInstance) salesChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const items = Array.isArray(data) ? data : [];
    const labels = items.map(d => {
        const dt = new Date(d.date || d.sale_date || d.created_at);
        return isNaN(dt.getTime()) ? (d.label || '') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = items.map(d => parseFloat(d.daily_total || d.total_amount || d.total || d.value || 0));
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{ label: 'Sales (₱)', data: values.length ? values : [0], borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.06)', fill: true, tension: 0.4 }]
        },
        options: { responsive: true, plugins: { legend: { display: true, position: 'top', labels: { color: 'rgba(255,255,255,0.5)' } } }, scales: { x: { ticks: { color: 'rgba(255,255,255,0.3)' } }, y: { beginAtZero: true, ticks: { color: 'rgba(255,255,255,0.3)' } } } }
    });
}

function renderInventoryChart(categories) {
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;
    if (categoryChartInstance) categoryChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const items = Array.isArray(categories) && categories.length ? categories : [{ label: 'No Data', value: 1 }];
    const colors = ['#00d4aa', '#f0a030', '#ff4060', '#a07cff', '#40a0ff', '#00a88a'];
    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: items.map(c => c.label || c.name || 'N/A'),
            datasets: [{ data: items.map(c => c.value || c.count || 1), backgroundColor: colors.slice(0, items.length) }]
        },
        options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: 'rgba(255,255,255,0.5)' } } } }
    });
}

function renderLowStockChart(stockStatus) {
    const canvas = document.getElementById('lowStockChart');
    if (!canvas) return;
    if (lowStockChartInstance) lowStockChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const s = stockStatus || { in_stock: 0, low_stock: 0, out_of_stock: 0 };
    lowStockChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['In Stock', 'Low Stock', 'Out of Stock'],
            datasets: [{
                label: 'Products',
                data: [s.in_stock || 0, s.low_stock || 0, s.out_of_stock || 0],
                backgroundColor: ['rgba(0,212,170,0.6)', 'rgba(240,160,48,0.6)', 'rgba(255,64,96,0.6)'],
                borderRadius: 4
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: 'rgba(255,255,255,0.3)' } }, y: { beginAtZero: true, ticks: { stepSize: 1, color: 'rgba(255,255,255,0.3)' } } } }
    });
}

async function refreshDashboard() {
    await loadDashboardStats();
    await loadNotifications();
    await loadExpirationRisk();
    await loadRecentSales();
    await loadRecentPOs();
    await loadLowStockAlerts();
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
                    const daysClass = p.days_until_expiry <= 30 ? 'danger' : p.days_until_expiry <= 60 ? 'warning' : 'info';
                    return `<div class="product-expiry-item">
                        <div class="pei-info">
                            <div class="pei-name">${p.name}</div>
                            <div class="pei-sub">Expires ${p.expiration_date ? new Date(p.expiration_date+'T00:00:00').toLocaleDateString() : 'N/A'} · Stock: ${p.stock_quantity || 0}</div>
                        </div>
                        <div class="pei-days ${daysClass}">${p.days_until_expiry || '?'} days</div>
                    </div>`;
                }).join('');
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
                showToast(data.data ? `Created ${data.data.length} PO(s)` : data.message, 'success');
                await loadDashboardStats();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Auto-reorder error:', error);
            showToast('Failed to auto-reorder', 'error');
        }
    }, 'Yes, Reorder', '📦');
}

function showExpirationProducts(riskLevel) {
    if (!expirationData || !expirationData[riskLevel]) return;
    const group = expirationData[riskLevel];
    const labels = { critical: 'Critical (≤30 days)', warning: 'Warning (31–60 days)', notice: 'Notice (61–90 days)' };
    document.getElementById('expirationModalTitle').textContent = '⏰ ' + labels[riskLevel] + ' (' + group.count + ' product(s))';
    const body = document.getElementById('expirationModalBody');
    if (!group.products.length) {
        body.innerHTML = '<div class="empty-state">No products in this range</div>';
    } else {
        body.innerHTML = group.products.map(p => `
            <div class="details-row">
                <span class="details-label">${p.name}</span>
                <span class="details-value" style="color:${riskLevel === 'critical' ? 'var(--accent-rose)' : riskLevel === 'warning' ? 'var(--accent-amber)' : 'var(--accent-blue)'};font-weight:600;">${p.expiration_date ? new Date(p.expiration_date+'T00:00:00').toLocaleDateString() : 'N/A'} · ${p.stock_quantity || 0} qty</span>
            </div>
        `).join('');
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
