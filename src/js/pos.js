let allSales = [];
let currentSaleItems = [];
let viewingSaleId = null;
let allProducts = [];
let barcodeBuffer = '';
let lastKeyTime = 0;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await Promise.all([loadProducts(), loadSales()]);
    setupBarcodeListener();
    setupAutocomplete();
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
        opt.textContent = `${p.name} (Stock: ${p.stock_quantity})`;
        opt.dataset.price = p.unit_price;
        opt.dataset.stock = p.stock_quantity;
        opt.dataset.expiration = p.expiration_date || '';
        sel.appendChild(opt);
    });
    sel.addEventListener('change', (e) => {
        const selected = e.target.options[e.target.selectedIndex];
        if (selected.value) {
            document.getElementById('unit_price').value = parseFloat(selected.dataset.price).toFixed(2);
            const stock = parseInt(selected.dataset.stock);
            document.getElementById('maxStock').textContent = stock;
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
            list.innerHTML = matches.map(p =>
                `<div class="ac-item" onclick="selectAutocomplete(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.unit_price}, ${p.stock_quantity}, '${(p.expiration_date || '').replace(/'/g, "\\'")}')">
                    ${p.name} <small>Stock: ${p.stock_quantity} | ₱${parseFloat(p.unit_price).toFixed(2)}</small>
                </div>`
            ).join('');
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
                    selectAutocomplete(found.id, found.name, found.unit_price, found.stock_quantity, found.expiration_date || '');
                }
            }
        }
    });
}

function selectAutocomplete(id, name, price, stock, expiration) {
    document.getElementById('barcodeScanInput').value = '';
    document.getElementById('productAutocomplete').style.display = 'none';
    // Set product select
    const sel = document.getElementById('product_select');
    if (sel) sel.value = id;
    document.getElementById('unit_price').value = parseFloat(price).toFixed(2);
    document.getElementById('maxStock').textContent = stock;
    // Auto-add item with qty 1
    const qtyInput = document.getElementById('quantity');
    if (qtyInput) qtyInput.value = 1;
    addItemToSale();
}

function setupBarcodeListener() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        const now = Date.now();
        if (now - lastKeyTime > 100) barcodeBuffer = '';
        lastKeyTime = now;
        if (e.key === 'Enter' && barcodeBuffer.length > 3) {
            const barcode = barcodeBuffer;
            barcodeBuffer = '';
            const found = allProducts.find(p => p.barcode === barcode);
            if (found) {
                document.getElementById('barcodeScanInput').value = barcode;
                selectAutocomplete(found.id, found.name, found.unit_price, found.stock_quantity, found.expiration_date || '');
            } else {
                showToast('Product not found for barcode: ' + barcode, 'error');
            }
            e.preventDefault();
            return;
        }
        if (e.key.length === 1) barcodeBuffer += e.key;
    });
}

function updateItemTotal() {
    const qty = parseInt(document.getElementById('quantity')?.value) || 0;
    const price = parseFloat(document.getElementById('unit_price')?.value) || 0;
    const total = qty * price;
    const el = document.getElementById('itemTotal');
    if (el) el.textContent = '₱' + total.toFixed(2);
    // Validate against stock
    const maxStock = parseInt(document.getElementById('maxStock')?.textContent || '0');
    if (qty > maxStock) {
        document.getElementById('qtyWarning')?.classList.remove('hidden');
    } else {
        document.getElementById('qtyWarning')?.classList.add('hidden');
    }
}

