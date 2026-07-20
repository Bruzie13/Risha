function getUnitLabel(unitType) {
    const labels = { piece: '', kg: ' kg', g: ' g', liter: ' L', ml: ' mL' };
    return labels[unitType] || '';
}

function getUnitLabelShort(unitType) {
    const labels = { piece: 'pcs', kg: 'kg', g: 'g', liter: 'L', ml: 'mL' };
    return labels[unitType] || 'pcs';
}

function getQtyStep(unitType) {
    const steps = { piece: 1, kg: 0.01, g: 0.1, liter: 0.01, ml: 1 };
    return steps[unitType] || 1;
}

const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let allSales = [];
let currentSaleItems = [];
let viewingSaleId = null;
let allProducts = [];
let barcodeBuffer = '';
let lastKeyTime = 0;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    if (isViewer()) {
        document.querySelector('.page-header-actions .btn-primary')?.remove();
    }
    const viewer = isViewer();
    if (!canManage()) document.querySelector('#viewSaleModal .btn-danger')?.remove();
    await Promise.all([loadProducts(), loadSales()]);
    setupBarcodeListener();
    setupAutocomplete();
    // Live refresh: sales made on other terminals appear without a reload
    setInterval(refreshSalesLive, 10000);
});

async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE}/products`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allProducts = Array.isArray(data.data) ? data.data : [];
            populateProductSelect(allProducts);
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

function populateProductSelect(products) {
    const sel = document.getElementById('product_select');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select a product</option>';
    products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        const unitLabel = getUnitLabel(p.unit_type);
        opt.textContent = `${p.name} (${p.stock_quantity}${unitLabel})`;
        opt.dataset.price = p.unit_price;
        opt.dataset.stock = p.stock_quantity;
        opt.dataset.unitType = p.unit_type || 'piece';
        opt.dataset.expiration = p.expiration_date || '';
        sel.appendChild(opt);
    });
    sel.addEventListener('change', (e) => {
        const selected = e.target.options[e.target.selectedIndex];
        if (selected.value) {
            document.getElementById('unit_price').value = parseFloat(selected.dataset.price).toFixed(2);
            const unitType = selected.dataset.unitType || 'piece';
            const stock = parseFloat(selected.dataset.stock);
            document.getElementById('maxStock').textContent = stock + getUnitLabel(unitType);
            const qtyInput = document.getElementById('quantity');
            qtyInput.step = getQtyStep(unitType);
            qtyInput.value = getQtyStep(unitType);
            updateItemTotal();
        } else {
            document.getElementById('unit_price').value = '';
            document.getElementById('maxStock').textContent = '0';
        }
    });
    document.getElementById('quantity')?.addEventListener('input', updateItemTotal);
}

function setupAutocomplete() {
    const scanInput = document.getElementById('barcodeScanInput');
    if (!scanInput) return;
    let acTimeout;
    scanInput.addEventListener('input', () => {
        clearTimeout(acTimeout);
        const val = scanInput.value.trim().toLowerCase();
        const list = document.getElementById('productAutocomplete');
        if (!list) return;
        if (val.length < 2) { list.innerHTML = ''; list.style.display = 'none'; return; }
        acTimeout = setTimeout(() => {
            const matches = allProducts.filter(p =>
                (p.name || '').toLowerCase().includes(val) ||
                (p.barcode || '').toLowerCase().includes(val) ||
                (p.sku || '').toLowerCase().includes(val)
            ).slice(0, 10);
            if (matches.length === 0) { list.innerHTML = ''; list.style.display = 'none'; return; }
            list.innerHTML = matches.map(p => {
                const unitLabel = getUnitLabel(p.unit_type);
                return `<div class="ac-item" onclick="selectAutocomplete(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.unit_price}, ${p.stock_quantity}, '${(p.expiration_date || '').replace(/'/g, "\\'")}', '${p.unit_type || 'piece'}')">
                    ${p.name} <small>Stock: ${p.stock_quantity}${unitLabel} | ₱${parseFloat(p.unit_price).toFixed(2)}${unitLabel ? '/' + unitLabel.trim() : ''}</small>
                </div>`;
            }).join('');
            list.style.display = 'block';
        }, 200);
    });
    scanInput.addEventListener('blur', () => {
        setTimeout(() => { const list = document.getElementById('productAutocomplete'); if (list) list.style.display = 'none'; }, 200);
    });
    scanInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const barcode = scanInput.value.trim();
            if (barcode.length > 3) {
                const found = allProducts.find(p => p.barcode === barcode);
                if (found) {
                    selectAutocomplete(found.id, found.name, found.unit_price, found.stock_quantity, found.expiration_date || '', found.unit_type || 'piece');
                }
            }
        }
    });
}

function selectAutocomplete(id, name, price, stock, expiration, unitType) {
    unitType = unitType || 'piece';
    document.getElementById('barcodeScanInput').value = '';
    document.getElementById('productAutocomplete').style.display = 'none';
    // Set product select
    const sel = document.getElementById('product_select');
    if (sel) sel.value = id;
    document.getElementById('unit_price').value = parseFloat(price).toFixed(2);
    document.getElementById('maxStock').textContent = stock + getUnitLabel(unitType);
    // Set qty step based on unit type, auto-add with base qty
    const qtyInput = document.getElementById('quantity');
    if (qtyInput) {
        qtyInput.step = getQtyStep(unitType);
        qtyInput.value = getQtyStep(unitType);
    }
    addItemToSale();
}

function setupBarcodeListener() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'F2') {
            e.preventDefault();
            const input = document.getElementById('barcodeScanInput');
            if (input) { input.value = ''; input.focus(); showToast('Scanner ready', 'info'); }
            return;
        }
        const now = Date.now();
        if (now - lastKeyTime > 100) barcodeBuffer = '';
        lastKeyTime = now;
        if (e.key === 'Enter' && barcodeBuffer.length > 3) {
            const barcode = barcodeBuffer;
            barcodeBuffer = '';
            const found = allProducts.find(p => p.barcode === barcode);
            if (found) {
                document.getElementById('barcodeScanInput').value = barcode;
                selectAutocomplete(found.id, found.name, found.unit_price, found.stock_quantity, found.expiration_date || '', found.unit_type || 'piece');
                showToast('Scanned: ' + found.name, 'success');
            } else {
                showToast('Product not found for barcode: ' + barcode, 'error');
            }
            e.preventDefault();
            return;
        }
        if (e.key.length === 1) barcodeBuffer += e.key;
    });
}

function focusBarcodeScanner() {
    const input = document.getElementById('barcodeScanInput');
    if (input) { input.value = ''; input.focus(); showToast('Scanner ready — scan barcode or press F2', 'info'); }
}

function updateItemTotal() {
    const qty = parseFloat(document.getElementById('quantity')?.value) || 0;
    const price = parseFloat(document.getElementById('unit_price')?.value) || 0;
    const total = qty * price;
    const el = document.getElementById('itemTotal');
    if (el) el.textContent = '₱' + total.toFixed(2);
    // Validate against stock
    const maxStockText = document.getElementById('maxStock')?.textContent || '0';
    const maxStock = parseFloat(maxStockText.replace(/[^0-9.]/g, ''));
    if (qty > maxStock) {
        document.getElementById('qtyWarning')?.classList.remove('hidden');
    } else {
        document.getElementById('qtyWarning')?.classList.add('hidden');
    }
}

async function loadSales(dateFrom, dateTo) {
    try {
        let url = `${API_BASE}/sales`;
        const params = [];
        if (dateFrom) params.push(`date_from=${encodeURIComponent(dateFrom)}`);
        if (dateTo) params.push(`date_to=${encodeURIComponent(dateTo)}`);
        if (params.length) url += '?' + params.join('&');
        const response = await fetch(url, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allSales = Array.isArray(data.data) ? data.data : [];
            displaySales(allSales);
            updateStats();
        }
    } catch (error) {
        console.error('Error loading sales:', error);
        const tbody = document.getElementById('salesTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Failed to load sales</td></tr>';
    }
}

function getFilteredSales() {
    const term = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    return allSales.filter(s =>
        s.id.toString().includes(term) ||
        (s.staff_name && s.staff_name.toLowerCase().includes(term))
    );
}

function showMoreSales() {
    displayCount += PAGE_SIZE;
    displaySales(getFilteredSales());
}

// Poll for new/voided sales; re-render only when the list actually changed,
// preserving the current search and how many rows are shown.
async function refreshSalesLive() {
    if (document.hidden) return;
    try {
        let url = `${API_BASE}/sales`;
        const params = [];
        const from = document.getElementById('dateFrom')?.value;
        const to = document.getElementById('dateTo')?.value;
        if (from) params.push(`date_from=${encodeURIComponent(from)}`);
        if (to) params.push(`date_to=${encodeURIComponent(to)}`);
        if (params.length) url += '?' + params.join('&');
        const response = await fetch(url, { headers: getAuthHeaders() });
        const data = await response.json();
        if (!data.success || !Array.isArray(data.data)) return;
        const fresh = data.data;
        const fingerprint = list => list.map(s => `${s.id}:${s.payment_status}`).join(',');
        if (fingerprint(fresh) === fingerprint(allSales)) return;
        allSales = fresh;
        displaySales(getFilteredSales());
        updateStats();
    } catch (e) {
        // Network hiccup — next poll retries.
    }
}

function showLessSales() {
    displayCount = 0;
    showMoreSales();
}

function displaySales(sales) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;
    const viewer = !canManage(); // delete is admin/manager-only
    if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No sales found</td></tr>';
        updatePagination('salesPagination', sales, displayCount, 'showMoreSales', 'showLessSales', PAGE_SIZE);
    if (window.fetchMotion && !fetchMotion.reduced) { tbody.classList.remove('rows-in'); void tbody.offsetWidth; tbody.classList.add('rows-in'); }
        return;
    }
    const shown = sales.slice(0, displayCount);
    tbody.innerHTML = shown.map(s => `
        <tr>
            <td>#${s.id}</td>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
            <td>${s.customer_name || 'Walk-in'}</td>
            <td>${s.staff_name || 'N/A'}</td>
            <td>${s.item_count || 0}</td>
            <td>₱${parseFloat(s.total_amount).toFixed(2)}</td>
            <td>${s.payment_method || 'N/A'}</td>
            <td>${s.payment_status === 'completed'
                ? '<span class="status-badge status-in-stock">Completed</span>'
                : s.payment_status === 'voided'
                    ? '<span class="status-badge status-expired" title="Voided — stock was restored">Voided</span>'
                    : '<span class="status-badge status-expired">' + (s.payment_status || 'N/A') + '</span>'}</td>
            <td>
                <button class="btn-view" onclick="viewSaleDetails(${s.id})">View</button>
                ${viewer || s.payment_status === 'voided' ? '' : `<button class="btn-delete" onclick="voidSale(${s.id})">Void</button>`}
            </td>
        </tr>
    `).join('');
    updatePagination('salesPagination', sales, displayCount, 'showMoreSales', 'showLessSales', PAGE_SIZE);
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
                    showErrorDialog('Could not void sale', data.message || 'Unknown error');
                }
            } catch (e) {
                showToast('Failed to void sale', 'error');
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
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    await loadEod();
    await loadEodHistory();
}

function closeEodModal() {
    document.getElementById('eodModal')?.classList.remove('active');
}

let eodExpected = 0;

async function loadEod() {
    const date = document.getElementById('eodDate').value;
    try {
        const res = await fetch(`${API_BASE}/sales/eod?date=${date}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) return;
        const d = data.data;
        eodExpected = d.expected_cash;
        document.getElementById('eodExpected').textContent = formatCurrency(d.expected_cash);
        document.getElementById('eodTxns').textContent = `${d.transactions} cash sale${d.transactions === 1 ? '' : 's'}` + (d.voided_sales ? ` · ${d.voided_sales} voided` : '');
        const counted = document.getElementById('eodCounted');
        const notes = document.getElementById('eodNotes');
        if (d.reconciliation) {
            counted.value = parseFloat(d.reconciliation.counted_cash);
            notes.value = d.reconciliation.notes || '';
            document.getElementById('eodStatus').textContent = 'Already recorded by ' + (d.reconciliation.counted_by_name || 'someone') + ' — saving again overwrites it.';
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
    const diff = Math.round((counted - eodExpected) * 100) / 100;
    if (diff === 0) { el.textContent = 'Balanced ✓'; el.style.color = 'var(--success)'; }
    else if (diff > 0) { el.textContent = 'Over by ' + formatCurrency(diff); el.style.color = 'var(--warning)'; }
    else { el.textContent = 'Short by ' + formatCurrency(Math.abs(diff)); el.style.color = 'var(--danger)'; }
}

