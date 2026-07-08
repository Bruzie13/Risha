let currentPage = 1;
const perPage = 20;
let totalLogs = 0;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await loadAuditLogs();
});

async function loadAuditLogs() {
    const actionFilter = document.getElementById('actionFilter').value;
    const tableFilter = document.getElementById('tableFilter').value;

    try {
        const params = new URLSearchParams();
        if (actionFilter) params.set('action', actionFilter);
        if (tableFilter) params.set('table_name', tableFilter);
        params.set('page', currentPage);
        params.set('limit', perPage);

        const url = `${API_BASE}/audit-logs?${params.toString()}`;
        const response = await fetch(url, { headers: getAuthHeaders() });
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Failed to load audit logs');
        }

        totalLogs = result.total;
        renderPage(currentPage, result.data);
    } catch (e) {
        console.error('Error loading audit logs:', e);
        document.getElementById('auditList').innerHTML = '<div class="text-center" style="padding:40px;">Failed to load audit logs</div>';
    }
}

function renderPage(page, logs) {
    currentPage = page;
    const pageItems = logs || [];
    const totalPages = Math.ceil(totalLogs / perPage) || 1;

    const list = document.getElementById('auditList');
    if (!pageItems.length) {
        list.innerHTML = '<div class="text-center" style="padding:40px;">No audit logs found</div>';
    } else {
        list.innerHTML = pageItems.map(l => {
            const action = l.action || 'info';
            const icon = action === 'create' || action === 'login' ? '<span class="material-symbols-outlined" style="font-size:16px;">add_circle</span>' : action === 'update' ? '<span class="material-symbols-outlined" style="font-size:16px;">edit</span>' : action === 'delete' ? '<span class="material-symbols-outlined" style="font-size:16px;">delete</span>' : '<span class="material-symbols-outlined" style="font-size:16px;">info</span>';
            const iconClass = action === 'create' || action === 'login' ? 'create' : action === 'update' ? 'update' : action === 'delete' ? 'delete' : 'info';
            const table = formatTableName(l.table_name);
            const userInfo = l.user_name ? ` by ${escHtml(l.user_name)}` : '';
            const detailHtml = buildDetailHtml(l);
            return `<div class="audit-item" onclick="toggleDetail(this)">
                <div class="audit-icon ${iconClass}">${icon}</div>
                <div class="audit-info">
                    <div class="audit-action">${table}${detailHtml ? ' <span style="font-size:10px;color:var(--primary);cursor:pointer;">▼</span>' : ''}</div>
                    <div class="audit-detail">${escHtml(formatAction(action))} on ${escHtml(l.table_name)}${userInfo}</div>
                    ${detailHtml}
                </div>
                <div class="audit-time">${formatTime(l.created_at)}</div>
            </div>`;
        }).join('');
    }

    const pagination = document.getElementById('pagination');
    let pHtml = `<button ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">‹ Prev</button>`;
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
        pHtml += `<button class="${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    pHtml += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">Next ›</button>`;
    pHtml += `<span style="font-size:12px;color:var(--text-muted);margin-left:8px;">${totalLogs} total</span>`;
    pagination.innerHTML = pHtml;
}

function formatAction(action) {
    const map = { create: 'Created', update: 'Updated', delete: 'Deleted', login: 'Logged in' };
    return map[action] || action;
}

function formatTableName(name) {
    const map = {
        products: '<span class="material-symbols-outlined" style="font-size:13px;">inventory</span> Product',
        sales: '<span class="material-symbols-outlined" style="font-size:13px;">payments</span> Sale',
        purchase_orders: '<span class="material-symbols-outlined" style="font-size:13px;">assignment</span> Purchase Order',
        suppliers: '<span class="material-symbols-outlined" style="font-size:13px;">local_shipping</span> Supplier',
        users: '<span class="material-symbols-outlined" style="font-size:13px;">person</span> User',
        supplier_performance: '<span class="material-symbols-outlined" style="font-size:13px;">bar_chart</span> Supplier Performance'
    };
    return map[name] || name;
}

function parseJsonField(val) {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch(e) { return null; }
}

function buildDetailHtml(log) {
    const newVal = parseJsonField(log.new_value);
    const oldVal = parseJsonField(log.old_value);
    if (!newVal && !oldVal) return '';

    const val = newVal || oldVal;
    if (val.po_number) {
        let h = `<div class="audit-detail-expand" style="display:none;margin-top:6px;padding:8px 10px;background:var(--gray-50);border-radius:6px;font-size:12px;line-height:1.6;">`;
        h += `<span class="material-symbols-outlined" style="font-size:13px;">assignment</span> <strong>PO:</strong> ${escHtml(val.po_number)}<br>`;
        if (val.supplier_name) h += `<span class="material-symbols-outlined" style="font-size:13px;">business</span> <strong>Supplier:</strong> ${escHtml(val.supplier_name)}<br>`;
        if (val.total_amount) h += `<span class="material-symbols-outlined" style="font-size:13px;">payments</span> <strong>Total:</strong> ${formatCurrency(val.total_amount)}<br>`;
        if (val.items_count) h += `<span class="material-symbols-outlined" style="font-size:13px;">inventory</span> <strong>Items:</strong> ${val.items_count}<br>`;
        if (val.status) h += `<span class="material-symbols-outlined" style="font-size:13px;">circle</span> <strong>Status:</strong> ${escHtml(val.status)}`;
        h += `</div>`;
        return h;
    }
    if (val.status && oldVal && oldVal.status) {
        let h = `<div class="audit-detail-expand" style="display:none;margin-top:6px;padding:8px 10px;background:var(--gray-50);border-radius:6px;font-size:12px;line-height:1.6;">`;
        if (val.po_number) h += `<span class="material-symbols-outlined" style="font-size:13px;">assignment</span> <strong>PO:</strong> ${escHtml(val.po_number)}<br>`;
        if (val.supplier_name) h += `<span class="material-symbols-outlined" style="font-size:13px;">business</span> <strong>Supplier:</strong> ${escHtml(val.supplier_name)}<br>`;
        h += `<span class="material-symbols-outlined" style="font-size:13px;">sync</span> <strong>Status:</strong> ${escHtml(oldVal.status)} → ${escHtml(val.status)}`;
        h += `</div>`;
        return h;
    }
    return '';
}

function toggleDetail(el) {
    const expand = el.querySelector('.audit-detail-expand');
    if (expand) expand.style.display = expand.style.display === 'none' ? 'block' : 'none';
}

function goToPage(page) {
    currentPage = page;
    loadAuditLogs();
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function refreshAudit() {
    currentPage = 1;
    loadAuditLogs();
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
