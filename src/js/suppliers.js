const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let allSuppliers = [];
let editingSupplierId = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    if (!canManage()) {
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
            if (typeof renderSupplierMap === 'function') renderSupplierMap(allSuppliers);
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

function showLessSuppliers() {
    displayCount = 0;
    showMoreSuppliers();
}

function displaySuppliers(suppliers) {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;
    const viewer = !canManage();
    if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No suppliers found</td></tr>';
        updatePagination('supplierPagination', suppliers, displayCount, 'showMoreSuppliers', 'showLessSuppliers', PAGE_SIZE);
    if (window.fetchMotion && !fetchMotion.reduced) { tbody.classList.remove('rows-in'); void tbody.offsetWidth; tbody.classList.add('rows-in'); }
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
    tbody.innerHTML = shown.map(s => {
        const initials = (s.name || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        const tint = (s.id % 5) + 1;
        return `
        <tr>
            <td>
                <div class="cell-product">
                    <div class="cp-avatar tint-${tint}">${initials}</div>
                    <div class="cp-info">
                        <div class="cp-name">${escHtml(s.name)}</div>
                        ${s.city ? `<div class="cp-sub">${escHtml(s.city)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td>${escHtml(s.contact_person || 'N/A')}</td>
            <td>${s.email
                ? `<span class="supplier-email-link" onclick="showEmailLogs(${s.id}, '${escHtml(s.name).replace(/'/g, "\\'")}')" title="View email history & read receipts">${escHtml(s.email)}</span>`
                : 'N/A'}</td>
            <td>${escHtml(s.phone || 'N/A')}</td>
            <td>${paymentTermsMap[s.payment_terms] || 'Net 30'}</td>
            <td>${(s.is_active === 1 || s.is_active === true) ? '<span class="status-badge status-active">Active</span>' : '<span class="status-badge status-inactive">Inactive</span>'}</td>
            <td><button class="btn-action" onclick="showEmailLogs(${s.id}, '${escHtml(s.name).replace(/'/g, "\\'")}')" style="font-size:11px"><span class="material-symbols-outlined" style="font-size:13px;">mark_email_read</span> Emails</button></td>
            <td>
                <button class="btn-view" onclick="showPerformance(${s.id})">Performance</button>
                ${viewer ? '' : `<button class="btn-edit" onclick="openEditSupplierModal(${s.id})">Edit</button>
                <button class="btn-delete" onclick="deleteSupplier(${s.id})">Delete</button>`}
            </td>
        </tr>
    `;
    }).join('');
    updatePagination('supplierPagination', suppliers, displayCount, 'showMoreSuppliers', 'showLessSuppliers', PAGE_SIZE);
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
    if (!canManage()) { showToast("Your role can't add suppliers.", 'error'); return; }
    editingSupplierId = null;
    document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierModal').classList.add('active');
    if (typeof openSupplierPicker === 'function') openSupplierPicker(null, null);
}

function openEditSupplierModal(id) {
    if (!canManage()) { showToast("Your role can't edit suppliers.", 'error'); return; }
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
    if (typeof openSupplierPicker === 'function') {
        openSupplierPicker(
            supplier.latitude == null ? null : Number(supplier.latitude),
            supplier.longitude == null ? null : Number(supplier.longitude)
        );
    }
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
        payment_terms: document.getElementById('payment_terms').value || 'net30',
        // empty string clears an existing pin; the server treats '' as NULL
        latitude: document.getElementById('latitude').value || null,
        longitude: document.getElementById('longitude').value || null
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
            showSuccessDialog(
                editingSupplierId ? 'Supplier updated' : 'Supplier added',
                editingSupplierId ? 'The supplier details have been saved.' : 'The new supplier is ready for purchase orders.',
                { icon: 'local_shipping' }
            );
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
    if (!canManage()) { showToast("Your role can't delete suppliers.", 'error'); return; }
    showConfirmDialog('Delete Supplier', 'Are you sure you want to delete this supplier? This cannot be undone.', async () => {
        try {
            const response = await fetch(`${API_BASE}/suppliers/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showSuccessDialog('Supplier deleted', 'The supplier has been removed from your directory.', { tone: 'danger' });
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
function perfNextStep(status) {
    switch (status) {
        case 'pending': return { status: 'confirmed', label: 'Confirm' };
        case 'confirmed': return { status: 'shipped', label: 'Shipped' };
        case 'shipped': return { status: 'received', label: 'Receive' };
        default: return null;
    }
}

function advancePOFromModal(id, nextStatus, poNumber, supplierId) {
    if (nextStatus === 'received') {
        showPromptDialog('Receive ' + poNumber,
            'Stock will be added. Enter the new batch\'s expiration date (leave blank to keep the current date):',
            function (dateVal) { sendModalAdvance(id, 'received', poNumber, supplierId, dateVal); },
            'Mark Received', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">inventory</span>', 'date', '');
        return;
    }
    showConfirmDialog('Update Purchase Order', 'Mark ' + poNumber + ' as ' + nextStatus + '?',
        function () { sendModalAdvance(id, nextStatus, poNumber, supplierId, ''); },
        'Yes, Update', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">local_shipping</span>');
}

async function sendModalAdvance(id, nextStatus, poNumber, supplierId, expiration_date) {
    try {
        var body = { status: nextStatus };
        if (expiration_date) body.expiration_date = expiration_date;
        var res = await fetch(API_BASE + '/purchase-orders/' + id + '/status', {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body)
        });
        var data = await res.json();
        if (data.success) {
            var note = nextStatus === 'received'
                ? (expiration_date ? poNumber + ' received — stock added, expiration set to ' + expiration_date + '.' : poNumber + ' received — stock updated and performance recorded.')
                : poNumber + ' is now ' + nextStatus + '.';
            showSuccessDialog('Order updated', note, { icon: nextStatus === 'received' ? 'inventory' : 'local_shipping' });
            showPerformance(supplierId);
        } else {
            showErrorDialog('Could not update order', data.message || 'Unknown error');
        }
    } catch (e) { showToast('Failed to update purchase order', 'error'); }
}

function emailPOFromModal(id, poNumber, supplierId) {
    showConfirmDialog('Email Purchase Order', 'Send ' + poNumber + ' to the supplier now?',
        function () { sendPOEmailNow(id, poNumber, supplierId); },
        'Yes, Send Email', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">mail</span>');
}

async function sendPOEmailNow(id, poNumber, supplierId) {
    try {
        var res = await fetch(API_BASE + '/purchase-orders/' + id + '/send-email', {
            method: 'POST', headers: getAuthHeaders()
        });
        var data = await res.json();
        if (data.success) {
            showSuccessDialog('Email sent', data.message || (poNumber + ' was emailed to the supplier.'), { icon: 'mail' });
            showPerformance(supplierId);
        } else {
            showErrorDialog('Could not send email', data.message || 'Unknown error');
        }
    } catch (e) { showToast('Failed to send email', 'error'); }
}

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
        var records = Array.isArray(data.data.records) ? data.data.records : [];

        // honest empty state when the supplier has no purchase orders
        var empty = document.getElementById('perfEmpty');
        if (!rating.has_orders) {
            if (empty) empty.style.display = 'block';
            document.getElementById('perfAvgDelivery').textContent = '—';
            document.getElementById('perfOnTime').textContent = '—';
            document.getElementById('perfDeliveries').textContent = '0';
            document.getElementById('perfOrders').textContent = '0';
            document.getElementById('perfRecordsBody').innerHTML = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        // Fulfillment rate (received / non-cancelled orders)
        var fEl = document.getElementById('perfAvgDelivery');
        fEl.textContent = rating.fulfillment_pct != null ? rating.fulfillment_pct + '%' : '—';
        fEl.className = 'stat-value ' + (rating.fulfillment_pct == null ? '' : rating.fulfillment_pct >= 85 ? 'success' : rating.fulfillment_pct >= 60 ? 'warning' : 'danger');
        // Avg lead time (order → received)
        var lEl = document.getElementById('perfOnTime');
        lEl.textContent = rating.avg_delivery_days != null ? rating.avg_delivery_days + 'd' : '—';
        lEl.className = 'stat-value ' + (rating.avg_delivery_days == null ? '' : rating.avg_delivery_days <= 7 ? 'success' : rating.avg_delivery_days <= 14 ? 'warning' : 'danger');
        // Orders received / total
        document.getElementById('perfDeliveries').textContent = rating.total_deliveries || '0';
        document.getElementById('perfOrders').textContent = rating.total_orders || '0';

        // supplier acknowledgement summary (from tracked PO emails)
        var note = document.getElementById('perfConfirmNote');
        if (note) {
            var parts = [];
            if (rating.confirmation_pct != null) {
                parts.push('<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;color:var(--success);">verified</span> Supplier confirmed <strong>' + rating.confirmed_count + ' of ' + rating.total_orders + '</strong> order(s) (' + rating.confirmation_pct + '%)');
            }
            if (rating.received_unconfirmed > 0) {
                parts.push('<span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;color:var(--warning);">warning_amber</span> <strong>' + rating.received_unconfirmed + '</strong> received without the supplier confirming the order');
            }
            note.innerHTML = parts.join(' &nbsp;·&nbsp; ');
            note.style.display = parts.length ? 'block' : 'none';
        }


        var tbody = document.getElementById('perfRecordsBody');
        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No purchase orders yet</td></tr>';
        } else {
            var STATUS = {
                received: 'status-badge status-completed',
                shipped: 'status-badge status-info',
                pending: 'status-badge status-pending',
                cancelled: 'status-badge status-expired'
            };
            tbody.innerHTML = records.map(function(r) {
                var cls = STATUS[r.status] || 'status-badge';
                var lead = (r.status === 'received' && r.lead_days != null && r.lead_days >= 0) ? r.lead_days + ' days' : '—';
                var val = '\u20b1' + Number(r.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                var ordered = r.order_date ? new Date(r.order_date).toLocaleDateString() : (r.created_at ? new Date(r.created_at).toLocaleDateString() : '—');
                // confirmation: clicked confirm = confirmed, opened only = viewed, neither = awaiting
                var confirm = r.confirmed == 1
                    ? '<span style="color:var(--success);font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">check_circle</span> Confirmed</span>'
                    : r.viewed == 1
                        ? '<span style="color:var(--info);font-weight:600;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">visibility</span> Viewed</span>'
                        : '<span style="color:var(--text-muted);"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">schedule</span> Awaiting</span>';
                // flag the risky case: goods received but supplier never confirmed
                var flag = (r.status === 'received' && r.confirmed != 1)
                    ? ' <span title="Received without supplier confirmation" style="color:var(--warning);"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">warning_amber</span></span>'
                    : '';
                var next = perfNextStep(r.status);
                var advance = (next && canManage())
                    ? ' <button class="po-advance-btn" onclick="advancePOFromModal(' + r.id + ', \'' + next.status + '\', \'' + escHtml(r.po_number || ('#' + r.id)) + '\', ' + supplierId + ')">' + next.label + '</button>'
                    : '';
                // manual supplier email (reorders no longer send it automatically)
                var email = canManage()
                    ? ' <button class="po-email-btn" onclick="emailPOFromModal(' + r.id + ', \'' + escHtml(r.po_number || ('#' + r.id)) + '\', ' + supplierId + ')" title="Email this purchase order to the supplier"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">mail</span> Email</button>'
                    : '';
                return '<tr>'
                    + '<td>' + escHtml(r.po_number || ('#' + r.id)) + '</td>'
                    + '<td><span class="' + cls + '">' + escHtml(r.status) + '</span>' + flag + advance + email + '</td>'
                    + '<td>' + confirm + '</td>'
                    + '<td style="font-variant-numeric:tabular-nums;">' + val + '</td>'
                    + '<td>' + lead + '</td>'
                    + '<td>' + ordered + '</td>'
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

/* ═══ Email Logs — sent / read tracking ═══ */
async function showEmailLogs(supplierId, supplierName) {
    const modal = document.getElementById('emailLogsModal');
    const body = document.getElementById('emailLogsBody');
    if (!modal || !body) return;
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">Loading...</div>';
    modal.classList.add('active');
    document.getElementById('emailLogsTitle').innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">mark_email_read</span> Email History — ' + escHtml(supplierName);

    try {
        const res = await fetch(`${API_BASE}/email-logs/${supplierId}`, { headers: getAuthHeaders() });
        const result = await res.json();
        const logs = result.data || [];

        if (!logs.length) {
            body.innerHTML = `<div class="empty-state" style="padding:48px 20px;">
                <span class="material-symbols-outlined" style="font-size:42px;color:var(--gray-300);display:block;margin-bottom:10px;">outgoing_mail</span>
                <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">No emails yet</div>
                <div>Purchase orders and low-stock alerts sent to this supplier will appear here.</div>
            </div>`;
            return;
        }

        const isRead = l => !!(l.opened_at || l.clicked_at);
        const total = logs.length;
        const delivered = logs.filter(l => l.status === 'sent' || isRead(l)).length;
        const readCount = logs.filter(isRead).length;
        const failed = logs.filter(l => l.status === 'failed' || l.status === 'skipped').length;

        const summary = `<div class="email-summary-row">
            <div class="email-summary-cell"><div class="es-num">${total}</div><div class="es-label">Total</div></div>
            <div class="email-summary-cell"><div class="es-num">${delivered}</div><div class="es-label">Delivered</div></div>
            <div class="email-summary-cell reads"><div class="es-num">${readCount}</div><div class="es-label">Read</div></div>
            <div class="email-summary-cell fails"><div class="es-num">${failed}</div><div class="es-label">Failed</div></div>
        </div>`;

        const typeMeta = {
            po: { icon: 'receipt_long', cls: 'po', label: 'Purchase Order' },
            low_stock: { icon: 'inventory_2', cls: 'low_stock', label: 'Low Stock Alert' },
            tracking: { icon: 'share_location', cls: 'tracking', label: 'Delivery Tracking Link' }
        };

        body.innerHTML = summary + '<div class="email-log-list">' + logs.map(l => {
            const read = isRead(l);
            const meta = typeMeta[l.email_type] || { icon: 'mail', cls: 'generic', label: l.email_type || 'Email' };
            const sentDate = new Date(l.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const readVia = l.clicked_at ? 'clicked the email' : 'opened the email';
            const readDate = read ? new Date(l.clicked_at || l.opened_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            const ticks = read
                ? '<span class="ticks read" title="Read by supplier">✓✓</span>'
                : (l.status === 'sent' ? '<span class="ticks sent" title="Delivered, not read yet">✓</span>' : '');
            return `<div class="email-log-item">
                <div class="el-icon ${meta.cls}"><span class="material-symbols-outlined" style="font-size:18px;">${meta.icon}</span></div>
                <div class="el-main">
                    <div class="el-subject">${escHtml(l.subject || 'N/A')}</div>
                    <div class="el-meta">
                        <span>${meta.label}</span> · <span>Sent ${sentDate}</span>
                        ${read ? `· <span style="color:var(--success);font-weight:600;">Supplier ${readVia} ${readDate}${l.opened_count > 1 ? ' (' + l.opened_count + '×)' : ''}</span>` : ''}
                        ${l.status === 'failed' && l.error_message ? `· <span style="color:var(--danger);">${escHtml(l.error_message)}</span>` : ''}
                    </div>
                </div>
                <div class="el-status">
                    ${emailStatusBadge(l, read)}
                    ${ticks}
                </div>
            </div>`;
        }).join('') + '</div>';
    } catch (e) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Failed to load email history</div>';
    }
}

function emailStatusBadge(l, read) {
    if (l.status === 'failed') return '<span class="status-badge status-failed" title="' + escHtml(l.error_message || 'Delivery failed') + '">Failed</span>';
    if (l.status === 'skipped') return '<span class="status-badge status-pending" title="' + escHtml(l.error_message || 'Email sending disabled') + '">Skipped</span>';
    if (read) return '<span class="status-badge status-read">Read</span>';
    if (l.status === 'sent') return '<span class="status-badge status-sent">Sent</span>';
    return '<span class="status-badge status-pending">Pending</span>';
}

function closeEmailLogsModal() {
    document.getElementById('emailLogsModal').classList.remove('active');
}
