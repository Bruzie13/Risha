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
    if (typeof setInterval !== 'undefined') {
        setInterval(refreshDashboard, 30000);
        setInterval(loadRecentSales, 10000);
    }
});

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

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/stats`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const s = data.data;
            const metricCards = document.getElementById('metricCards');
            metricCards.innerHTML = `
                <div class="data-orb">
                    <div class="orb-ring cyan"><span class="material-symbols-outlined">inventory_2</span></div>
                    <div class="orb-value">${s.total_products ?? 0}</div>
                    <div class="orb-label">Total Products</div>
                    <div class="orb-change up">+${formatNumber(s.active_products ?? 0)} active</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring amber"><span class="material-symbols-outlined">payments</span></div>
                    <div class="orb-value">${formatCurrency(s.total_sales_amount ?? 0)}</div>
                    <div class="orb-label">Total Revenue</div>
                    <div class="orb-change up">${formatNumber(s.total_sales ?? 0)} transactions</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring rose"><span class="material-symbols-outlined">warning</span></div>
                    <div class="orb-value" style="color:${(s.low_stock_count ?? 0) > 0 ? 'var(--accent-rose)' : 'var(--text-primary)'}">${formatNumber(s.low_stock_count ?? 0)}</div>
                    <div class="orb-label">Low Stock Items</div>
                    <div class="orb-change ${(s.low_stock_count ?? 0) > 0 ? 'down' : 'up'}">${(s.low_stock_count ?? 0) > 0 ? 'Needs attention' : 'All good'}</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring lilac"><span class="material-symbols-outlined">schedule</span></div>
                    <div class="orb-value">${formatNumber(s.expiring_count ?? 0)}</div>
                    <div class="orb-label">Expiring Soon</div>
                    <div class="orb-change ${(s.expiring_count ?? 0) > 0 ? 'down' : 'up'}">Within 30 days</div>
                </div>
                <div class="data-orb">
                    <div class="orb-ring green"><span class="material-symbols-outlined">account_balance</span></div>
                    <div class="orb-value" id="inventoryValue">—</div>
                    <div class="orb-label">Inventory Value</div>
                    <div class="orb-change up">Retail estimate</div>
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
            fetch(`${API_BASE}/products`, { headers: getAuthHeaders() }).then(r => r.json()),
            fetch(`${API_BASE}/sales/top-products`, { headers: getAuthHeaders() }).then(r => r.json())
        ]);
        const products = prodRes.data || [];
        let totalCost = 0, totalRetail = 0;
        products.forEach(p => {
            const stock = p.stock_quantity || 0;
            const cost = parseFloat(p.cost_price || 0);
            const price = parseFloat(p.unit_price || 0);
            totalCost += cost * stock;
            totalRetail += price * stock;
        });
        const valueEl = document.getElementById('inventoryValue');
        if (valueEl) valueEl.textContent = formatCurrency(totalRetail);
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

let dashSalesDisplayCount = 5;
let recentSalesSeenIds = new Set();

