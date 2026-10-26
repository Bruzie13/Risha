function getUnitLabel(unitType) {
    const labels = { piece: '', kg: ' kg', g: ' g', liter: ' L', ml: ' mL' };
    return labels[unitType] || '';
}

const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let allSales = [];
let viewingSaleId = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await loadSales();
    setSalesDateBounds();
    // Live refresh: sales made on other terminals appear without a reload
    setInterval(refreshSalesLive, 10000);
});

// Search + date range are applied on the server; allSales only holds the pages
// fetched so far for the current query.
let salesTotal = 0;
let salesSearchDebounce = null;

function salesQuery() {
    const params = new URLSearchParams();
    const search = document.getElementById('searchInput')?.value?.trim();
    const from = document.getElementById('dateFrom')?.value;
    const to = document.getElementById('dateTo')?.value;
    if (search) params.set('search', search);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    return params;
}

// reset=true refetches page 1 for the current query; reset=false appends the
// next page (Show more).
async function loadSales(reset = true) {
    try {
        if (reset) displayCount = PAGE_SIZE;
        const params = salesQuery();
        params.set('limit', Math.max(displayCount - (reset ? 0 : allSales.length), PAGE_SIZE));
        params.set('offset', reset ? 0 : allSales.length);
        const response = await fetch(`${API_BASE}/sales?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allSales = reset ? (data.data || []) : allSales.concat(data.data || []);
            salesTotal = data.total ?? allSales.length;
            displaySales(allSales);
            updateStats();
        } else if (reset && data.message) {
            showToast(data.message, 'warning');
        }
    } catch (error) {
        console.error('Error loading sales:', error);
        const tbody = document.getElementById('salesTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Failed to load sales</td></tr>';
    }
}

async function showMoreSales() {
    displayCount += PAGE_SIZE;
    if (allSales.length < Math.min(displayCount, salesTotal)) {
        await loadSales(false);
    } else {
        displaySales(allSales);
    }
}

function showLessSales() {
    // one page back, mirroring Show more (it used to jump to the first page)
    displayCount = Math.max(0, displayCount - 2 * PAGE_SIZE);
    showMoreSales();
}

// Poll for new/voided sales; refetch the visible page(s) of the current query
// only when the list actually changed, preserving search and rows shown.
async function refreshSalesLive() {
    if (document.hidden) return;
    try {
        const params = salesQuery();
        params.set('limit', Math.max(allSales.length, PAGE_SIZE));
        params.set('offset', 0);
        const response = await fetch(`${API_BASE}/sales?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (!data.success || !Array.isArray(data.data)) return;
        const fresh = data.data;
        const fingerprint = list => list.map(s => `${s.id}:${s.payment_status}`).join(',');
        if (fingerprint(fresh) === fingerprint(allSales)) return;
        allSales = fresh;
        salesTotal = data.total ?? allSales.length;
        displaySales(allSales);
        updateStats();
    } catch (e) {
        // Network hiccup — next poll retries.
    }
}

function displaySales(sales) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;
    const viewer = !canManage(); // delete is admin/manager-only
    if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No sales found</td></tr>';
        updatePagination('salesPagination', { length: salesTotal }, displayCount, 'showMoreSales', 'showLessSales', PAGE_SIZE);
    if (window.fetchMotion && !fetchMotion.reduced) { tbody.classList.remove('rows-in'); void tbody.offsetWidth; tbody.classList.add('rows-in'); }
        return;
    }
    const shown = sales.slice(0, displayCount);
    tbody.innerHTML = shown.map(s => `
        <tr>
            <td>#${s.id}</td>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
            <td>${escHtml(s.customer_name || 'Walk-in')}</td>
            <td>${escHtml(s.staff_name || 'N/A')}</td>
            <td>${s.item_count || 0}</td>
            <td>${formatCurrency(parseFloat(s.final_amount ?? s.total_amount ?? 0))}</td>
            <td>${escHtml(s.payment_method || 'N/A')}</td>
            <td>${s.payment_status === 'completed'
                ? '<span class="status-badge status-in-stock">Completed</span>'
                : s.payment_status === 'voided'
                    ? '<span class="status-badge status-expired" title="Voided — stock was restored">Voided</span>'
                    : '<span class="status-badge status-expired">' + escHtml(s.payment_status || 'N/A') + '</span>'}</td>
            <td>
                <button class="btn-view" onclick="viewSaleDetails(${s.id})">View</button>
                ${viewer || s.payment_status === 'voided' ? '' : `<button class="btn-delete" onclick="voidSale(${s.id})">Void</button>`}
                ${getUserRole() === 'admin' ? `<button class="btn-delete" onclick="deleteSale(${s.id})" title="Delete sale" aria-label="Delete sale #${escAttr(s.sale_number || s.id)}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>` : ''}
            </td>
        </tr>
    `).join('');
    updatePagination('salesPagination', { length: salesTotal }, displayCount, 'showMoreSales', 'showLessSales', PAGE_SIZE);
}

// Void: restores stock, keeps the record with a Voided badge (audit-friendly)
function voidSale(id) {
    if (!canManage()) { showToast("Your role can't void sales.", 'error'); return; }
    showPromptDialog(
        'Void Sale #' + id,
        'The sale stays in history marked as voided and its items return to stock. Why is it being voided?',
        async (reason) => {
            if (!reason || !reason.trim()) { showToast('A reason is required to void a sale', 'error'); return; }
            try {
                const res = await fetch(`${API_BASE}/sales/${id}/void`, {
                    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ reason: reason.trim() })
                });
                const data = await res.json();
                if (data.success) {
                    showSuccessDialog('Sale voided', 'The sale was marked voided and its stock has been restored.', { tone: 'danger', icon: 'undo' });
                    await loadSales();
                    await updateStats();
                } else {
                    showErrorDialog('Could not void sale', data.message || 'the server gave no reason');
                }
            } catch (e) {
                showToast(couldNot('void sale', e), 'error');
            }
        },
        'Void Sale',
        '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">undo</span>',
        'text', ''
    );
}

// ---- End-of-day cash reconciliation ----

async function openEodModal() {
    const modal = document.getElementById('eodModal');
    if (!modal) return;
    modal.classList.add('active');
    const dateInput = document.getElementById('eodDate');
    // local calendar day (toISOString() is UTC and reads as yesterday before 8am here);
    // a day that has not come yet cannot be counted, so the picker stops at today
    dateInput.max = localTodayYmd();
    if (!dateInput.value) dateInput.value = localTodayYmd();
    await loadEod();
    await loadEodHistory();
}

function closeEodModal() {
    document.getElementById('eodModal')?.classList.remove('active');
}

let eodExpected = 0;

async function loadEod() {
    const dateInput = document.getElementById('eodDate');
    // a date typed past today is put back to today, with the reason
    if (dateInput.value > localTodayYmd()) {
        dateInput.value = localTodayYmd();
        showToast('You cannot count a day that has not happened yet. Choose today or an earlier date.', 'error');
    }
    const date = dateInput.value;
    try {
        const res = await fetch(`${API_BASE}/sales/eod?date=${date}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) return;
        const d = data.data;
        eodExpected = d.expected_cash;
        document.getElementById('eodExpected').textContent = formatCurrency(d.expected_cash);
        const cashIn = Number(d.cash_in) || 0, cashOut = Number(d.cash_out) || 0, opening = Number(d.opening_cash) || 0;
        // how the expected figure is made up, whenever it is more than the sales alone
        document.getElementById('eodTxns').textContent = `${d.transactions} cash sale${d.transactions === 1 ? '' : 's'}` + (d.voided_sales ? ` · ${d.voided_sales} voided` : '')
            + (opening || cashIn || cashOut ? ` · ${opening ? 'starting cash ' + formatCurrency(opening) + ' + ' : ''}sales ${formatCurrency(d.cash_sales)}${cashIn ? ' + ' + formatCurrency(cashIn) + ' put in' : ''}${cashOut ? ' − ' + formatCurrency(cashOut) + ' taken out' : ''}` : '');
        renderEodMoves(d.cash_moves || [], cashIn, cashOut);
        const counted = document.getElementById('eodCounted');
        const notes = document.getElementById('eodNotes');
        if (d.reconciliation) {
            counted.value = parseFloat(d.reconciliation.counted_cash);
            notes.value = d.reconciliation.notes || '';
            document.getElementById('eodStatus').textContent = 'You already recorded a count for this day. Saving again replaces yours.';
        } else {
            counted.value = '';
            notes.value = '';
            document.getElementById('eodStatus').textContent = '';
        }
        updateEodDiff();
    } catch (e) { console.error('EOD load error:', e); }
}

