const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let allSuppliers = [];
let editingSupplierId = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    if (isViewer()) {
        document.querySelector('.page-header-actions .btn-primary')?.remove();
        const actionsTh = document.querySelector('.data-table thead th:last-child');
        if (actionsTh) actionsTh.textContent = '';
    }
    await loadSuppliers();
});

async function loadSuppliers() {
    try {
        const response = await fetch(`${API_BASE}/suppliers`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allSuppliers = Array.isArray(data.data) ? data.data : [];
            displaySuppliers(allSuppliers);
        }
    } catch (error) {
        console.error('Error loading suppliers:', error);
        showToast('Failed to load suppliers', 'error');
    }
}

function showMoreSuppliers() {
    displayCount += PAGE_SIZE;
    const term = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    const filtered = allSuppliers.filter(s =>
        (s.name || '').toLowerCase().includes(term) ||
        (s.contact_person || '').toLowerCase().includes(term) ||
        (s.email || '').toLowerCase().includes(term)
    );
    displaySuppliers(filtered);
}

function displaySuppliers(suppliers) {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;
    const viewer = isViewer();
    if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No suppliers found</td></tr>';
        updatePagination('supplierPagination', suppliers, displayCount, 'showMoreSuppliers');
        return;
    }
    const paymentTermsMap = {
        'net15': 'Net 15',
        'net30': 'Net 30',
        'net60': 'Net 60',
        'due_on_receipt': 'Due on Receipt'
    };
    document.getElementById('totalSuppliers').textContent = suppliers.length;
    document.getElementById('activeSuppliers').textContent = suppliers.filter(s => s.is_active === 1 || s.is_active === true).length;
    const shown = suppliers.slice(0, displayCount);
    tbody.innerHTML = shown.map(s => `
        <tr>
            <td><strong>${escHtml(s.name)}</strong></td>
            <td>${escHtml(s.contact_person || 'N/A')}</td>
            <td>${escHtml(s.email || 'N/A')}</td>
            <td>${escHtml(s.phone || 'N/A')}</td>
            <td>${paymentTermsMap[s.payment_terms] || 'Net 30'}</td>
            <td>${(s.is_active === 1 || s.is_active === true) ? '<span class="status-badge status-in-stock">Active</span>' : '<span class="status-badge status-expired">Inactive</span>'}</td>
            <td><button class="btn-view" onclick="showEmailLogs(${s.id}, '${escHtml(s.name).replace(/'/g, "\\'")}')" style="font-size:11px"><span class="material-symbols-outlined" style="font-size:13px;">mail</span> Emails</button></td>
            <td>
                <button class="btn-view" onclick="showPerformance(${s.id})">Performance</button>
                ${viewer ? '' : `<button class="btn-edit" onclick="openEditSupplierModal(${s.id})">Edit</button>
                <button class="btn-delete" onclick="deleteSupplier(${s.id})">Delete</button>`}
            </td>
        </tr>
    `).join('');
    updatePagination('supplierPagination', suppliers, displayCount, 'showMoreSuppliers');
}

// Search
document.getElementById('searchInput')?.addEventListener('keyup', (e) => {
    displayCount = PAGE_SIZE;
    const term = e.target.value.toLowerCase();
    const filtered = allSuppliers.filter(s =>
        (s.name || '').toLowerCase().includes(term) ||
        (s.contact_person || '').toLowerCase().includes(term) ||
        (s.email || '').toLowerCase().includes(term)
    );
    displaySuppliers(filtered);
});

function openAddSupplierModal() {
    if (isViewer()) { showToast('View-only account. Cannot add suppliers.', 'error'); return; }
    editingSupplierId = null;
    document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierModal').classList.add('active');
}

function openEditSupplierModal(id) {
    if (isViewer()) { showToast('View-only account. Cannot edit suppliers.', 'error'); return; }
    editingSupplierId = id;
    const supplier = allSuppliers.find(s => s.id === id);
    if (!supplier) return;
    document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
    document.getElementById('name').value = supplier.name || '';
    document.getElementById('contact_person').value = supplier.contact_person || '';
    document.getElementById('email').value = supplier.email || '';
    document.getElementById('phone').value = supplier.phone || '';
    document.getElementById('address').value = supplier.address || '';
    document.getElementById('city').value = supplier.city || '';
    document.getElementById('payment_terms').value = supplier.payment_terms || 'net30';
    document.getElementById('supplierModal').classList.add('active');
}

function closeSupplierModal() {
    document.getElementById('supplierModal').classList.remove('active');
    editingSupplierId = null;
}