async function saveEod() {
    const date = document.getElementById('eodDate').value;
    const counted = parseFloat(document.getElementById('eodCounted').value);
    if (isNaN(counted) || counted < 0) { showErrorDialog('Invalid amount', 'Enter the cash amount actually counted in the drawer.'); return; }
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
            showErrorDialog('Could not save', data.message || 'Unknown error');
        }
    } catch (e) { showToast('Failed to save reconciliation', 'error'); }
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
            const label = diff === 0 ? 'Balanced' : diff > 0 ? '+' + formatCurrency(diff) : '−' + formatCurrency(Math.abs(diff));
            const d = new Date(r.business_date);
            return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border-subtle);font-size:12.5px;">
                <span style="font-weight:600;color:var(--text-primary);">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <span style="color:var(--text-muted);">counted ${formatCurrency(parseFloat(r.counted_cash))} / expected ${formatCurrency(parseFloat(r.expected_cash))}</span>
                <span style="font-weight:700;color:${color};">${label}</span>
            </div>`;
        }).join('');
    } catch (e) { console.error(e); }
}

async function updateStats() {
    try {
        const totalRes = await fetch(`${API_BASE}/sales/total-sales`, { headers: getAuthHeaders() });
        const totalData = await totalRes.json();
        if (totalData.success) {
            const totalAmount = parseFloat(totalData.data.total_sales) || 0;
            setText('totalSalesAmount', formatCompactCurrency(totalAmount));
            const el = document.getElementById('totalSalesAmount');
            if (el) el.title = formatCurrency(totalAmount);
        }
        setText('totalTransactions', allSales.length);
        const today = new Date().toDateString();
        const todaySales = allSales
            .filter(s => new Date(s.created_at).toDateString() === today)
            .reduce((sum, s) => sum + parseFloat(s.total_amount), 0);
        setText('todaysSales', '₱' + todaySales.toFixed(2));
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Search
document.getElementById('searchInput')?.addEventListener('keyup', (e) => {
    displayCount = PAGE_SIZE;
    const term = e.target.value.toLowerCase();
    const filtered = allSales.filter(s =>
        s.id.toString().includes(term) ||
        (s.staff_name && s.staff_name.toLowerCase().includes(term))
    );
    displaySales(filtered);
});

function openNewSaleModal() {
    if (isViewer()) { showToast('View-only account. Cannot create sales.', 'error'); return; }
    currentSaleItems = [];
    document.getElementById('saleForm').reset();
    document.getElementById('unit_price').value = '';
    document.getElementById('quantity').value = 1;
    document.getElementById('maxStock').textContent = '0';
    document.getElementById('discount').value = 0;
    document.getElementById('qtyWarning')?.classList.add('hidden');
    const itemTotal = document.getElementById('itemTotal');
    if (itemTotal) itemTotal.textContent = '₱0.00';
    updateItemsList();
    updateTotals();
    document.getElementById('saleModal').classList.add('active');
}

function closeSaleModal() {
    document.getElementById('saleModal').classList.remove('active');
    currentSaleItems = [];
}

function addItemToSale() {
    const sel = document.getElementById('product_select');
    const qty = parseFloat(document.getElementById('quantity').value);
    const unitPrice = parseFloat(document.getElementById('unit_price').value);

    if (!sel?.value) { showToast('Please select a product', 'error'); return; }
    if (!qty || qty <= 0) { showToast('Enter valid quantity', 'error'); return; }
    if (!unitPrice || unitPrice <= 0) { showToast('Invalid price', 'error'); return; }

    const option = sel.options[sel.selectedIndex];
    const stock = parseFloat(option.dataset.stock);
    const unitType = option.dataset.unitType || 'piece';
    const expiration = option.dataset.expiration;

    // Check expiration
    if (expiration) {
        const expDate = new Date(expiration);
        if (expDate < new Date()) {
            showToast('Cannot sell expired product!', 'error');
            return;
        }
    }

    if (qty > stock) {
        showToast(`Insufficient stock. Available: ${stock}${getUnitLabel(unitType)}`, 'error');
        return;
    }

    // Check if already in cart
    const existing = currentSaleItems.find(i => i.product_id === parseInt(sel.value));
    if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > stock) {
            showToast(`Total would exceed stock. Available: ${stock}${getUnitLabel(unitType)}, in cart: ${existing.quantity}${getUnitLabel(unitType)}`, 'error');
            return;
        }
        existing.quantity = newQty;
        existing.total_price = existing.quantity * existing.unit_price;
    } else {
        currentSaleItems.push({
            product_id: parseInt(sel.value),
            product_name: option.text.split('(')[0].trim(),
            unit_type: unitType,
            quantity: qty,
            unit_price: unitPrice,
            total_price: qty * unitPrice
        });
    }

    updateItemsList();
    updateTotals();
    const qtyInput = document.getElementById('quantity');
    qtyInput.step = getQtyStep(unitType);
    qtyInput.value = 1;
    document.getElementById('unit_price').value = '';
    document.getElementById('itemTotal').textContent = '₱0.00';
    sel.value = '';
}

function removeItemFromSale(index) {
    currentSaleItems.splice(index, 1);
    updateItemsList();
    updateTotals();
}

function updateItemsList() {
    const list = document.getElementById('saleItemsList');
    if (!list) return;
    if (currentSaleItems.length === 0) {
        list.innerHTML = '<p class="text-center text-muted">No items added yet</p>';
        return;
    }
    list.innerHTML = currentSaleItems.map((item, idx) => {
        const unitLabel = getUnitLabel(item.unit_type);
        return `
        <div class="item-row">
            <div class="item-info">
                <div class="item-name">${item.product_name}</div>
                <div class="item-detail">Qty: ${item.quantity}${unitLabel} × ₱${item.unit_price.toFixed(2)}${unitLabel ? '/' + unitLabel.trim() : ''}</div>
            </div>
            <div class="item-price">₱${item.total_price.toFixed(2)}</div>
            <button type="button" class="btn-remove" onclick="removeItemFromSale(${idx})">Remove</button>
        </div>`;
    }).join('');
}

function updateTotals() {
    const subtotal = currentSaleItems.reduce((sum, i) => sum + i.total_price, 0);
    const discount = parseFloat(document.getElementById('discount')?.value) || 0;
    const discountAmt = discount > 0 ? subtotal * (discount / 100) : 0;
    const total = subtotal - discountAmt;
    document.getElementById('subtotal').textContent = '₱' + subtotal.toFixed(2);
    document.getElementById('discountAmount').textContent = '-' + (discount > 0 ? '₱' + discountAmt.toFixed(2) : '₱0.00');
    document.getElementById('totalAmount').textContent = '₱' + total.toFixed(2);
}

document.getElementById('discount')?.addEventListener('input', updateTotals);

function clearBarcodeInput() {
    document.getElementById('barcodeScanInput').value = '';
    document.getElementById('productAutocomplete').style.display = 'none';
}

function updateTotalAmount() {
    updateTotals();
}

async function handleSaleSubmit(event) {
    event.preventDefault();
    if (isViewer()) { showToast('View-only account. Cannot create sales.', 'error'); return; }
    if (!currentSaleItems || currentSaleItems.length === 0) {
        showToast('Please add at least one item', 'error');
        return;
    }
    const discount = parseFloat(document.getElementById('discount')?.value) || 0;
    const saleData = {
        payment_method: document.getElementById('payment_method').value || 'cash',
        notes: document.getElementById('notes').value || '',
        customer_name: document.getElementById('customer_name')?.value || '',
        customer_phone: document.getElementById('customer_phone')?.value || '',
        discount_percent: discount,
        items: currentSaleItems
    };
    try {
        const response = await fetch(`${API_BASE}/sales`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(saleData)
        });
        const data = await response.json();
        if (data.success) {
            showSuccessDialog('Sale completed', 'The cash sale has been recorded and stock levels updated.', { icon: 'point_of_sale' });
            closeSaleModal();
            await loadSales();
        } else {
            showToast('Error: ' + (data.message || 'Unknown'), 'error');
        }
    } catch (error) {
        console.error('Error creating sale:', error);
        showToast('Failed to create sale', 'error');
    }
}

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
                <div class="details-row"><span class="details-label">Staff</span><span class="details-value">${sale.staff_name || 'N/A'}</span></div>
                <div class="details-row"><span class="details-label">Customer</span><span class="details-value">${sale.customer_name || 'N/A'}</span></div>
                <div class="details-row"><span class="details-label">Phone</span><span class="details-value">${sale.customer_phone || 'N/A'}</span></div>
                <div class="details-row"><span class="details-label">Payment</span><span class="details-value">${sale.payment_method}</span></div>
                <div class="details-row"><span class="details-label">Discount</span><span class="details-value">${sale.discount_percent || 0}%</span></div>
                <div class="details-row"><span class="details-label">Notes</span><span class="details-value">${sale.notes || 'None'}</span></div>
                <div class="details-items"><h4>Items Sold</h4>
                    <table class="sales-table" style="margin:0;">
                        <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
                        <tbody>${(sale.items || []).map(item => {
                            const ul = getUnitLabel(item.unit_type);
                            return `<tr><td>${item.product_name}</td><td>${parseFloat(item.quantity)}${ul}</td><td>₱${parseFloat(item.unit_price).toFixed(2)}</td><td>₱${parseFloat(item.subtotal).toFixed(2)}</td></tr>`;
                        }).join('')}</tbody>
                    </table>
                </div>
                <div class="total-section" style="margin-top:20px;">
                    <div class="total-row highlight"><span>Total Amount:</span><span>₱${parseFloat(sale.total_amount).toFixed(2)}</span></div>
                </div>
                <button class="btn-primary" onclick="printReceipt(${sale.id})" style="margin-top:15px;">Print Receipt</button>
            `;
            document.getElementById('viewSaleModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading sale:', error);
        showToast('Failed to load sale details', 'error');
    }
}

