const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let allSuppliers = [];
let editingSupplierId = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    if (!canManage()) {
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
        showToast(couldNot('load suppliers', error), 'error');
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
    // one page back, mirroring Show more (it used to jump to the first page)
    displayCount = Math.max(0, displayCount - 2 * PAGE_SIZE);
    showMoreSuppliers();
}

function displaySuppliers(suppliers) {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;
    const viewer = !canManage();
    if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No suppliers found</td></tr>';
        updatePagination('supplierPagination', suppliers, displayCount, 'showMoreSuppliers', 'showLessSuppliers', PAGE_SIZE);
    if (window.fetchMotion && !fetchMotion.reduced) { tbody.classList.remove('rows-in'); void tbody.offsetWidth; tbody.classList.add('rows-in'); }
        return;
    }
    const paymentTermsMap = {
        'net15': 'Net 15',
        'net30': 'Net 30',
        'net60': 'Net 60',
        'due_on_receipt': 'Due on receipt'
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
            <td>${starCellHtml(s.stars, s.id)}</td>
            <td><button class="btn-action" onclick="showEmailLogs(${s.id}, '${escHtml(s.name).replace(/'/g, "\\'")}')" style="font-size:12px"><span class="material-symbols-outlined" style="font-size:13px;">mark_email_read</span> Emails</button></td>
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
    document.getElementById('supplierModalTitle').textContent = 'Add supplier';
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierModal').classList.add('active');
    if (typeof openSupplierPicker === 'function') openSupplierPicker(null, null);
}

function openEditSupplierModal(id) {
    if (!canManage()) { showToast("Your role can't edit suppliers.", 'error'); return; }
    editingSupplierId = id;
    const supplier = allSuppliers.find(s => s.id === id);
    if (!supplier) return;
    document.getElementById('supplierModalTitle').textContent = 'Edit supplier';
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

let supplierSaving = false;     // a save is on its way: a second press of Save is ignored

async function handleSupplierSubmit(event) {
    event.preventDefault();
    if (supplierSaving) return;
    const saveBtn = event.target.querySelector('button[type="submit"]');
    const saveLabel = saveBtn ? saveBtn.textContent : '';
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
    supplierSaving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
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
            showToast(result.message || 'The supplier was not saved', 'error');
            if (result.code === 'DUPLICATE_SUPPLIER') document.getElementById('name').focus();
        }
    } catch (error) {
        console.error('Error saving supplier:', error);
        showToast(couldNot('save supplier', error), 'error');
    } finally {
        supplierSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveLabel; }
    }
}