function updateEodDiff() {
    const counted = parseFloat(document.getElementById('eodCounted').value);
    const el = document.getElementById('eodDiff');
    if (isNaN(counted)) { el.textContent = '—'; el.style.color = 'var(--text-muted)'; return; }
    // cash in a drawer cannot be less than nothing: a minus used to read as "Balanced"
    if (counted < 0) { el.textContent = 'Enter what was counted (0 or more)'; el.style.color = 'var(--danger)'; return; }
    const diff = Math.round((counted - eodExpected) * 100) / 100;
    if (diff === 0) { el.textContent = 'Balanced ✓'; el.style.color = 'var(--success)'; }
    else if (diff > 0) { el.textContent = 'Over by ' + formatCurrency(diff); el.style.color = 'var(--warning)'; }
    else { el.textContent = 'Short by ' + formatCurrency(Math.abs(diff)); el.style.color = 'var(--danger)'; }
}

async function saveEod() {
    const date = document.getElementById('eodDate').value;
    const counted = parseFloat(document.getElementById('eodCounted').value);
    if (isNaN(counted) || counted < 0) { showErrorDialog('Cash counted is not a valid amount', 'Enter the cash counted in the drawer as a number of 0 or more. Letters and minus amounts are not accepted.'); return; }
    try {
        const res = await fetch(`${API_BASE}/sales/eod`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ date, counted_cash: counted, notes: document.getElementById('eodNotes').value })
        });
        const data = await res.json();
        if (data.success) {
            const d = data.data;
            const msg = d.discrepancy === 0
                ? 'Drawer balanced perfectly with ' + formatCurrency(d.expected_cash) + ' expected.'
                : (d.discrepancy > 0 ? 'Over by ' + formatCurrency(d.discrepancy) : 'Short by ' + formatCurrency(Math.abs(d.discrepancy))) + ' against ' + formatCurrency(d.expected_cash) + ' expected.';
            showSuccessDialog('Day closed', msg, { icon: 'point_of_sale' });
            await loadEodHistory();
        } else {
            showErrorDialog('Could not save', data.message || 'the server gave no reason');
        }
    } catch (e) { showToast(couldNot('save reconciliation', e), 'error'); }
}