async function loadSales() {
    try {
        const response = await fetch(`${API_BASE}/sales`, { headers: getAuthHeaders() });
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

function displaySales(sales) {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;
    if (sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No sales found</td></tr>';
        return;
    }
    tbody.innerHTML = sales.map(s => `
        <tr>
            <td>#${s.id}</td>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
            <td>${s.customer_name || 'Walk-in'}</td>
            <td>${s.staff_name || 'N/A'}</td>
            <td>${s.item_count || 0}</td>
            <td>₱${parseFloat(s.total_amount).toFixed(2)}</td>
            <td>${s.payment_method || 'N/A'}</td>
            <td>${s.payment_status === 'completed' ? '<span class="status-badge status-in-stock">Completed</span>' : '<span class="status-badge status-expired">' + (s.payment_status || 'N/A') + '</span>'}</td>
            <td>
                <button class="btn-view" onclick="viewSaleDetails(${s.id})">View</button>
                <button class="btn-delete" onclick="deleteSale(${s.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}

async function updateStats() {
    try {
        const totalRes = await fetch(`${API_BASE}/sales/total-sales`, { headers: getAuthHeaders() });
        const totalData = await totalRes.json();
        if (totalData.success) {
            setText('totalSalesAmount', '₱' + parseFloat(totalData.data.total_sales).toFixed(2));
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
    const term = e.target.value.toLowerCase();
    const filtered = allSales.filter(s =>
        s.id.toString().includes(term) ||
        (s.staff_name && s.staff_name.toLowerCase().includes(term))
    );
    displaySales(filtered);
});

function openNewSaleModal() {
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
    const qty = parseInt(document.getElementById('quantity').value);
    const unitPrice = parseFloat(document.getElementById('unit_price').value);

    if (!sel?.value) { showToast('Please select a product', 'error'); return; }
    if (!qty || qty <= 0) { showToast('Enter valid quantity', 'error'); return; }
    if (!unitPrice || unitPrice <= 0) { showToast('Invalid price', 'error'); return; }

    const option = sel.options[sel.selectedIndex];
    const stock = parseInt(option.dataset.stock);
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
        showToast(`Insufficient stock. Available: ${stock}`, 'error');
        return;
    }

    // Check if already in cart
    const existing = currentSaleItems.find(i => i.product_id === parseInt(sel.value));
    if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > stock) {
            showToast(`Total would exceed stock. Available: ${stock}, in cart: ${existing.quantity}`, 'error');
            return;
        }
        existing.quantity = newQty;
        existing.total_price = existing.quantity * existing.unit_price;
    } else {
        currentSaleItems.push({
            product_id: parseInt(sel.value),
            product_name: option.text.split('(')[0].trim(),
            quantity: qty,
            unit_price: unitPrice,
            total_price: qty * unitPrice
        });
    }

    updateItemsList();
    updateTotals();
    document.getElementById('quantity').value = 1;
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
    list.innerHTML = currentSaleItems.map((item, idx) => `
        <div class="item-row">
            <div class="item-info">
                <div class="item-name">${item.product_name}</div>
                <div class="item-detail">Qty: ${item.quantity} × ₱${item.unit_price.toFixed(2)}</div>
            </div>
            <div class="item-price">₱${item.total_price.toFixed(2)}</div>
            <button type="button" class="btn-remove" onclick="removeItemFromSale(${idx})">Remove</button>
        </div>
    `).join('');
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
            showToast('Sale completed!', 'success');
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
                        <tbody>${(sale.items || []).map(item => `
                            <tr><td>${item.product_name}</td><td>${item.quantity}</td><td>₱${parseFloat(item.unit_price).toFixed(2)}</td><td>₱${parseFloat(item.subtotal).toFixed(2)}</td></tr>
                        `).join('')}</tbody>
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
    if (viewingSaleId) {
        await deleteSale(viewingSaleId);
        closeViewSaleModal();
    }
}

async function deleteSale(id) {
    showConfirmDialog('Delete Sale', 'Are you sure you want to delete this sale? This cannot be undone.', async () => {
        try {
            const response = await fetch(`${API_BASE}/sales/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showToast('Sale deleted!', 'success');
                await loadSales();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Error deleting sale:', error);
            showToast('Failed to delete sale', 'error');
        }
    }, 'Yes, Delete', '🗑️');
}

function printReceipt(saleId) {
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) { showToast('Sale data not available', 'error'); return; }
    const receiptWindow = window.open('', 'Receipt', 'width=400,height=600');
    const itemsHTML = (sale.items || []).map(item =>
        `<tr><td>${item.product_name}</td><td>${item.quantity}</td><td>₱${parseFloat(item.unit_price).toFixed(2)}</td><td>₱${parseFloat(item.subtotal || item.quantity * item.unit_price).toFixed(2)}</td></tr>`
    ).join('');
    receiptWindow.document.write(`
        <html><head><title>Receipt #${sale.id}</title>
        <style>body{font-family:monospace;padding:20px;text-align:center}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:4px;border-bottom:1px solid #ccc;text-align:left}.total{font-size:1.2em;font-weight:bold;margin-top:10px}@media print{button{display:none}}</style></head>
        <body><h2>RISHA Pet Supplies</h2><p>Receipt #${sale.id}</p><p>${new Date(sale.created_at).toLocaleString()}</p>
        <hr><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${itemsHTML}</tbody></table>
        <hr><div class="total">Total: ₱${parseFloat(sale.total_amount).toFixed(2)}</div>
        <p>Thank you for your purchase!</p><br><button onclick="window.print()">Print</button>
        </body></html>
    `);
    receiptWindow.document.close();
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function showToast(message, type) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-weight:500;z-index:9999;transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6';
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('saleModal')) closeSaleModal();
    if (e.target === document.getElementById('viewSaleModal')) closeViewSaleModal();
});
console.log('Sales JS version: 20260513-v4');
