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

let allProducts = [];
let cartItems = [];
let barcodeBuffer = '';
let lastKeyTime = 0;
// This POS is cash-only: every sale is recorded with payment_method 'cash'.
const PAYMENT_METHOD = 'cash';
const POS_PAGE_SIZE = 20;
let posDisplayCount = POS_PAGE_SIZE;
let posFilteredProducts = [];

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    if (isViewer()) {
        document.querySelector('.pos-cart-actions .btn-primary')?.remove();
    }
    await loadProducts();
    setupBarcodeListener();
    document.getElementById('posSearchInput')?.addEventListener('keyup', filterProducts);
});

async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE}/products`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allProducts = Array.isArray(data.data) ? data.data : [];
            posDisplayCount = POS_PAGE_SIZE;
            renderProducts(allProducts);
            renderCategoryFilters();
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

function productCategory(p) {
    return p.category_name || p.category || '';
}

function renderCategoryFilters() {
    const cats = new Set();
    allProducts.forEach(p => { const c = productCategory(p); if (c) cats.add(c); });
    const container = document.getElementById('categoryFilters');
    if (!container) return;
    let html = '<button class="pos-category-filter active" data-cat="" onclick="filterByCategory(this,\'\')">All</button>';
    cats.forEach(c => {
        html += `<button class="pos-category-filter" data-cat="${escHtml(c)}" onclick="filterByCategory(this,'${escHtml(c)}')">${escHtml(c)}</button>`;
    });
    container.innerHTML = html;
}

let activeCategory = '';

function filterByCategory(btn, cat) {
    activeCategory = cat;
    posDisplayCount = POS_PAGE_SIZE;
    document.querySelectorAll('.pos-category-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterProducts();
}

function filterProducts() {
    posDisplayCount = POS_PAGE_SIZE;
    const q = (document.getElementById('posSearchInput')?.value || '').toLowerCase();
    const filtered = allProducts.filter(p => {
        const matchSearch = !q || (p.name || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
        const matchCat = !activeCategory || productCategory(p) === activeCategory;
        return matchSearch && matchCat;
    });
    renderProducts(filtered);
}

function renderProducts(products) {
    const grid = document.getElementById('productGrid');
    if (!grid) return;
    posFilteredProducts = products;
    if (products.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);"><span class="material-symbols-outlined" style="font-size:40px;">search_off</span><br>No products found</div>';
        document.getElementById('posPagination').innerHTML = '';
        return;
    }
    const limited = products.slice(0, posDisplayCount);
    grid.innerHTML = limited.map(p => {
        const unitLabel = getUnitLabel(p.unit_type);
        const stock = parseFloat(p.stock_quantity) || 0;
        let stockClass = '';
        let stockText = stock + unitLabel;
        if (stock <= 0) { stockClass = 'out'; stockText = 'Out of stock'; }
        else if (stock <= 10) stockClass = 'low';
        const cat = productCategory(p).toLowerCase();
        const icon = cat.includes('food') || cat.includes('treat') ? 'pet_supplies'
            : cat.includes('toy') ? 'toys'
            : cat.includes('medicine') || cat.includes('health') ? 'medication'
            : cat.includes('groom') ? 'soap'
            : 'inventory_2';
        return `<div class="pos-product-card" onclick="addToCart(${p.id})" title="${escHtml(p.name)}">
            <div class="p-img">${p.image_url ? `<img class="p-img-photo" src="${escHtml(p.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="material-symbols-outlined" style="font-size:22px;">${icon}</span></div>
            <div class="p-name">${escHtml(p.name)}</div>
            <div class="p-price">₱${parseFloat(p.unit_price || 0).toFixed(2)}</div>
            <div class="p-stock ${stockClass}">${stockText}</div>
        </div>`;
    }).join('');
    updatePagination('posPagination', products, posDisplayCount, 'showMorePosProducts');
}

function showMorePosProducts() {
    posDisplayCount += POS_PAGE_SIZE;
    renderProducts(posFilteredProducts);
}