async function loadRecentSales() {
    try {
        const response = await fetch(`${API_BASE}/sales?limit=20`, { headers: getAuthHeaders() });
        const data = await response.json();
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
        const existingItems = list.querySelectorAll('.timeline-item');
        const existingIds = new Set();
        existingItems.forEach(el => {
            const id = el.dataset.saleId;
            if (id) existingIds.add(id);
        });
        const newItems = items.filter(s => !existingIds.has(String(s.id)) && !recentSalesSeenIds.has(String(s.id)));
        newItems.forEach(s => recentSalesSeenIds.add(String(s.id)));
        const newCount = newItems.length;
        const limited = items.slice(0, dashSalesDisplayCount);
        list.innerHTML = limited.map((s, i) => {
            const isNew = i < newCount;
            const dotClass = s.status === 'completed' ? 'cyan' : s.status === 'pending' ? 'amber' : 'lilac';
            return `<div class="timeline-item${isNew ? ' is-new' : ''}" data-sale-id="${s.id}"${isNew ? ' style="animation:feed-slide-in 0.35s ease;"' : ''}>
                <div class="timeline-dot ${dotClass}"></div>
                <div class="timeline-content">
                    <div class="timeline-title">#${s.id} — ${escHtml(s.customer_name || 'Walk-in')}</div>
                    <div class="timeline-sub">${s.created_at ? formatTime(s.created_at) : ''}</div>
                </div>
                <div class="timeline-right">
                    <div class="timeline-value">${formatCurrency(s.total_amount || 0)}</div>
                    <div class="timeline-status" style="color:var(--${dotClass === 'cyan' ? 'accent-cyan' : dotClass === 'amber' ? 'accent-amber' : 'accent-lilac'})">${s.status || 'completed'}</div>
                </div>
            </div>`;
        }).join('');
        updatePagination('recentSalesPagination', items, dashSalesDisplayCount, 'showMoreDashSales');
        if (newCount > 0) {
            const status = document.getElementById('recentSalesLiveStatus');
            if (status) status.textContent = `● ${newCount} new`;
            for (let i = 0; i < Math.min(newCount, 3); i++) {
                setTimeout(() => triggerOrbitBurst(0), i * 200);
            }
            setTimeout(() => {
                list.querySelectorAll('.timeline-item.is-new').forEach(el => el.classList.remove('is-new'));
                const s = document.getElementById('recentSalesLiveStatus');
                if (s) s.textContent = '● Live';
            }, 3000);
        }
    } catch (e) {
        document.getElementById('recentSalesList').innerHTML = '<div class="empty-state">Failed to load</div>';
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
            const statusClass = po.status === 'received' ? 'green' : po.status === 'pending' ? 'gold' : po.status === 'cancelled' ? 'red' : 'blue';
            return `<div class="dash-item">
                <div class="item-dot ${statusClass}"></div>
                <div class="item-info">
                    <div class="item-name">${escHtml(po.po_number) || 'PO#' + po.id}</div>
                    <div class="item-sub">${escHtml(po.supplier_name) || 'Supplier #' + po.supplier_id}</div>
                </div>
                <div class="item-right">
                    <div class="item-value">${formatCurrency(po.total_amount || 0)}</div>
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
                    <div class="stock-bar-sub">SKU: ${escHtml(p.sku || 'N/A')} · Reorder: ${formatNumber(reorder)}</div>
                </div>
                <div class="stock-bar-track">
                    <div class="stock-bar-fill ${barClass}" style="width:${Math.max(4, fillPct)}%"></div>
                </div>
                <div class="stock-bar-num" style="color:${stock === 0 ? 'var(--accent-rose)' : 'var(--accent-amber)'}">${formatNumber(stock)}</div>
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
                            <div class="pei-name">${escHtml(p.name)}</div>
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
        body.innerHTML = group.products.map(p => `
            <div class="details-row">
                <span class="details-label">${escHtml(p.name)}</span>
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

var autoScrollId = null;
function startAutoScroll() {
    var container = document.getElementById('metricCards');
    if (!container || container.children.length === 0) { autoScrollId = setTimeout(startAutoScroll, 500); return; }
    if (container._autoScrollCloned) return;
    var items = Array.from(container.children);
    items.forEach(function(el) { container.appendChild(el.cloneNode(true)); });
    container._autoScrollCloned = true;
    var paused = false;
    var speed = 0.8;
    var half = container.scrollWidth / 2;
    function step() {
        if (!paused && container.scrollWidth > container.clientWidth) {
            container.scrollLeft += speed;
            if (container.scrollLeft >= half) {
                container.scrollLeft = 0;
            }
        }
        if (autoScrollId) autoScrollId = requestAnimationFrame(step);
    }
    container.addEventListener('mouseenter', function() { paused = true; });
    container.addEventListener('mouseleave', function() { paused = false; });
    container.addEventListener('touchstart', function() { paused = true; });
    container.addEventListener('touchend', function() { paused = false; });
    autoScrollId = requestAnimationFrame(step);
}

var origLoadStats = loadDashboardStats;
loadDashboardStats = async function() {
    await origLoadStats.apply(this, arguments);
    setTimeout(startAutoScroll, 100);
};

// ═══ Activity Orbit Visualization ═══
const ORBIT_RINGS = [
    { label: 'Sales',     color: '#F28B82', radius: 0.28, speed: 0.4, count: 4, metric: 0.5 },
    { label: 'Stock',     color: '#F9D77E', radius: 0.44, speed: 0.6, count: 5, metric: 0.5 },
    { label: 'Inventory', color: '#A8DDB5', radius: 0.60, speed: 0.3, count: 6, metric: 0.5 },
    { label: 'Alerts',    color: '#8ECDEE', radius: 0.76, speed: 0.5, count: 4, metric: 0.5 },
];

let orbitRingData = [[], [], [], []];
let orbitDots = [];
let orbitBursts = [];
let orbitAnimId = null;
let orbitHoveredRing = -1;
let orbitHoveredDot = -1;

async function loadOrbitRingData() {
    try {
        const [salesRes, stockRes, prodRes, statsRes, notifRes] = await Promise.all([
            fetch(`${API_BASE}/sales?limit=5`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE}/products/low-stock`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE}/products`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE}/dashboard/stats`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE}/notifications?limit=5`, { headers: getAuthHeaders() }),
        ]);
        const salesData = await salesRes.json();
        const sales = (salesData.data || []).slice(0, 5);
        orbitRingData[0] = sales.map(s => ({
            label: `#${s.id} ${s.customer_name || 'Walk-in'}`,
            value: `₱${parseFloat(s.total_amount || 0).toFixed(2)}`,
        }));
        ORBIT_RINGS[0].count = Math.max(2, orbitRingData[0].length || 1);

        const stockData = await stockRes.json();
        const lowStock = (stockData.data || []).slice(0, 5);
        orbitRingData[1] = lowStock.map(p => ({
            label: p.name,
            value: `${p.stock_quantity || 0} left`,
        }));
        ORBIT_RINGS[1].count = Math.max(2, orbitRingData[1].length || 1);

        const invData = await prodRes.json();
        const products = invData.data || [];
        const cats = {};
        products.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
        orbitRingData[2] = Object.entries(cats).slice(0, 6).map(([cat, count]) => ({
            label: cat || 'Uncategorized',
            value: `${count} product${count > 1 ? 's' : ''}`,
        }));
        ORBIT_RINGS[2].count = Math.max(2, orbitRingData[2].length || 2);

        const notifData = await notifRes.json();
        const notifs = (notifData.data || []).slice(0, 4);
        orbitRingData[3] = notifs.map(n => ({
            label: n.title || n.message || 'Alert',
            value: n.type || 'info',
        }));
        ORBIT_RINGS[3].count = Math.max(2, orbitRingData[3].length || 1);

        const stats = await statsRes.json();
        if (stats.success && stats.data) {
            const s = stats.data;
            ORBIT_RINGS[0].metric = s.total_sales ? Math.min(1, s.total_sales / 50) : 0.5;
            const totalProd = products.length || 1;
            const lowCount = lowStock.length;
            ORBIT_RINGS[1].metric = Math.min(1, 1 - lowCount / Math.max(totalProd, 1));
            ORBIT_RINGS[2].metric = Math.min(1, totalProd / 500);
            ORBIT_RINGS[3].metric = Math.min(1, (s.expiring_count || 0) / 30);
        }
    } catch (e) {
        console.error('Orbit data load error:', e);
    }
}

