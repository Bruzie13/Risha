let currentPage = 1;
const perPage = 20;
let totalLogs = 0;

// Loaded by reports.js when the Activity log tab is opened. It is admin-only,
// so fetching it on every page load only produced 403s for everyone else.

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
            const icon = action === 'create' || action === 'login' ? '<span class="material-symbols-outlined" style="font-size:16px;">add_circle</span>' : action === 'update' ? '<span class="material-symbols-outlined" style="font-size:16px;">edit</span>' : action === 'delete' ? '<span class="material-symbols-outlined" style="font-size:16px;">delete</span>' : action === 'restore' ? '<span class="material-symbols-outlined" style="font-size:16px;">restore_from_trash</span>' : '<span class="material-symbols-outlined" style="font-size:16px;">info</span>';
            const iconClass = action === 'create' || action === 'login' || action === 'restore' ? 'create' : action === 'update' ? 'update' : action === 'delete' ? 'delete' : 'info';
            const table = formatTableName(l.table_name);
            const userInfo = l.user_name ? ` by ${escHtml(l.user_name)}` : '';
            const detailHtml = buildDetailHtml(l);
            return `<div class="audit-item" role="button" tabindex="0" aria-expanded="false" onclick="toggleDetail(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDetail(this);}">
                <div class="audit-icon ${iconClass}">${icon}</div>
                <div class="audit-info">
                    <div class="audit-action">${table}${l.record_id ? ` <span class="audit-rec">#${escHtml(l.record_id)}</span>` : ''}</div>
                    <div class="audit-detail">${escHtml(formatAction(action))} on ${escHtml(l.table_name)}${userInfo}</div>
                    ${detailHtml}
                </div>
                <div class="audit-time">${formatTime(l.created_at)}<span class="audit-chevron material-symbols-outlined" aria-hidden="true">chevron_right</span></div>
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
    const map = { create: 'Created', update: 'Updated', delete: 'Deleted', restore: 'Restored from the Trash', login: 'Logged in' };
    return map[action] || action;
}

function formatTableName(name) {
    const map = {
        products: '<span class="material-symbols-outlined" style="font-size:13px;">inventory</span> Product',
        sales: '<span class="material-symbols-outlined" style="font-size:13px;">payments</span> Sale',
        purchase_orders: '<span class="material-symbols-outlined" style="font-size:13px;">assignment</span> Purchase Order',
        suppliers: '<span class="material-symbols-outlined" style="font-size:13px;">local_shipping</span> Supplier',
        users: '<span class="material-symbols-outlined" style="font-size:13px;">person</span> User',
        supplier_performance: '<span class="material-symbols-outlined" style="font-size:13px;">bar_chart</span> Supplier Performance',
        price_proposals: '<span class="material-symbols-outlined" style="font-size:13px;">sell</span> Price change',
        cash_reconciliations: '<span class="material-symbols-outlined" style="font-size:13px;">savings</span> End-of-day count',
        till_cash_moves: '<span class="material-symbols-outlined" style="font-size:13px;">currency_exchange</span> Cash in / out',
        till_openings: '<span class="material-symbols-outlined" style="font-size:13px;">point_of_sale</span> Starting cash',
        app_settings: '<span class="material-symbols-outlined" style="font-size:13px;">settings</span> Settings'
    };
    return map[name] || escHtml(name);
}

function parseJsonField(val) {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch(e) { return null; }
}

/* What a log line opens to: who, when and which record, then what changed
   (before and after), what was made, or what was removed, from the values
   the system recorded. Every line opens, so every line can be checked. */
const FIELD_LABELS = {
    sku: 'SKU', po_number: 'PO number', unit_price: 'Unit price', cost_price: 'Cost price', stock_quantity: 'Stock',
    reorder_level: 'Reorder level', max_stock_level: 'Max stock level', category_id: 'Category', supplier_id: 'Supplier',
    supplier_name: 'Supplier', unit_type: 'Sold by', expiration_date: 'Expiration date', image_url: 'Picture',
    is_active: 'Active', total_amount: 'Subtotal', final_amount: 'Total', discount: 'Discount %', payment_status: 'Status',
    payment_method: 'Payment', sale_number: 'Sale number', customer_name: 'Customer', customer_phone: 'Customer phone',
    staff_name: 'Cashier', items_count: 'Items', opening_cash: 'Starting cash', cash_in: 'Cash put in', cash_out: 'Cash taken out',
    counted: 'Cash counted', expected: 'Expected cash', discrepancy: 'Over / short', pos_max_discount_percent: 'Largest cashier discount (%)',
    contact_person: 'Contact person', payment_terms: 'Payment terms', full_name: 'Full name', stock_returned: 'Items returned to stock',
    sold_at: 'Sold at', voided: 'Voided', paid: 'Paid'
};
const MONEY_FIELD = /price|amount|cash|expected|counted|discrepancy|opening/;
const SKIP_FIELD = new Set(['id', 'created_at', 'updated_at', 'latitude', 'longitude', 'created_by']);
// counts kept as decimals in the database (10.000) are shown as plain numbers;
// codes such as barcodes and phone numbers are left exactly as written
const NUMBER_FIELD = new Set(['stock_quantity', 'reorder_level', 'max_stock_level', 'items_count', 'discount', 'quantity']);