async function deleteSupplier(id) {
    if (!canManage()) { showToast("Your role can't delete suppliers.", 'error'); return; }
    /* Deleting a supplier does not delete what hangs off them. Their products
       stay in Inventory with no supplier, and cannot be reordered until one is
       assigned; an order still on its way has nobody left to deliver it. Say
       so before the question is answered, with the real numbers. */
    const supplier = (typeof allSuppliers !== 'undefined' ? allSuppliers : []).find(s => Number(s.id) === Number(id)) || {};
    const products = Number(supplier.product_count) || 0, orders = Number(supplier.open_orders) || 0;
    const left = [];
    if (products) left.push(`<strong>${products} product${products === 1 ? '' : 's'}</strong> will be left with no supplier and cannot be reordered until you assign one`);
    if (orders) left.push(`<strong>${orders} order${orders === 1 ? ' is' : 's are'} still in progress</strong> with this supplier`);
    const question = `Delete ${escHtml(supplier.name || 'this supplier')}? This cannot be undone.`
        + (left.length ? '<span style="display:block;margin-top:8px;">' + left.map(l => '<span style="display:block;margin-top:4px;">' + l + '.</span>').join('') + '</span>' : '');
    showConfirmDialog('Delete supplier', question, async () => {
        try {
            const response = await fetch(`${API_BASE}/suppliers/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                const leftSomething = !!(data.left && (data.left.products || data.left.open_orders));
                showSuccessDialog('Supplier deleted', escHtml(data.message || 'The supplier has been removed from your directory.'), { tone: 'danger', stay: leftSomething });
                await loadSuppliers();
            } else {
                showToast('Error: ' + (data.message || 'the server gave no reason'), 'error');
            }
        } catch (error) {
            console.error('Error deleting supplier:', error);
            showToast(couldNot('delete supplier', error), 'error');
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
            'Stock will be added. Enter the new batch\'s expiration date. Leave it blank only to keep a current date that has not passed yet:',
            function (dateVal) { sendModalAdvance(id, 'received', poNumber, supplierId, dateVal); },
            'Mark Received', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">inventory</span>', 'date', '',
            { min: earliestExpiryYmd(), validate: expiryDateProblem });
        return;
    }
    showConfirmDialog('Update purchase order', 'Mark ' + poNumber + ' as ' + nextStatus + '?',
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
            showErrorDialog('Could not update order', data.message || 'the server gave no reason');
        }
    } catch (e) { showToast(couldNot('update purchase order', e), 'error'); }
}

function emailPOFromModal(id, poNumber, supplierId) {
    showConfirmDialog('Email purchase order', 'Send ' + poNumber + ' to the supplier now?',
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
            showErrorDialog('Could not send email', data.message || 'the server gave no reason');
        }
    } catch (e) { showToast(couldNot('send email', e), 'error'); }
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
        if (!data.success) { showToast(couldNot('load performance data'), 'error'); return; }

        var rating = data.data.rating || {};
        var records = Array.isArray(data.data.records) ? data.data.records : [];

        // the star rating replaces the four figure cards
        var figures = document.getElementById('perfAvgDelivery');
        var grid = figures ? figures.closest('.stat-row') : null;
        var box = document.getElementById('perfStars');
        if (!box && grid) { box = document.createElement('div'); box.id = 'perfStars'; box.style.cssText = 'margin-bottom:14px;padding:12px 14px;background:var(--bg-raised);border-radius:10px;'; grid.parentNode.insertBefore(box, grid); }
        if (grid) grid.style.display = 'none';
        if (box) box.innerHTML = starRatingHtml(data.data.stars);

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
        showToast(couldNot('load performance data', e), 'error');
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
            po: { icon: 'receipt_long', cls: 'po', label: 'Purchase order' },
            low_stock: { icon: 'inventory_2', cls: 'low_stock', label: 'Low stock alert' },
            tracking: { icon: 'share_location', cls: 'tracking', label: 'Delivery tracking link' }
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

/* The supplier's star rating and the conditions behind it (utils/supply.js
   starRating on the server: the same rule the supplier sees on their page). */
/* The stars in the supplier list: the count, and whether the supplier meets
   the standard. A click opens the Performance window with the conditions. */
function starCellHtml(r, id) {
    if (!r) return '—';
    var stars = '';
    for (var i = 1; i <= 5; i++) stars += '<span style="color:' + (i <= r.stars ? '#E8A317' : 'var(--border-color, #c9c9c9)') + ';">' + (i <= r.stars ? '★' : '☆') + '</span>';
    var note = !r.rated ? 'Not rated yet' : r.meets_standard ? 'Meets the standard' : 'Below the standard';
    var tone = !r.rated ? 'var(--text-secondary)' : r.meets_standard ? 'var(--success)' : 'var(--warning)';
    return '<button type="button" class="star-btn" onclick="showPerformance(' + Number(id) + ')" title="' + String(r.summary || '').replace(/"/g, '&quot;') + ' Click for the conditions." aria-label="' + (r.rated ? r.stars + ' of 5 stars, ' : '') + note + '" style="background:none;border:0;padding:0;cursor:pointer;text-align:left;font:inherit;color:inherit;">'
        + '<span style="font-size:15px;letter-spacing:1px;white-space:nowrap;">' + stars + '</span>'
        + '<span class="star-note" style="display:block;font-size:11px;line-height:1.3;max-width:120px;color:' + tone + ';">' + (r.rated ? r.stars + ' of 5 · ' : '') + note + '</span></button>';
}

function starRatingHtml(r) {
    if (!r) return '';
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var stars = '';
    for (var i = 1; i <= 5; i++) stars += '<span style="color:' + (i <= r.stars ? '#E8A317' : 'var(--border-color, #c9c9c9)') + ';">' + (i <= r.stars ? '★' : '☆') + '</span>';
    var badge = !r.rated ? '<span class="status-badge" style="background:var(--bg-raised);color:var(--text-secondary);">Not rated yet</span>'
        : r.meets_standard ? '<span class="status-badge status-in-stock">Meets the standard</span>'
        : '<span class="status-badge status-low-stock">Below the standard</span>';
    var rows = (r.checks || []).map(function (c) {
        return '<li style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;"><span>' + (c.met ? '<span style="color:var(--success);">✓</span> ' : '<span style="color:var(--danger);">✗</span> ') + esc(c.label) + '</span><span style="color:var(--text-secondary);white-space:nowrap;">' + esc(c.value) + '</span></li>';
    }).join('');
    return '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><span style="font-size:26px;letter-spacing:2px;line-height:1;" aria-label="' + r.stars + ' of 5 stars">' + stars + '</span>' + badge + '</div>'
        + '<p style="margin:6px 0 8px;font-size:13px;">' + esc(r.summary) + '</p>'
        + (rows ? '<ul style="list-style:none;margin:0;padding:0;font-size:12.5px;">' + rows + '</ul>' : '')
        + '<p style="margin:8px 0 0;font-size:11.5px;color:var(--text-secondary);">One star for each line ticked. A supplier meets the standard at ' + r.standard + ' stars or more. Counted from orders received in the last 12 months.</p>';
}