// Cash put into or taken out of the drawers that day: who, when and why.
function eodMoveRow(m, withName) {
    const out = m.kind === 'out';
    const time = new Date(Number(m.created_at)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:7px 12px;border-top:1px solid var(--border-subtle);font-size:12.5px;">
        <span style="min-width:0;overflow-wrap:anywhere;"><span style="color:var(--text-primary);font-weight:600;">${escHtml(m.reason)}</span>
            <span style="display:block;color:var(--text-muted);">${time} · ${out ? 'Taken out' : 'Put in'}${withName && m.cashier_name ? ' · ' + escHtml(m.cashier_name) : ''}</span></span>
        <span style="font-weight:700;white-space:nowrap;color:${out ? 'var(--danger)' : 'var(--success)'};">${out ? '−' : '+'}${formatCurrency(m.amount)}</span>
    </div>`;
}

function renderEodMoves(moves, cashIn, cashOut) {
    const box = document.getElementById('eodMoves');
    if (!box) return;
    box.hidden = !moves.length;
    if (!moves.length) return;
    document.getElementById('eodMovesHead').textContent = 'Cash in and out of the drawers: '
        + formatCurrency(cashIn) + ' put in, ' + formatCurrency(cashOut) + ' taken out';
    document.getElementById('eodMovesList').innerHTML = moves.map(m => eodMoveRow(m, true)).join('');
}

async function loadEodHistory() {
    const list = document.getElementById('eodHistory');
    if (!list) return;
    try {
        const res = await fetch(`${API_BASE}/sales/eod/history`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !data.data.length) { list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;">No reconciliations recorded yet.</div>'; return; }
        list.innerHTML = data.data.map(r => {
            const diff = parseFloat(r.discrepancy);
            const color = diff === 0 ? 'var(--success)' : diff > 0 ? 'var(--warning)' : 'var(--danger)';
            const label = diff === 0 ? 'Balanced' : diff > 0 ? 'Over ' + formatCurrency(diff) : 'Short ' + formatCurrency(Math.abs(diff));
            // business_date arrives as a UTC datetime; read the calendar day in local time
            const d = new Date(r.business_date);
            const opening = parseFloat(r.opening_cash) || 0;
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border-subtle);font-size:12.5px;">
                <span style="min-width:0;">
                    <span style="font-weight:600;color:var(--text-primary);">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${escHtml(r.counted_by_name || 'the server gave no reason')}</span>
                    <span style="display:block;color:var(--text-muted);">counted ${formatCurrency(parseFloat(r.counted_cash))}, expected ${formatCurrency(parseFloat(r.expected_cash))}${opening ? ' (incl. ' + formatCurrency(opening) + ' starting cash)' : ''}${r.notes ? ' — ' + escHtml(r.notes) : ''}</span>
                </span>
                <span style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
                    <span style="font-weight:600;color:${color};">${label}</span>
                    ${canManage() ? `<button class="btn-view" onclick="reopenCount(${Number(r.id)})" title="Remove this count so it can be recorded again">Reopen</button>` : ''}
                </span>
            </div>${(r.cash_moves || []).length ? `<div style="background:var(--bg-raised);border-bottom:1px solid var(--border-subtle);">${r.cash_moves.map(m => eodMoveRow(m, false)).join('')}</div>` : ''}`;
        }).join('');
    } catch (e) { console.error(e); }
}