// Find a product by scanned/typed code (barcode or SKU, case/space tolerant)
// and add it to the cart. Returns true if something was added.
function scanToCart(rawCode) {
    const code = String(rawCode || '').trim();
    if (code.length < 2) return false;
    const norm = code.toLowerCase();
    let found = allProducts.find(p =>
        (p.barcode && String(p.barcode).trim() === code) ||
        (p.sku && String(p.sku).trim().toLowerCase() === norm));
    if (!found) {
        // fall back to a single unambiguous name/sku/barcode match
        const matches = allProducts.filter(p =>
            (p.name || '').toLowerCase().includes(norm) ||
            (p.sku || '').toLowerCase().includes(norm) ||
            (p.barcode || '').toLowerCase().includes(norm));
        if (matches.length === 1) found = matches[0];
    }
    if (found) { addToCart(found.id); return true; }
    showToast('No product found for "' + code + '"', 'error');
    return false;
}

function setupBarcodeListener() {
    const scanInput = document.getElementById('barcodeScanInput');
    const searchInput = document.getElementById('posSearchInput');

    // Timing-based hardware-scanner capture. Runs in the capture phase so it
    // sees keys before the focused field. A scanner types a whole code in a
    // fast burst (~10-40ms/char); a human types much slower. We detect the
    // burst and add to the cart whether or not the scanner sends an Enter.
    let buf = '', tStart = 0, tPrev = 0, idleTimer = null;

    function clearActiveField() {
        const el = document.activeElement;
        if (el && el.tagName === 'INPUT') {
            el.value = '';
            if (el.id === 'posSearchInput') filterProducts();
        }
    }
    function tryBurst(hadEnter) {
        const code = buf.trim();
        const dur = (performance.now() - tStart) || 1;
        const isScan = code.length >= 3 && dur < code.length * 55; // fast => scanner
        buf = '';
        if (isScan && (hadEnter || code.length >= 4)) {
            if (scanToCart(code)) clearActiveField();
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
            e.preventDefault();
            if (scanInput) { scanInput.value = ''; scanInput.focus(); showToast('Scanner ready', 'info'); }
            return;
        }
        const now = performance.now();
        if (now - tPrev > 60) { buf = ''; tStart = now; } // long gap => new sequence
        tPrev = now;
        clearTimeout(idleTimer);

        if (e.key === 'Enter') {
            if (tryBurst(true)) { e.preventDefault(); e.stopImmediatePropagation(); }
            return;
        }
        if (e.key.length === 1) {
            if (buf === '') tStart = now;
            buf += e.key;
            // scanners with no Enter suffix: submit shortly after the burst ends
            idleTimer = setTimeout(() => { tryBurst(false); }, 130);
        }
    }, true);

    // Manual entry: type a barcode/SKU and press Enter to add (slow typing that
    // the burst detector intentionally ignores).
    function manualEnter(el) {
        if (!el) return;
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (scanToCart(el.value)) { el.value = ''; if (el.id === 'posSearchInput') filterProducts(); }
            }
        });
    }
    manualEnter(scanInput);
    manualEnter(searchInput);
}

function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    const stock = parseFloat(product.stock_quantity) || 0;
    if (stock <= 0) { showToast('Out of stock', 'error'); return; }
    const existing = cartItems.find(i => i.product_id === productId);
    const qtyStep = getQtyStep(product.unit_type);
    if (existing) {
        existing.quantity = Math.min(parseFloat((existing.quantity + qtyStep).toFixed(2)), stock);
        existing.total_price = existing.quantity * existing.unit_price;
    } else {
        cartItems.push({
            product_id: product.id,
            product_name: product.name,
            unit_price: parseFloat(product.unit_price),
            quantity: qtyStep,
            total_price: qtyStep * parseFloat(product.unit_price),
            unit_type: product.unit_type
        });
    }
    renderCart();
    updateCartTotals();
    showToast(`${product.name} added to cart`, 'success');
}

function clearCart() {
    if (cartItems.length === 0) return;
    cartItems = [];
    document.getElementById('posDiscount').value = 0;
    const tenderInput = document.getElementById('posTendered');
    if (tenderInput) tenderInput.value = '';
    renderCart();
    updateCartTotals();
    showToast('Cart cleared', 'info');
}

function clearBarcodeInput() {
    const input = document.getElementById('barcodeScanInput');
    if (input) { input.value = ''; input.focus(); }
}

function removeFromCart(idx) {
    const removed = cartItems.splice(idx, 1)[0];
    renderCart();
    updateCartTotals();
    showToast(`${removed.product_name} removed`, 'info');
}