/* 5.00 and 5 are the same amount: only a real difference counts as a change */
function sameValue(k, a, b) {
    const blank = v => v === null || v === undefined || v === '';
    if (blank(a) && blank(b)) return true;
    if ((MONEY_FIELD.test(k) || NUMBER_FIELD.has(k)) && !blank(a) && !blank(b) && isFinite(Number(a)) && isFinite(Number(b))) return Number(a) === Number(b);
    return String(a ?? '') === String(b ?? '');
}

function fieldLabel(k) { return FIELD_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' '); }

function fieldValue(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'image_url') return 'a picture';
    if (k === 'password') return 'changed';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if ((k === 'is_active' || k === 'voided' || k === 'paid' || k === 'stock_returned') && (v === 1 || v === 0)) return v ? 'Yes' : 'No';
    if (Array.isArray(v)) {
        const names = v.map(x => x && typeof x === 'object' ? [x.product_name || x.name, x.quantity != null ? '× ' + Number(x.quantity) : ''].filter(Boolean).join(' ') : String(x)).filter(Boolean);
        return names.length ? names.join(', ') : v.length + ' item(s)';
    }
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 140);
    if (MONEY_FIELD.test(k) && v !== '' && isFinite(Number(v))) return formatCurrency(Number(v));
    if (NUMBER_FIELD.has(k) && isFinite(Number(v))) return String(Number(v));
    const text = String(v);
    return text.length > 140 ? text.slice(0, 140) + '…' : text;
}

function fieldRows(obj) {
    return Object.keys(obj).filter(k => !SKIP_FIELD.has(k))
        .map(k => `<tr><th>${escHtml(fieldLabel(k))}</th><td>${escHtml(fieldValue(k, obj[k]))}</td></tr>`).join('');
}

function buildDetailHtml(log) {
    const newVal = parseJsonField(log.new_value);
    const oldVal = parseJsonField(log.old_value);
    const when = log.created_at ? new Date(Number(log.created_at)).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    let body = '';
    if (oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object') {
        const changed = Object.keys(newVal).filter(k => !SKIP_FIELD.has(k) && !sameValue(k, oldVal[k], newVal[k]));
        body = changed.length
            ? `<div class="audit-sub">What changed</div><table class="audit-table"><tr><th></th><th>Before</th><th>After</th></tr>`
                + changed.map(k => `<tr><th>${escHtml(fieldLabel(k))}</th><td>${escHtml(k === 'image_url' ? (oldVal[k] ? 'a picture' : '—') : fieldValue(k, oldVal[k]))}</td><td>${escHtml(k === 'image_url' ? 'a new picture' : fieldValue(k, newVal[k]))}</td></tr>`).join('')
                + '</table>'
            : '<p class="audit-none">Saved with no value changed.</p>';
    } else if (newVal && typeof newVal === 'object') {
        body = `<div class="audit-sub">${log.action === 'create' ? 'What was made' : 'Details'}</div><table class="audit-table">${fieldRows(newVal)}</table>`;
    } else if (oldVal && typeof oldVal === 'object') {
        body = `<div class="audit-sub">${log.action === 'delete' ? 'What was removed' : 'Details'}</div><table class="audit-table">${fieldRows(oldVal)}</table>`;
    } else {
        body = '<p class="audit-none">No more details were recorded for this.</p>';
    }
    const who = log.user_name ? escHtml(log.user_name) : 'The system';
    // clicking inside the details (to select text) leaves them open
    return `<div class="audit-detail-expand" style="display:none;" onclick="event.stopPropagation()">
        <p class="audit-who">${who} · ${escHtml(when)}${log.record_id ? ` · record #${escHtml(log.record_id)}` : ''}</p>
        ${body}
    </div>`;
}

function toggleDetail(el) {
    const expand = el.querySelector('.audit-detail-expand');
    if (!expand) return;
    const open = expand.style.display === 'none';
    expand.style.display = open ? 'block' : 'none';
    el.classList.toggle('is-open', open);
    el.setAttribute('aria-expanded', open ? 'true' : 'false');
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