function reopenCount(id) {
    showConfirmDialog('Reopen this count?', 'The recorded count is removed so it can be done again. The removal is kept in the activity log.', async () => {
        try {
            const res = await fetch(`${API_BASE}/sales/eod/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
            const data = await res.json();
            if (!data.success) { showToast(data.message || 'Could not reopen the count', 'error'); return; }
            showToast('Count removed. It can be recorded again.', 'success');
            await loadEod();
            await loadEodHistory();
        } catch (e) {
            showToast('Could not reopen the count', 'error');
        }
    }, 'Reopen');
}

// Stat cards come from one aggregate that respects the active date/search
// filter, so they stay correct even though only a page of sales is loaded.
async function updateStats() {
    try {
        const params = salesQuery();
        const res = await fetch(`${API_BASE}/sales/stats?${params}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !data.data) return;
        const s = data.data;
        const revenue = parseFloat(s.revenue) || 0;
        setText('totalSalesAmount', formatCompactCurrency(revenue));
        const el = document.getElementById('totalSalesAmount');
        if (el) el.title = formatCurrency(revenue);
        setText('totalTransactions', formatNumber(Number(s.transactions) || 0));
        const voidedNote = document.getElementById('voidedNote');
        if (voidedNote) { const v = Number(s.voided) || 0; voidedNote.textContent = v ? `${formatNumber(v)} more voided` : ''; voidedNote.style.display = v ? 'block' : 'none'; }
        setText('todaysSales', formatCurrency((parseFloat(s.today_revenue) || 0)));
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Search runs on the server (debounced so each keystroke isn't a query)
document.getElementById('searchInput')?.addEventListener('keyup', () => {
    clearTimeout(salesSearchDebounce);
    salesSearchDebounce = setTimeout(() => loadSales(), 250);
});

async function viewSaleDetails(id) {
    try {
        const response = await fetch(`${API_BASE}/sales/${id}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            const sale = data.data;
            viewingSaleId = id;
            document.getElementById('saleDetailsContent').innerHTML = `
                <div class="details-row"><span class="details-label">Sale ID</span><span class="details-value">#${sale.id}</span></div>
                <div class="details-row"><span class="details-label">Date</span><span class="details-value">${new Date(sale.created_at).toLocaleString()}</span></div>
                <div class="details-row"><span class="details-label">Staff</span><span class="details-value">${escHtml(sale.staff_name || 'N/A')}</span></div>
                <div class="details-row"><span class="details-label">Customer</span><span class="details-value">${escHtml(sale.customer_name || 'N/A')}</span></div>
                <div class="details-row"><span class="details-label">Phone</span><span class="details-value">${escHtml(sale.customer_phone || 'N/A')}</span></div>
                <div class="details-row"><span class="details-label">Payment</span><span class="details-value">${escHtml(sale.payment_method)}</span></div>
                <div class="details-row"><span class="details-label">Status</span><span class="details-value">${sale.payment_status === 'completed'
                    ? '<span class="status-badge status-in-stock">Completed</span>'
                    : sale.payment_status === 'voided'
                        ? '<span class="status-badge status-expired" title="Voided: its items went back to stock">Voided</span>'
                        : '<span class="status-badge status-expired">' + escHtml(sale.payment_status || 'N/A') + '</span>'}</span></div>
                <div class="details-row"><span class="details-label">Discount</span><span class="details-value">${parseFloat(sale.discount || 0)}%</span></div>
                <div class="details-row"><span class="details-label">Notes</span><span class="details-value">${escHtml(sale.notes || 'None')}</span></div>
                <div class="details-items"><h4>Items sold</h4>
                    <table class="sales-table" style="margin:0;">
                        <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
                        <tbody>${(sale.items || []).map(item => {
                            const ul = getUnitLabel(item.unit_type);
                            return `<tr><td>${escHtml(item.product_name)}</td><td>${parseFloat(item.quantity)}${ul}</td><td>${formatCurrency(parseFloat(item.unit_price))}</td><td>${formatCurrency(parseFloat(item.subtotal))}</td></tr>`;
                        }).join('')}</tbody>
                    </table>
                </div>
                <div class="total-section" style="margin-top:20px;">
                    <div class="total-row"><span>Subtotal:</span><span>${formatCurrency(parseFloat(sale.total_amount || 0))}</span></div>
                    ${parseFloat(sale.discount || 0) > 0 ? `<div class="total-row"><span>Discount (${parseFloat(sale.discount).toFixed(2)}%):</span><span>-${formatCurrency((parseFloat(sale.total_amount || 0) - parseFloat(sale.final_amount || 0)))}</span></div>` : ''}
                    <div class="total-row highlight"><span>Total amount:</span><span>${formatCurrency(parseFloat(sale.final_amount ?? sale.total_amount ?? 0))}</span></div>
                </div>
                <button class="btn-primary" onclick="printReceipt(${sale.id})" style="margin-top:15px;">Print receipt</button>
            `;
            document.getElementById('viewSaleModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading sale:', error);
        showToast(couldNot('load sale details', error), 'error');
    }
}

function closeViewSaleModal() {
    document.getElementById('viewSaleModal').classList.remove('active');
    viewingSaleId = null;
}

async function deleteSale(id) {
    if (getUserRole() !== 'admin') { showToast('Only an administrator can delete a sale. To cancel one, void it.', 'error'); return; }
    showConfirmDialog('Delete sale', 'This removes the sale from the records for good, and it will no longer count in any report. The Activity log keeps a copy of it. To cancel a sale and keep it on record, use Void instead. Delete it?', async () => {
        try {
            const response = await fetch(`${API_BASE}/sales/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showSuccessDialog('Sale deleted', escHtml(data.message || 'The sale record was removed.'), { tone: 'danger' });
                await loadSales();
            } else {
                showToast(data.message || 'The sale was not deleted', 'error');
            }
        } catch (error) {
            console.error('Error deleting sale:', error);
            showToast(couldNot('delete sale', error), 'error');
        }
    }, 'Yes, Delete', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete</span>');
}

async function printReceipt(saleId) {
    // open synchronously (popup blockers), then fill once the items arrive —
    // the list endpoint has no line items, so fetch the full sale
    const receiptWindow = window.open('', 'Receipt', 'width=400,height=600');
    let sale = null;
    try {
        const res = await fetch(`${API_BASE}/sales/${saleId}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success) sale = data.data;
    } catch (e) {}
    if (!sale) sale = allSales.find(s => s.id === saleId);
    if (!sale) { receiptWindow.close(); showToast('Sale data not available', 'error'); return; }
    const itemsHTML = (sale.items || []).map(item => {
        const ul = getUnitLabel(item.unit_type);
        return `<tr><td style="padding:3px 4px;border-bottom:1px dashed #ccc;">${escHtml(item.product_name)}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:center;">${parseFloat(item.quantity)}${ul}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">${formatCurrency(parseFloat(item.unit_price))}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">${formatCurrency(parseFloat(item.subtotal || item.quantity * item.unit_price))}</td></tr>`;
    }).join('');
    // What the customer actually paid — final_amount is net of any discount.
    const total = parseFloat(sale.final_amount ?? sale.total_amount ?? 0).toFixed(2);
    const disc = parseFloat(sale.discount || 0).toFixed(2);
    const subtotal = parseFloat(sale.total_amount || 0).toFixed(2);
    const date = new Date(sale.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    receiptWindow.document.write(`
        <html><head><title>Receipt #${sale.id}</title>
        <style>
            @page{margin:0;size:58mm auto;}
            body{font-family:'Courier New',monospace;font-size:10px;width:58mm;max-width:58mm;padding:4px 4px;margin:0 auto;text-align:center;word-break:break-word;}
            h2{margin:5px 0 2px;font-size:16px;letter-spacing:1px;text-transform:uppercase;}
            .info{font-size:12px;color:#555;margin:2px 0;line-height:1.4;}
            table{width:100%;border-collapse:collapse;margin:8px 0;text-align:left;font-size:12px;table-layout:auto;}
            td:not(:first-child),th:not(:first-child){white-space:nowrap;}
            th{padding:4px;border-bottom:2px solid #000;font-size:12px;text-transform:uppercase;}
            .total-row{display:flex;justify-content:space-between;padding:3px 4px;font-size:12px;}
            .grand-total{font-size:16px;font-weight:bold;border-top:2px solid #000;border-bottom:2px solid #000;padding:8px 4px;margin:8px 0;}
            .footer{font-size:12px;color:#555;margin-top:10px;line-height:1.5;}
            hr{border:none;border-top:1px dashed #ccc;margin:8px 0;}
            button{display:none;}
            .barcode{font-family:'Courier New',monospace;font-size:14px;letter-spacing:2px;margin:8px 0;}
        </style></head>
        <body>
            <h2>RISHA Pet Supplies</h2>
            <div class="info">7 Bagumbong Road, Brgy. 171, North Caloocan</div>
            <div class="info">Tel: (02) 8123-4567 | TIN: 123-456-789-000</div>
            <hr>
            <div style="text-align:left;font-size:12px;line-height:1.6;">
                <div>Receipt #: <strong>${String(sale.sale_number || sale.id).padStart(6, '0')}</strong></div>
                <div>Date: ${date}</div>
                <div>Cashier: ${escHtml(sale.staff_name || 'N/A')}</div>
                <div>Customer: ${escHtml(sale.customer_name || 'Walk-in')}${sale.customer_phone ? ' (' + escHtml(sale.customer_phone) + ')' : ''}</div>
                <div>Payment: ${(sale.payment_method || 'cash').toUpperCase()}</div>
            </div>
            <hr>
            <table><thead><tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itemsHTML}</tbody></table>
            <hr>
            <div class="total-row"><span>Subtotal:</span><span>₱${subtotal}</span></div>
            <div class="total-row"><span>Discount (${disc}%):</span><span>-${formatCurrency((subtotal * disc / 100))}</span></div>
            <div class="grand-total">TOTAL: ₱${total}</div>
            <div class="barcode">*${String(sale.sale_number || sale.id).padStart(6, '0')}*</div>
            <div class="footer">
                Thank you for your purchase!<br>
                Visit us again at RISHA Pet Supplies<br>
                — Pets &amp; Supplies —
            </div>
            <br><button onclick="window.print()">Print</button>
            <script>window.onload=function(){setTimeout(function(){window.print();},300);}<\/script>
        </body></html>
    `);
    receiptWindow.document.close();
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('viewSaleModal')) closeViewSaleModal();
});

async function exportSalesExcel() {
    // Only a page is loaded, so pull the whole matching set (current date/search
    // filter, no limit) for the export.
    let sales = [];
    try {
        const res = await fetch(`${API_BASE}/sales?${salesQuery()}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success && data.message) { showToast(data.message, 'warning'); return; }
        sales = (data.success && Array.isArray(data.data)) ? data.data : [];
    } catch (e) {
        showToast(couldNot('export sales', e), 'error');
        return;
    }
    if (!sales.length) { showToast('No sales to export', 'error'); return; }
    /* The list gives a sale's time as a number, its item count as item_count
       and its state as payment_status. The file is an Excel table (js/xlsx.js):
       header with filters, peso amounts, real dates, and a TOTAL that leaves
       voided sales out, as the Total sales amount on the page does. */
    const two = n => String(n).padStart(2, '0');
    const columns = [
        { head: 'Sale #', width: 9, type: 'int' }, { head: 'Date', width: 17, type: 'datetime' },
        { head: 'Customer', width: 20, type: 'text' }, { head: 'Cashier', width: 20, type: 'text' },
        { head: 'Items', width: 8, type: 'int' }, { head: 'Subtotal', width: 14, type: 'money' },
        { head: 'Discount %', width: 11, type: 'number' }, { head: 'Total', width: 14, type: 'money' },
        { head: 'Payment', width: 10, type: 'text' }, { head: 'Status', width: 11, type: 'text' }
    ];
    const rows = sales.map(s => [
        s.id,
        new Date(Number(s.created_at)),
        s.customer_name || 'Walk-in',
        s.staff_name || '',
        Number(s.item_count) || 0,
        parseFloat(s.total_amount || 0),
        parseFloat(s.discount || 0),
        parseFloat(s.final_amount ?? s.total_amount ?? 0),
        s.payment_method || 'cash',
        s.payment_status || ''
    ]);
    // today's date where the shop is: toISOString() is UTC, which is still
    // yesterday until 8 in the morning here
    const today = new Date();
    downloadXlsx(`sales_${today.getFullYear()}-${two(today.getMonth() + 1)}-${two(today.getDate())}.xlsx`, 'Sales', columns, rows,
        { label: 'TOTAL (voided left out)', sum: [4, 5, 7], skipWhen: { col: 9, equals: 'voided' } });
    showToast('Sales exported successfully', 'success');
}

/* The date boxes run from the first sale recorded in FETCH to today: there
   are no sales before the first one, and none in the future. The first sale
   is the last one in the list (it is newest first). */
let firstSaleDay = '';
const asYmd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const prettyDay = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
async function setSalesDateBounds() {
    try {
        if (salesTotal > 0) {
            const res = await fetch(`${API_BASE}/sales?limit=1&offset=${salesTotal - 1}`, { headers: getAuthHeaders() });
            const data = await res.json();
            const oldest = data.success && data.data && data.data[0];
            if (oldest && !isNaN(new Date(oldest.created_at))) firstSaleDay = asYmd(new Date(oldest.created_at));
        }
    } catch (e) { /* the boxes still stop at today */ }
    ['dateFrom', 'dateTo'].forEach(id => {
        const box = document.getElementById(id);
        if (!box) return;
        box.max = localTodayYmd();
        if (firstSaleDay) box.min = firstSaleDay;
    });
}

/* What is wrong with the dates chosen, or null. */
function salesDateProblem(from, to) {
    if (!from && !to) return 'Select a date range';
    const today = localTodayYmd();
    if ((from && from > today) || (to && to > today)) return 'Choose today or an earlier date: there are no sales in the future.';
    if (firstSaleDay && ((from && from < firstSaleDay) || (to && to < firstSaleDay))) {
        return `The first sale in FETCH was on ${prettyDay(firstSaleDay)}. Choose that day or later.`;
    }
    if (from && to && from > to) return 'The start date is after the end date';
    return null;
}

function filterSalesByDate() {
    const from = document.getElementById('dateFrom')?.value;
    const to = document.getElementById('dateTo')?.value;
    const problem = salesDateProblem(from, to);
    if (problem) { showToast(problem, 'error'); return; }
    loadSales();
}

function clearDateFilter() {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    loadSales();
}