function updateCartQty(idx, delta) {
    const item = cartItems[idx];
    if (!item) return;
    const qtyStep = getQtyStep(item.unit_type);
    const newQty = parseFloat((item.quantity + delta * qtyStep).toFixed(2));
    const maxStock = parseFloat(allProducts.find(p => p.id === item.product_id)?.stock_quantity || 999);
    if (newQty < qtyStep) { removeFromCart(idx); return; }
    if (newQty > maxStock) { showToast('Not enough stock', 'error'); return; }
    item.quantity = newQty;
    item.total_price = newQty * item.unit_price;
    renderCart();
    updateCartTotals();
}

function setCartQty(idx, value) {
    const item = cartItems[idx];
    if (!item) return;
    const qtyStep = getQtyStep(item.unit_type);
    let newQty = parseFloat(value);
    if (isNaN(newQty) || newQty < qtyStep) { removeFromCart(idx); return; }
    newQty = parseFloat(newQty.toFixed(2));
    const maxStock = parseFloat(allProducts.find(p => p.id === item.product_id)?.stock_quantity || 999);
    if (newQty > maxStock) {
        showToast('Only ' + maxStock + ' in stock', 'error');
        newQty = maxStock;
    }
    item.quantity = newQty;
    item.total_price = newQty * item.unit_price;
    renderCart();
    updateCartTotals();
}

function renderCart() {
    setTimeout(animateCartChange, 30);
    const container = document.getElementById('cartItems');
    if (!container) return;
    if (cartItems.length === 0) {
        container.innerHTML = '<div class="pos-cart-empty"><div class="empty-icon"><span class="material-symbols-outlined" style="font-size:44px;">shopping_cart</span></div>Cart is empty<br><span style="font-size:11px;color:var(--text-muted);">Click a product to add</span></div>';
        document.getElementById('cartCount').textContent = '0';
        return;
    }
    document.getElementById('cartCount').textContent = cartItems.length;
    container.innerHTML = cartItems.map((item, idx) => {
        const ul = getUnitLabelShort(item.unit_type);
        return `<div class="pos-cart-item">
            <div class="pos-ci-info">
                <div class="pos-ci-name">${escHtml(item.product_name)}</div>
                <div class="pos-ci-meta">₱${item.unit_price.toFixed(2)} / ${ul}</div>
            </div>
            <div class="pos-ci-qty">
                <button onclick="updateCartQty(${idx}, -1)" title="Decrease"><span class="material-symbols-outlined" style="font-size:14px;">remove</span></button>
                <input type="number" class="qty-val" value="${item.quantity}" min="0" step="${getQtyStep(item.unit_type)}" onchange="setCartQty(${idx}, this.value)" onclick="this.select()">
                <button onclick="updateCartQty(${idx}, 1)" title="Increase"><span class="material-symbols-outlined" style="font-size:14px;">add</span></button>
            </div>
            <div class="pos-ci-total">₱${item.total_price.toFixed(2)}</div>
            <button class="pos-ci-remove" onclick="removeFromCart(${idx})" title="Remove"><span class="material-symbols-outlined">close</span></button>
        </div>`;
    }).join('');
}

function animateCartChange() {
    if (!window.fetchMotion) return;
    const items = document.querySelectorAll('.pos-cart-item');
    fetchMotion.cartPulse(document.getElementById('cartCount'), items[items.length - 1]);
}

function updateCartTotals() {
    const subtotal = cartItems.reduce((sum, i) => sum + i.total_price, 0);
    const discPct = parseFloat(document.getElementById('posDiscount')?.value) || 0;
    const discAmt = subtotal * (discPct / 100);
    const total = subtotal - discAmt;
    document.getElementById('posSubtotal').textContent = '₱' + subtotal.toFixed(2);
    document.getElementById('posDiscountAmount').textContent = '-₱' + discAmt.toFixed(2);
    document.getElementById('posTotal').textContent = '₱' + total.toFixed(2);
    const payTotal = document.getElementById('posPayTotal');
    if (payTotal) payTotal.textContent = '₱' + total.toFixed(2);
    updateChange();
}