function closeViewSaleModal() {
    document.getElementById('viewSaleModal').classList.remove('active');
    viewingSaleId = null;
}

async function deleteSaleFromDetail() {
    if (!canManage()) { showToast("Your role can't delete sales.", 'error'); return; }
    if (viewingSaleId) {
        await deleteSale(viewingSaleId);
        closeViewSaleModal();
    }
}

async function deleteSale(id) {
    if (!canManage()) { showToast("Your role can't delete sales.", 'error'); return; }
    showConfirmDialog('Delete Sale', 'Are you sure you want to delete this sale? This cannot be undone.', async () => {
        try {
            const response = await fetch(`${API_BASE}/sales/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showSuccessDialog('Sale deleted', 'The sale record was removed and stock has been restored.', { tone: 'danger' });
                await loadSales();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Error deleting sale:', error);
            showToast('Failed to delete sale', 'error');
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
        return `<tr><td style="padding:3px 4px;border-bottom:1px dashed #ccc;">${item.product_name}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:center;">${parseFloat(item.quantity)}${ul}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">₱${parseFloat(item.unit_price).toFixed(2)}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">₱${parseFloat(item.subtotal || item.quantity * item.unit_price).toFixed(2)}</td></tr>`;
    }).join('');
    const total = parseFloat(sale.total_amount || sale.final_amount || 0).toFixed(2);
    const disc = parseFloat(sale.discount || 0).toFixed(2);
    const subtotal = parseFloat(sale.total_amount || 0).toFixed(2);
    const date = new Date(sale.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    receiptWindow.document.write(`
        <html><head><title>Receipt #${sale.id}</title>
        <style>
            @page{margin:0;size:auto;}
            body{font-family:'Courier New',monospace;font-size:11px;width:auto;max-width:80mm;padding:6px 8px;margin:0 auto;text-align:center;word-break:break-word;}
            h2{margin:5px 0 2px;font-size:16px;letter-spacing:1px;text-transform:uppercase;}
            .info{font-size:10px;color:#555;margin:2px 0;line-height:1.4;}
            table{width:100%;border-collapse:collapse;margin:8px 0;text-align:left;font-size:10px;table-layout:auto;}
            td:not(:first-child),th:not(:first-child){white-space:nowrap;}
            th{padding:4px;border-bottom:2px solid #000;font-size:10px;text-transform:uppercase;}
            .total-row{display:flex;justify-content:space-between;padding:3px 4px;font-size:12px;}
            .grand-total{font-size:16px;font-weight:bold;border-top:2px solid #000;border-bottom:2px solid #000;padding:8px 4px;margin:8px 0;}
            .footer{font-size:10px;color:#555;margin-top:10px;line-height:1.5;}
            hr{border:none;border-top:1px dashed #ccc;margin:8px 0;}
            button{display:none;}
            .barcode{font-family:'Courier New',monospace;font-size:14px;letter-spacing:2px;margin:8px 0;}
        </style></head>
        <body>
            <h2>RISHA Pet Supplies</h2>
            <div class="info">123 Main St, Caloocan City</div>
            <div class="info">Tel: (02) 8123-4567 | TIN: 123-456-789-000</div>
            <hr>
            <div style="text-align:left;font-size:11px;line-height:1.6;">
                <div>Receipt #: <strong>${String(sale.sale_number || sale.id).padStart(6, '0')}</strong></div>
                <div>Date: ${date}</div>
                <div>Cashier: ${sale.staff_name || 'N/A'}</div>
                <div>Customer: ${sale.customer_name || 'Walk-in'}${sale.customer_phone ? ' (' + sale.customer_phone + ')' : ''}</div>
                <div>Payment: ${(sale.payment_method || 'cash').toUpperCase()}</div>
            </div>
            <hr>
            <table><thead><tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itemsHTML}</tbody></table>
            <hr>
            <div class="total-row"><span>Subtotal:</span><span>₱${subtotal}</span></div>
            <div class="total-row"><span>Discount (${disc}%):</span><span>-₱${(subtotal * disc / 100).toFixed(2)}</span></div>
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

function printCurrentReceipt() {
    if (currentSaleItems.length === 0) { showToast('No items in sale', 'error'); return; }
    const itemsHTML = currentSaleItems.map(item => {
        const ul = getUnitLabel(item.unit_type);
        return `<tr><td style="padding:3px 4px;border-bottom:1px dashed #ccc;">${item.product_name}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:center;">${parseFloat(item.quantity)}${ul}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">₱${parseFloat(item.unit_price).toFixed(2)}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">₱${parseFloat(item.total_price).toFixed(2)}</td></tr>`;
    }).join('');
    const subtotal = currentSaleItems.reduce((sum, i) => sum + i.total_price, 0);
    const discPct = parseFloat(document.getElementById('discount')?.value || 0);
    const discAmt = subtotal * (discPct / 100);
    const total = subtotal - discAmt;
    const customer = document.getElementById('customer_name')?.value || 'Walk-in';
    const payment = document.getElementById('payment_method')?.value || 'cash';
    const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const user = getUser();
    const receiptNum = 'PENDING-' + Date.now().toString().slice(-6);

    const receiptWindow = window.open('', 'Receipt', 'width=400,height=600');
    receiptWindow.document.write(`
        <html><head><title>Receipt - Preview</title>
        <style>
            @page{margin:0;size:auto;}
            body{font-family:'Courier New',monospace;font-size:11px;width:auto;max-width:80mm;padding:6px 8px;margin:0 auto;text-align:center;word-break:break-word;}
            h2{margin:5px 0 2px;font-size:16px;letter-spacing:1px;text-transform:uppercase;}
            .info{font-size:10px;color:#555;margin:2px 0;line-height:1.4;}
            table{width:100%;border-collapse:collapse;margin:8px 0;text-align:left;font-size:10px;table-layout:auto;}
            td:not(:first-child),th:not(:first-child){white-space:nowrap;}
            th{padding:4px;border-bottom:2px solid #000;font-size:10px;text-transform:uppercase;}
            .total-row{display:flex;justify-content:space-between;padding:3px 4px;font-size:12px;}
            .grand-total{font-size:16px;font-weight:bold;border-top:2px solid #000;border-bottom:2px solid #000;padding:8px 4px;margin:8px 0;}
            .footer{font-size:10px;color:#555;margin-top:10px;line-height:1.5;}
            hr{border:none;border-top:1px dashed #ccc;margin:8px 0;}
            button{display:none;}
        </style></head>
        <body>
            <h2>RISHA Pet Supplies</h2>
            <div class="info">123 Main St, Caloocan City</div>
            <div class="info">Tel: (02) 8123-4567</div>
            <hr>
            <div style="text-align:left;font-size:11px;line-height:1.6;">
                <div>Receipt #: <strong>${receiptNum}</strong></div>
                <div>Date: ${now}</div>
                <div>Cashier: ${user ? user.full_name || user.username : 'N/A'}</div>
                <div>Customer: ${customer}</div>
                <div>Payment: ${payment.toUpperCase()}</div>
            </div>
            <hr>
            <table><thead><tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itemsHTML}</tbody></table>
            <hr>
            <div class="total-row"><span>Subtotal:</span><span>₱${subtotal.toFixed(2)}</span></div>
            <div class="total-row"><span>Discount (${discPct}%):</span><span>-₱${discAmt.toFixed(2)}</span></div>
            <div class="grand-total">TOTAL: ₱${total.toFixed(2)}</div>
            <div class="footer">
                Thank you for your purchase!<br>
                Visit us again at RISHA Pet Supplies
            </div>
            <br><button onclick="window.print()">Print</button>
        </body></html>
    `);
    receiptWindow.document.close();
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('saleModal')) closeSaleModal();
    if (e.target === document.getElementById('viewSaleModal')) closeViewSaleModal();
});

function exportSalesCsv() {
    if (!allSales.length) { showToast('No sales to export', 'error'); return; }
    const headers = ['Sale #', 'Date', 'Customer', 'Items', 'Total Amount', 'Payment', 'Status'];
    const rows = allSales.map(s => [
        s.receipt_number || s.id,
        s.transaction_date || s.created_at || '',
        s.customer_name || 'Walk-in',
        (s.items || []).length,
        parseFloat(s.total_amount || 0).toFixed(2),
        s.payment_method || 'cash',
        s.status || 'completed'
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales_export_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Sales exported successfully', 'success');
}

function filterSalesByDate() {
    const from = document.getElementById('dateFrom')?.value;
    const to = document.getElementById('dateTo')?.value;
    if (!from && !to) { showToast('Select a date range', 'error'); return; }
    loadSales(from || undefined, to || undefined);
}

function clearDateFilter() {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    loadSales();
}