async function handleSupplierSubmit(event) {
    event.preventDefault();
    const data = {
        name: document.getElementById('name').value,
        contact_person: document.getElementById('contact_person').value || null,
        email: document.getElementById('email').value || null,
        phone: document.getElementById('phone').value || null,
        address: document.getElementById('address').value || null,
        city: document.getElementById('city').value || null,
        payment_terms: document.getElementById('payment_terms').value || 'net30'
    };
    try {
        let response;
        if (editingSupplierId) {
            response = await fetch(`${API_BASE}/suppliers/${editingSupplierId}`, {
                method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(data)
            });
        } else {
            response = await fetch(`${API_BASE}/suppliers`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(data)
            });
        }
        const result = await response.json();
        if (result.success) {
            showToast(editingSupplierId ? 'Supplier updated!' : 'Supplier added!', 'success');
            closeSupplierModal();
            await loadSuppliers();
        } else {
            showToast('Error: ' + (result.message || 'Unknown'), 'error');
        }
    } catch (error) {
        console.error('Error saving supplier:', error);
        showToast('Failed to save supplier', 'error');
    }
}

async function deleteSupplier(id) {
    if (isViewer()) { showToast('View-only account. Cannot delete suppliers.', 'error'); return; }
    showConfirmDialog('Delete Supplier', 'Are you sure you want to delete this supplier? This cannot be undone.', async () => {
        try {
            const response = await fetch(`${API_BASE}/suppliers/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showToast('Supplier deleted!', 'success');
                await loadSuppliers();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Error deleting supplier:', error);
            showToast('Failed to delete supplier', 'error');
        }
    }, 'Yes, Delete', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete</span>');
}

// ===== Performance Scorecard =====
async function showPerformance(supplierId) {
    var supplier = allSuppliers.find(function(s) { return s.id === supplierId; });
    if (!supplier) return;
    document.getElementById('perfSupplierName').textContent = supplier.name || 'Supplier';
    document.getElementById('performanceModal').classList.add('active');

    document.getElementById('perfAvgDelivery').textContent = '…';
    document.getElementById('perfOnTime').textContent = '…';
    document.getElementById('perfDeliveries').textContent = '…';
    document.getElementById('perfOrders').textContent = '…';

    try {
        var res = await fetch(API_BASE + '/suppliers/' + supplierId + '/performance', { headers: getAuthHeaders() });
        var data = await res.json();
        if (!data.success) { showToast('Failed to load performance data', 'error'); return; }

        var rating = data.data.rating || {};
        document.getElementById('perfAvgDelivery').textContent = rating.avg_delivery_days != null ? rating.avg_delivery_days + 'd' : '—';
        document.getElementById('perfOnTime').textContent = rating.on_time_delivery_pct != null ? rating.on_time_delivery_pct + '%' : '—';
        document.getElementById('perfDeliveries').textContent = rating.total_deliveries || '0';
        document.getElementById('perfOrders').textContent = rating.total_orders || '0';

        var perfAvgEl = document.getElementById('perfAvgDelivery');
        if (rating.avg_delivery_days != null) {
            perfAvgEl.className = 'mini-stat-value ' + (parseFloat(rating.avg_delivery_days) > 5 ? 'danger' : 'success');
        } else {
            perfAvgEl.className = 'mini-stat-value';
        }
        var perfOnTimeEl = document.getElementById('perfOnTime');
        if (rating.on_time_delivery_pct != null) {
            perfOnTimeEl.className = 'mini-stat-value ' + (parseFloat(rating.on_time_delivery_pct) < 70 ? 'danger' : (parseFloat(rating.on_time_delivery_pct) < 85 ? 'warning' : 'success'));
        } else {
            perfOnTimeEl.className = 'mini-stat-value';
        }

        var records = Array.isArray(data.data.records) ? data.data.records : [];
        var tbody = document.getElementById('perfRecordsBody');
        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No performance data yet</td></tr>';
        } else {
            tbody.innerHTML = records.map(function(r) {
                var metricLabel = r.metric_type === 'delivery_time' ? 'Delivery Time'
                    : r.metric_type === 'on_time_delivery' ? 'On-Time'
                    : r.metric_type;
                var valueClass = r.metric_type === 'on_time_delivery'
                    ? (r.metric_value == 1 ? 'status-badge status-completed' : 'status-badge status-expired')
                    : '';
                var valueDisplay = r.metric_type === 'on_time_delivery'
                    ? (r.metric_value == 1 ? 'On Time' : 'Late')
                    : r.metric_value + (r.metric_type === 'delivery_time' ? ' days' : '');
                return '<tr>'
                    + '<td>' + escHtml(r.po_number || '—') + '</td>'
                    + '<td>' + escHtml(metricLabel) + '</td>'
                    + '<td>' + (valueClass ? '<span class="' + valueClass + '">' + escHtml(valueDisplay) + '</span>' : escHtml(valueDisplay)) + '</td>'
                    + '<td>' + escHtml(r.notes || '') + '</td>'
                    + '<td>' + (r.created_at ? new Date(r.created_at).toLocaleDateString() : '') + '</td>'
                    + '</tr>';
            }).join('');
        }
    } catch (e) {
        console.error('Performance load error:', e);
        showToast('Error loading performance data', 'error');
    }
}

function closePerformanceModal() {
    document.getElementById('performanceModal').classList.remove('active');
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('supplierModal')) closeSupplierModal();
    if (e.target === document.getElementById('performanceModal')) closePerformanceModal();
    if (e.target === document.getElementById('emailLogsModal')) closeEmailLogsModal();
});

/* ═══ Email Logs ═══ */
async function showEmailLogs(supplierId, supplierName) {
    const modal = document.getElementById('emailLogsModal');
    const body = document.getElementById('emailLogsBody');
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">Loading...</div>';
    modal.classList.add('active');
    document.getElementById('emailLogsTitle').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">mail</span> Email History — ' + escHtml(supplierName);

    try {
        const res = await fetch(`${API_BASE}/email-logs/${supplierId}`, { headers: getAuthHeaders() });
        const result = await res.json();
        const logs = result.data || [];

        if (!logs.length) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No emails sent to this supplier yet</div>';
            return;
        }

        body.innerHTML = '<table style="width:100%;border-collapse:collapse"><thead><tr>' +
            '<th style="padding:10px;text-align:left;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-glass)">Subject</th>' +
            '<th style="padding:10px;text-align:left;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-glass)">Type</th>' +
            '<th style="padding:10px;text-align:left;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-glass)">Sent</th>' +
            '<th style="padding:10px;text-align:center;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-glass)">Status</th>' +
            '<th style="padding:10px;text-align:center;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-glass)">Opened</th>' +
            '</tr></thead><tbody>' +
            logs.map(l => {
                const opened = l.opened_at ? true : false;
                const sentDate = new Date(l.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                const openedDate = l.opened_at ? new Date(l.opened_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                const typeLabels = { po: '<span class="material-symbols-outlined" style="font-size:13px;">inventory</span> Purchase Order', low_stock: '<span class="material-symbols-outlined" style="font-size:13px;">inventory_2</span> Low Stock Alert' };
                return '<tr style="border-bottom:1px solid var(--border-glass)">' +
                    '<td style="padding:10px;font-size:13px;font-weight:500">' + escHtml(l.subject || 'N/A') + '</td>' +
                    '<td style="padding:10px;font-size:12px">' + (typeLabels[l.email_type] || escHtml(l.email_type)) + '</td>' +
                    '<td style="padding:10px;font-size:12px;color:var(--text-muted)">' + sentDate + '</td>' +
                    '<td style="padding:10px;text-align:center">' + emailStatusBadge(l, opened) + '</td>' +
                    '<td style="padding:10px;text-align:center;font-size:12px;color:var(--text-muted)">' + (openedDate || '—') + (l.opened_count > 1 ? ' <span style="color:var(--primary);font-weight:600">(' + l.opened_count + 'x)</span>' : '') + '</td>' +
                '</tr>';
            }).join('') +
            '</tbody></table>';
    } catch (e) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Failed to load email history</div>';
    }
}

function emailStatusBadge(l, opened) {
    const badge = (bg, color, icon, label, title) =>
        '<span title="' + escHtml(title || '') + '" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;background:' + bg + ';color:' + color + '"><span class="material-symbols-outlined" style="font-size:14px;">' + icon + '</span> ' + label + '</span>';
    if (l.status === 'failed') return badge('var(--danger-bg, #fdecea)', 'var(--danger)', 'error', 'Failed', l.error_message || 'Delivery failed');
    if (l.status === 'skipped') return badge('var(--warning-bg, #fff8e1)', 'var(--warning, #e65100)', 'block', 'Skipped', l.error_message || 'Email sending disabled');
    if (opened) return badge('var(--success-bg)', 'var(--success)', 'check', 'Read');
    return badge('var(--accent-dim)', 'var(--accent)', 'hourglass_bottom', 'Sent');
}

function closeEmailLogsModal() {
    document.getElementById('emailLogsModal').classList.remove('active');
}