function getCartTotal() {
    const subtotal = cartItems.reduce((sum, i) => sum + i.total_price, 0);
    const discPct = parseFloat(document.getElementById('posDiscount')?.value) || 0;
    return subtotal - subtotal * (discPct / 100);
}

function updateChange() {
    const changeEl = document.getElementById('posChange');
    const changeRow = document.getElementById('posChangeRow');
    if (!changeEl || !changeRow) return;
    const tendered = parseFloat(document.getElementById('posTendered')?.value) || 0;
    const total = getCartTotal();
    const change = tendered - total;
    if (tendered <= 0) {
        changeEl.textContent = '₱0.00';
        changeRow.classList.remove('insufficient', 'sufficient');
        return;
    }
    changeEl.textContent = (change < 0 ? '-₱' : '₱') + Math.abs(change).toFixed(2);
    changeRow.classList.toggle('insufficient', change < 0);
    changeRow.classList.toggle('sufficient', change >= 0);
}

function quickCash(amount) {
    const input = document.getElementById('posTendered');
    if (!input) return;
    if (amount === 'exact') {
        input.value = getCartTotal().toFixed(2);
    } else {
        const current = parseFloat(input.value) || 0;
        input.value = (current + amount).toFixed(2);
    }
    updateChange();
}

async function completeSale() {
    if (isViewer()) { showToast('View-only account. Cannot process sales.', 'error'); return; }
    if (cartItems.length === 0) { showToast('Cart is empty', 'error'); return; }
    const discount = parseFloat(document.getElementById('posDiscount')?.value) || 0;
    const subtotal = cartItems.reduce((sum, i) => sum + i.total_price, 0);
    const discAmt = subtotal * (discount / 100);
    const total = subtotal - discAmt;
    const itemSummary = cartItems.map(i => `${escHtml(i.product_name)} × ${i.quantity}`).join('<br>');
    const customer = document.getElementById('posCustomerName')?.value || 'Walk-in';
    const tendered = parseFloat(document.getElementById('posTendered')?.value) || 0;
    if (tendered <= 0) { showToast('Enter the cash amount received', 'error'); document.getElementById('posTendered')?.focus(); return; }
    if (tendered < total) { showToast('Insufficient cash — customer gave less than the total', 'error'); return; }
    const change = tendered - total;
    const msg = `<div style="text-align:left;font-size:13px;line-height:1.7;">
        <div style="margin-bottom:10px;"><strong>Items:</strong><br>${itemSummary}</div>
        <div><strong>Subtotal:</strong> ₱${subtotal.toFixed(2)}</div>
        ${discount > 0 ? `<div><strong>Discount:</strong> ${discount}% (-₱${discAmt.toFixed(2)})</div>` : ''}
        <div style="font-size:16px;font-weight:800;margin-top:6px;padding-top:8px;border-top:2px solid var(--border-glass);"><strong>Total:</strong> ₱${total.toFixed(2)}</div>
        <div style="margin-top:6px;"><strong>Payment:</strong> CASH</div>
        <div><strong>Cash received:</strong> ₱${tendered.toFixed(2)}</div>
        <div><strong>Change:</strong> <span style="font-weight:800;color:var(--success);">₱${change.toFixed(2)}</span></div>
        <div><strong>Customer:</strong> ${escHtml(customer)}</div>
    </div>`;
    showConfirmDialog('Confirm Cash Sale', msg, async () => {
        const saleData = {
            payment_method: PAYMENT_METHOD,
            notes: 'POS sale',
            customer_name: document.getElementById('posCustomerName')?.value || '',
            customer_phone: document.getElementById('posCustomerPhone')?.value || '',
            discount_percent: discount,
            items: cartItems.map(i => ({
                product_id: i.product_id,
                quantity: i.quantity,
                unit_price: i.unit_price
            }))
        };
        try {
            const response = await fetch(`${API_BASE}/sales`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(saleData)
            });
            const data = await response.json();
            if (data.success) {
                showToast('Sale completed!' + (change > 0 ? ' Change: ₱' + change.toFixed(2) : ''), 'success');
                const saleId = data.data?.id || data.data?.sale_id;
                cartItems = [];
                renderCart();
                updateCartTotals();
                document.getElementById('posCustomerName').value = '';
                document.getElementById('posCustomerPhone').value = '';
                document.getElementById('posDiscount').value = 0;
                const tenderInput = document.getElementById('posTendered');
                if (tenderInput) tenderInput.value = '';
                updateChange();
                if (saleId) printReceipt(saleId, tendered, change);
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Error creating sale:', error);
            showToast('Failed to create sale', 'error');
        }
    }, 'Complete Sale', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">payments</span>');
}

async function printReceipt(saleId, tendered, change) {
    try {
        const res = await fetch(`${API_BASE}/sales/${saleId}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) { showToast('Could not load receipt data', 'error'); return; }
        const sale = data.data;
        const itemsHTML = (sale.items || []).map(item => {
            const ul = getUnitLabel(item.unit_type);
            return `<tr><td style="padding:3px 4px;border-bottom:1px dashed #ccc;">${item.product_name}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:center;">${parseFloat(item.quantity)}${ul}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">₱${parseFloat(item.unit_price).toFixed(2)}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">₱${parseFloat(item.subtotal || item.quantity * item.unit_price).toFixed(2)}</td></tr>`;
        }).join('');
        const total = parseFloat(sale.total_amount || 0).toFixed(2);
        const disc = parseFloat(sale.discount_percent || 0).toFixed(2);
        const subtotal = parseFloat(sale.total_amount || 0).toFixed(2);
        const date = new Date(sale.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const receiptWindow = window.open('', 'Receipt', 'width=400,height=600');
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
                <table>
                    <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>
                    <tbody>${itemsHTML}</tbody>
                </table>
                <hr>
                <div class="total-row"><span>Subtotal:</span><span>₱${subtotal}</span></div>
                ${disc > 0 ? `<div class="total-row"><span>Discount (${disc}%):</span><span>-₱${(parseFloat(subtotal) * disc / 100).toFixed(2)}</span></div>` : ''}
                <div class="grand-total">TOTAL: ₱${total}</div>
                <div class="footer">
                    <div>Payment: ${(sale.payment_method || 'cash').toUpperCase()}</div>
                    ${typeof tendered === 'number' && tendered > 0 ? `<div>Cash: ₱${tendered.toFixed(2)}</div><div>Change: ₱${(change || 0).toFixed(2)}</div>` : ''}
                    <div style="margin-top:8px;">Thank you for your purchase!</div>
                    <div style="margin-top:4px;">Items are non-returnable</div>
                    <div class="barcode">${String(sale.sale_number || sale.id).padStart(6, '0')}</div>
                    <div style="font-size:8px;color:#aaa;margin-top:4px;">This serves as your official receipt</div>
                </div>
            </body></html>
        `);
        receiptWindow.document.close();
    } catch (error) {
        console.error('Error printing receipt:', error);
        showToast('Failed to print receipt', 'error');
    }
}

function setupAutocomplete() {
    const input = document.getElementById('posSearchInput');
    if (!input) return;
    const suggest = document.createElement('div');
    suggest.id = 'posSearchSuggest';
    suggest.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--bg-elevated);border:1px solid var(--border-glass);border-radius:var(--radius-md);margin-top:4px;max-height:240px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.10);z-index:50;display:none;';
    input.parentElement.appendChild(suggest);
    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 1) { suggest.style.display = 'none'; return; }
        const matches = allProducts.filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q)
        ).slice(0, 6);
        if (matches.length === 0) { suggest.style.display = 'none'; return; }
        suggest.innerHTML = matches.map(p =>
            `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:12px;color:var(--text-primary);border-bottom:1px solid var(--border-subtle);transition:background 0.15s;"
                  onmouseover="this.style.background='var(--gray-50)'"
                  onmouseout="this.style.background='transparent'"
                  onclick="addToCart(${p.id});document.getElementById('posSearchSuggest').style.display='none'">
                <span style="font-size:18px;">${p.category?.toLowerCase().includes('food') ? '🍖' : p.category?.toLowerCase().includes('toy') ? '🧸' : '📦'}</span>
                <span style="flex:1;font-weight:600;">${escHtml(p.name)}</span>
                <span style="font-weight:700;color:var(--nav-text-active);">₱${parseFloat(p.unit_price || 0).toFixed(2)}</span>
            </div>`
        ).join('');
        suggest.style.display = 'block';
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.pos-search-wrap')) suggest.style.display = 'none';
    });
}