function startActivityOrbit() {
    const canvas = document.getElementById('activityOrbit');
    if (!canvas) return;
    const vis = document.getElementById('orbitVis');
    const rect = vis.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(cx, cy) - 2;

    orbitDots = [];
    ORBIT_RINGS.forEach((ring, ri) => {
        const r = ring.radius * maxR;
        const data = orbitRingData[ri];
        for (let i = 0; i < ring.count; i++) {
            const info = data[i] || null;
            orbitDots.push({
                _idx: orbitDots.length,
                ring: ri,
                idx: i,
                angle: (2 * Math.PI / ring.count) * i,
                size: info ? 3.5 : 2,
                opacity: info ? 0.7 : 0.3,
                phase: Math.random() * 1000,
                info: info,
            });
        }
    });

    function findHovered(mx, my) {
        for (let di = orbitDots.length - 1; di >= 0; di--) {
            const dot = orbitDots[di];
            const ring = ORBIT_RINGS[dot.ring];
            const r = ring.radius * maxR;
            const now = performance.now();
            const angle = dot.angle + now * ring.speed / 2000;
            const dx = cx + r * Math.cos(angle);
            const dy = cy + r * 0.55 * Math.sin(angle);
            const dist = Math.hypot(mx - dx, my - dy);
            if (dist < 8 && dot.info) return di;
        }
        for (let ri = ORBIT_RINGS.length - 1; ri >= 0; ri--) {
            const ring = ORBIT_RINGS[ri];
            const r = ring.radius * maxR;
            const dist = Math.hypot(mx - cx, (my - cy) / 0.55);
            const ringW = 12;
            if (Math.abs(dist - r) < ringW) return -(ri + 1);
        }
        return -1;
    }

    function updateTooltip(hoverIdx) {
        const tooltip = document.getElementById('orbitTooltip');
        if (!tooltip) return;
        if (hoverIdx >= 0) {
            const dot = orbitDots[hoverIdx];
            if (dot && dot.info) {
                tooltip.innerHTML = `<strong>${dot.info.label}</strong><br><span style="color:${ORBIT_RINGS[dot.ring].color}">${dot.info.value}</span>`;
                tooltip.classList.add('visible');
                orbitHoveredDot = hoverIdx;
                orbitHoveredRing = -1;
                canvas.style.cursor = 'pointer';
                return;
            }
        }
        if (hoverIdx < 0 && hoverIdx > -10) {
            const ri = -(hoverIdx + 1);
            if (ri >= 0 && ri < ORBIT_RINGS.length) {
                const ring = ORBIT_RINGS[ri];
                const items = orbitRingData[ri] || [];
                const count = items.length;
                const metric = Math.round(ring.metric * 100);
                const details = count > 0
                    ? `${count} item${count > 1 ? 's' : ''}`
                    : 'No data';
                tooltip.innerHTML = `<strong>${ring.label}</strong><br><span style="color:${ring.color}">${details} · ${metric}%</span>`;
                tooltip.classList.add('visible');
                orbitHoveredRing = ri;
                orbitHoveredDot = -1;
                canvas.style.cursor = 'pointer';
                return;
            }
        }
        tooltip.classList.remove('visible');
        orbitHoveredRing = -1;
        orbitHoveredDot = -1;
        canvas.style.cursor = 'default';
    }

    canvas.onmousemove = function(e) {
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const hit = findHovered(mx, my);
        updateTooltip(hit);
    };
    canvas.onmouseleave = function() {
        updateTooltip(-999);
    };
    canvas.onclick = function(e) {
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const hit = findHovered(mx, my);
        if (hit >= 0) {
            const dot = orbitDots[hit];
            if (dot && dot.info) {
                showToast(`${dot.info.label}: ${dot.info.value}`, 'info');
            }
        } else if (hit < 0) {
            const ri = -(hit + 1);
            const ring = ORBIT_RINGS[ri];
            const count = orbitRingData[ri].length;
            showToast(`${ring.label}: ${count} active items`, 'info');
        }
    };

    function draw(t) {
        ctx.clearRect(0, 0, w, h);
        ORBIT_RINGS.forEach((ring, ri) => {
            const r = ring.radius * maxR;
            const isHovered = orbitHoveredRing === ri;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, 2 * Math.PI);
            ctx.strokeStyle = ring.color + (isHovered ? '60' : '30');
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.setLineDash([3, 6]);
            ctx.stroke();
            ctx.setLineDash([]);

            const metric = Math.min(1, Math.max(0, ring.metric));
            if (metric > 0.02) {
                ctx.beginPath();
                ctx.ellipse(cx, cy, r, r * 0.55, 0, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * metric);
                ctx.strokeStyle = ring.color + (isHovered ? 'C0' : '80');
                ctx.lineWidth = isHovered ? 3 : 2;
                ctx.stroke();
            }
        });
        const now = performance.now();
        orbitDots.forEach(dot => {
            const ring = ORBIT_RINGS[dot.ring];
            const r = ring.radius * maxR;
            const angle = dot.angle + now * ring.speed / 2000;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * 0.55 * Math.sin(angle);
            const osc = 0.6 + 0.4 * Math.sin(now / 800 + dot.phase);
            const isHovered = orbitHoveredDot === dot._idx;
            const size = (isHovered ? dot.size * 1.8 : dot.size) * osc;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            const alpha = isHovered ? 'DD' : Math.round(dot.opacity * (dot.info ? 0.9 : 0.4) * 255).toString(16).padStart(2, '0');
            ctx.fillStyle = ring.color + alpha;
            ctx.fill();
            if (isHovered) {
                ctx.beginPath();
                ctx.arc(x, y, size + 3, 0, 2 * Math.PI);
                ctx.strokeStyle = ring.color + '80';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });
        orbitBursts = orbitBursts.filter(b => {
            const age = now - b.born;
            const life = 1200;
            if (age > life) return false;
            const progress = age / life;
            const ring = ORBIT_RINGS[b.ring];
            const r = ring.radius * maxR;
            const angle = b.angle + now * ring.speed / 2000;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * 0.55 * Math.sin(angle);
            const burstR = 3 + progress * 10;
            const alpha = 1 - progress;
            ctx.beginPath();
            ctx.arc(x, y, burstR, 0, 2 * Math.PI);
            ctx.fillStyle = ring.color + Math.round(alpha * 200).toString(16).padStart(2, '0');
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x, y, burstR + 4, 0, 2 * Math.PI);
            ctx.strokeStyle = ring.color + Math.round(alpha * 60).toString(16).padStart(2, '0');
            ctx.lineWidth = 2;
            ctx.stroke();
            return true;
        });
        orbitAnimId = requestAnimationFrame(draw);
    }
    if (orbitAnimId) cancelAnimationFrame(orbitAnimId);
    orbitAnimId = requestAnimationFrame(draw);
}

function triggerOrbitBurst(ringIndex) {
    const angle = Math.random() * 2 * Math.PI;
    orbitBursts.push({ ring: ringIndex, angle, born: performance.now() });
}

function initOrbitResize() {
    let timer;
    window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(startActivityOrbit, 200);
    });
}

// Start orbit after data loads
var origRecentSales = loadRecentSales;
loadRecentSales = async function() {
    await origRecentSales.apply(this, arguments);
    if (!document.getElementById('activityOrbit')) return;
    if (!orbitAnimId) {
        await loadOrbitRingData();
        startActivityOrbit();
        initOrbitResize();
    }
};
