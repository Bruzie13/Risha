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
const POS_PAGE_SIZE = 10;
let posDisplayCount = POS_PAGE_SIZE;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    if (isViewer()) {
        document.getElementById('posPayBtn')?.remove();
    }
    setReceiptMeta();
    await Promise.all([loadProducts(), renderCategoryFilters()]);
    loadTill();
    setupBarcodeListener();
    document.getElementById('posSearchInput')?.addEventListener('keyup', filterProducts);
    // Live stock: another terminal's sale shows here without a refresh
    setInterval(refreshStockLevels, 10000);
    initThermalPrinter();
});

// Show the "Connect Printer" control only where WebUSB direct printing can work
// (Chrome/Edge over HTTPS). Silently reconnect a printer authorised earlier.
async function initThermalPrinter() {
    const btn = document.getElementById('connectPrinterBtn');
    if (!btn || !window.escposPrint || !escposPrint.available()) return;
    btn.style.display = 'inline-flex';
    try {
        if (await escposPrint.tryReconnect()) reflectPrinterState();
    } catch (e) { /* needs an explicit connect */ }
}

function reflectPrinterState() {
    const btn = document.getElementById('connectPrinterBtn');
    const label = document.getElementById('connectPrinterLabel');
    if (!btn || !label) return;
    const on = window.escposPrint && escposPrint.isConnected();
    label.textContent = on ? 'Printer connected' : 'Connect printer';
    btn.title = on
        ? 'Thermal printer connected — receipts print directly, no dialog. Click to disconnect.'
        : 'Connect a USB thermal printer for one-tap receipts (no print dialog)';
    btn.style.opacity = on ? '1' : '';
    btn.querySelector('.material-symbols-outlined').textContent = on ? 'print_connect' : 'print';
}

async function connectThermalPrinter() {
    if (!window.escposPrint) return;
    try {
        if (escposPrint.isConnected()) {
            await escposPrint.disconnect();
            showToast('Thermal printer disconnected', 'info');
        } else {
            await escposPrint.connect();
            showToast('Thermal printer connected — receipts now print directly', 'success');
        }
    } catch (e) {
        // User dismissing the chooser throws too; only surface real errors
        if (e && e.name !== 'NotFoundError') {
            console.error('Printer connect error:', e);
            const busy = /busy|access|claim/i.test(e.message || '');
            const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
            const isWin = /win/i.test(plat);
            const isMac = /mac/i.test(plat);
            let msg;
            if (busy && isWin) {
                msg = 'Windows is using its own driver for this printer, which blocks direct access. On Windows you don\'t need this button — install the printer\'s driver (the bundled CD, or "XP-58" from the maker\'s site), set it as the default printer, then just complete the sale to print normally at 58mm.';
            } else if (busy && isMac) {
                msg = 'macOS is holding the printer through its own driver. Open System Settings → Printers, remove "YICHIP_POS58_Printer", then click Connect Printer again.';
            } else if (busy) {
                msg = 'The system is holding this printer through its own driver. Remove/disable it in your OS printer settings, then click Connect Printer again — or just complete the sale to print through the normal driver.';
            } else {
                msg = (e.message || 'Unknown error') + '. Use Chrome or Edge, and make sure the printer is plugged in.';
            }
            showErrorDialog('Could not connect printer', msg);
        }
    }
    reflectPrinterState();
}

// The backend does search/category filtering and serves one page at a time;
// allProducts only ever holds the pages fetched so far.
let posTotal = 0;
let posCatalogSize = null;
let posSearchDebounce = null;

const UNSELLABLE_VIEW = '__unsellable';

function posQuery() {
    const params = new URLSearchParams();
    const q = (document.getElementById('posSearchInput')?.value || '').trim();
    if (q) params.set('search', q);
    /* The grid shows what can be sold, by name. Expired and sold-out products
       used to be mixed in, and on some days filled the whole first screen.
       They now sit behind their own "Can't be sold" button. A search still
       looks through everything, sellable first, so a cashier who types a
       name can see that it is expired rather than wonder where it went. */
    if (activeCategory === UNSELLABLE_VIEW) {
        params.set('status', 'unsellable');
        params.set('sort', 'name');
    } else {
        if (activeCategory) params.set('category', activeCategory);
        if (q) params.set('sort', 'sellable');
        else { params.set('status', 'sellable'); params.set('sort', 'name'); }
    }
    return params;
}

// reset=true refetches page 1 for the current search/category;
// reset=false appends the next page (Show more).
async function loadProducts(reset = true) {
    try {
        if (reset) posDisplayCount = POS_PAGE_SIZE;
        const params = posQuery();
        params.set('limit', Math.max(posDisplayCount - (reset ? 0 : allProducts.length), POS_PAGE_SIZE));
        params.set('offset', reset ? 0 : allProducts.length);
        const response = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
            allProducts = reset ? data.data : allProducts.concat(data.data);
            posTotal = data.total ?? allProducts.length;
            renderProducts(allProducts);
        }
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

// Poll the tiny id→stock endpoint; when something changed, refetch just the
// visible page(s) of the current query so stocks stay live.
async function refreshStockLevels() {
    if (document.hidden || !allProducts.length) return;
    try {
        const response = await fetch(`${API_BASE}/products/stock-levels`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (!data.success || !Array.isArray(data.data)) return;
        const levels = new Map(data.data.map(r => [r.id, parseFloat(r.stock_quantity)]));
        const changed = allProducts.some(p => levels.has(p.id) && parseFloat(p.stock_quantity) !== levels.get(p.id));
        const removed = allProducts.some(p => !levels.has(p.id));
        const grewOrShrank = posCatalogSize !== null && data.data.length !== posCatalogSize;
        posCatalogSize = data.data.length;
        if (!changed && !removed && !grewOrShrank) return;
        const params = posQuery();
        params.set('limit', Math.max(allProducts.length, POS_PAGE_SIZE));
        params.set('offset', 0);
        const full = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeaders() });
        const fullData = await full.json();
        if (fullData.success && Array.isArray(fullData.data)) {
            allProducts = fullData.data;
            posTotal = fullData.total ?? allProducts.length;
            renderProducts(allProducts);
        }
    } catch (e) {
        // Network hiccup — keep showing what we have; next poll retries.
    }
}

function productCategory(p) {
    return p.category_name || p.category || '';
}

/* One colour per kind of product. It is the dot beside a category and the
   tint of every product row in it, so a cashier learns to find things by
   colour as well as by name. */
function categoryTone(name) {
    const c = String(name || '').toLowerCase();
    if (c.includes('food') || c.includes('treat')) return 'food';
    if (c.includes('health') || c.includes('medic') || c.includes('wellness')) return 'health';
    if (c.includes('access') || c.includes('groom')) return 'care';
    if (c.includes('litter') || c.includes('waste')) return 'litter';
    if (c.includes('cage') || c.includes('habitat')) return 'home';
    if (c.includes('toy')) return 'toy';
    return 'other';
}

/* Who is selling and what day it is, at the top of the receipt. */
function setReceiptMeta() {
    const el = document.getElementById('tillReceiptMeta');
    if (!el) return;
    let name = '';
    try {
        const user = JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || '{}');
        name = String(user.full_name || user.username || '').trim().split(/\s+/)[0] || '';
    } catch (e) { /* no name, just the date */ }
    const day = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    el.textContent = (name ? `Cashier: ${name} · ` : '') + day;
}

// The category list comes from the categories table, each with how many of
// its products can be sold today. Filtering happens on the server by id.
async function renderCategoryFilters() {
    const container = document.getElementById('categoryFilters');
    if (!container) return;
    const total = async status => {
        try {
            const res = await fetch(`${API_BASE}/products?status=${status}&limit=1&fields=light`, { headers: getAuthHeaders() });
            const data = await res.json();
            return data.success ? Number(data.total) : null;
        } catch (e) { return null; }
    };
    let cats = [];
    const [sellable, unsellable] = await Promise.all([
        total('sellable'), total('unsellable'),
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/products/categories`, { headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success && Array.isArray(data.data)) cats = data.data;
            } catch (e) { /* keep just "All products" */ }
        })()
    ]);
    const count = n => (n == null || isNaN(n) ? '' : `<em>${Number(n)}</em>`);
    const on = cat => (String(activeCategory) === String(cat) ? ' active' : '');
    let html = `<button type="button" class="pos-category-filter${on('')}" data-cat="" onclick="filterByCategory(this,'')"><span>All products</span>${count(sellable)}</button>`;
    cats.forEach(c => {
        html += `<button type="button" class="pos-category-filter${on(c.id)}" data-cat="${Number(c.id)}" onclick="filterByCategory(this,'${Number(c.id)}')"><i class="tone-${categoryTone(c.name)}"></i><span>${escHtml(c.name)}</span>${count(c.sellable_count)}</button>`;
    });
    html += `<button type="button" class="pos-category-filter pos-cat-unsellable${on(UNSELLABLE_VIEW)}" data-cat="${UNSELLABLE_VIEW}" onclick="filterByCategory(this,'${UNSELLABLE_VIEW}')" title="Expired or sold-out products. They cannot be added to a sale."><span>Can't be sold</span>${count(unsellable)}</button>`;
    container.innerHTML = html;
}

let activeCategory = ''; // category id, '' = all

function filterByCategory(btn, cat) {
    activeCategory = cat;
    document.querySelectorAll('.pos-category-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadProducts();
}

// Debounced: each keystroke would otherwise fire a server query
function filterProducts() {
    clearTimeout(posSearchDebounce);
    posSearchDebounce = setTimeout(() => loadProducts(), 250);
}

/* Why a product cannot be sold right now, or null if it can. One rule, used
   by the product grid, the search suggestions, the barcode scanner and the
   cart, so none of them can disagree. A product is expired once its
   expiry date has passed; it can still be sold on the date itself. */
function unavailableReason(p) {
    if (!p) return null;
    if (p.expiration_date) {
        // The date can arrive as a UTC datetime; read the calendar day in local time.
        const d = new Date(p.expiration_date);
        if (!isNaN(d)) {
            const day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
            const now = new Date();
            const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
            if (day < today) return 'Expired';
        }
    }
    if ((parseFloat(p.stock_quantity) || 0) <= 0) return 'Sold out';
    return null;
}

function renderProducts(products) {
    const grid = document.getElementById('productGrid');
    if (!grid) return;
    if (products.length === 0) {
        grid.innerHTML = '<div class="till-none"><span class="material-symbols-outlined">search_off</span><b>No products found</b><span>Try another name, or pick a different category.</span></div>';
        document.getElementById('posPagination').innerHTML = '';
        return;
    }
    const limited = products.slice(0, posDisplayCount);
    grid.innerHTML = limited.map(p => {
        const unitLabel = getUnitLabel(p.unit_type);
        const stock = parseFloat(p.stock_quantity) || 0;
        let stockClass = '';
        let stockText = formatQty(stock) + unitLabel + ' left';
        const blocked = unavailableReason(p);
        if (blocked) {
            stockClass = 'out';
            // the tag says which; this line says the detail behind it
            stockText = blocked === 'Expired'
                ? 'Expired ' + new Date(p.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'None left';
        }
        else if (stock <= 10) stockClass = 'low';
        const category = productCategory(p);
        const cat = category.toLowerCase();
        const icon = cat.includes('food') || cat.includes('treat') ? 'pet_supplies'
            : cat.includes('toy') ? 'toys'
            : cat.includes('medicine') || cat.includes('health') ? 'medication'
            : cat.includes('groom') || cat.includes('access') ? 'soap'
            : 'inventory_2';
        const tone = categoryTone(category);
        const name = escHtml(p.name);
        // Not sellable: no click handler at all, and it says why.
        const open = blocked
            ? `<div class="till-row unavailable tone-${tone}" aria-disabled="true" title="${name} — ${blocked.toLowerCase()}, cannot be sold">`
            : `<div class="till-row tone-${tone}" role="button" tabindex="0" onclick="addToCart(${Number(p.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();addToCart(${Number(p.id)});}" title="Add ${name} to the sale">`;
        return `${open}
            <div class="tr-thumb">${p.image_url ? `<img src="${escHtml(p.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="material-symbols-outlined">${icon}</span></div>
            <div class="tr-name"><small>${escHtml(p.brand || category || '')}</small><b>${name}</b></div>
            <div class="tr-stock ${stockClass}">${stockText}</div>
            <div class="tr-price">${formatCurrency(parseFloat(p.unit_price || 0))}</div>
            ${blocked
                ? `<span class="tr-tag ${blocked === 'Expired' ? 'expired' : 'soldout'}">${blocked}</span>`
                : `<span class="tr-add"><span class="material-symbols-outlined">add</span><span>Add</span></span>`}
        </div>`;
    }).join('');
    updatePagination('posPagination', { length: posTotal }, posDisplayCount, 'showMorePosProducts', 'showLessPosProducts', POS_PAGE_SIZE);
}

async function showMorePosProducts() {
    posDisplayCount += POS_PAGE_SIZE;
    if (allProducts.length < Math.min(posDisplayCount, posTotal)) {
        await loadProducts(false); // fetch the next page from the backend
    } else {
        renderProducts(allProducts);
    }
}

// Steps back one page at a time, mirroring Show more — it used to jump all
// the way back to the first ten however many were open.
function showLessPosProducts() {
    posDisplayCount = Math.max(POS_PAGE_SIZE, posDisplayCount - POS_PAGE_SIZE);
    renderProducts(allProducts);
}

// Find a product by scanned/typed code (barcode or SKU, case/space tolerant)
// and add it to the cart. Falls back to a server search since only a page of
// products is loaded. Resolves true if something was added.
async function scanToCart(rawCode) {
    const code = String(rawCode || '').trim();
    if (code.length < 2) return false;
    const norm = code.toLowerCase();
    const exact = list => list.find(p =>
        (p.barcode && String(p.barcode).trim() === code) ||
        (p.sku && String(p.sku).trim().toLowerCase() === norm));
    let found = exact(allProducts);
    if (!found) {
        try {
            const res = await fetch(`${API_BASE}/products?search=${encodeURIComponent(code)}&limit=5`, { headers: getAuthHeaders() });
            const data = await res.json();
            const rows = (data.success && Array.isArray(data.data)) ? data.data : [];
            // exact barcode/SKU hit, or a single unambiguous match
            found = exact(rows) || (rows.length === 1 ? rows[0] : null);
            // keep it in memory so addToCart/cart stock checks can find it
            if (found && !allProducts.some(p => p.id === found.id)) allProducts.push(found);
        } catch (e) { /* treated as not found */ }
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
            scanToCart(code).then(ok => { if (ok) clearActiveField(); });
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
                scanToCart(el.value).then(ok => {
                    if (ok) { el.value = ''; if (el.id === 'posSearchInput') filterProducts(); }
                });
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
    // The grid already refuses the click; this also stops a scanned barcode
    // or a search suggestion from putting an unsellable product in the cart.
    const blocked = unavailableReason(product);
    if (blocked) {
        showToast(blocked === 'Expired' ? `${product.name} has expired and cannot be sold` : `${product.name} is sold out`, 'error');
        return;
    }
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
        showToast('Only ' + formatQty(maxStock) + ' in stock', 'error');
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
    const countEl = document.getElementById('cartCount');
    const n = cartItems.length;
    if (countEl) countEl.textContent = n + (n === 1 ? ' item' : ' items');
    if (n === 0) {
        container.innerHTML = '<div class="till-empty"><span class="material-symbols-outlined">shopping_basket</span><b>Nothing in this sale yet</b><span>Scan a barcode or press Add on a product.</span></div>';
        return;
    }
    container.innerHTML = cartItems.map((item, idx) => {
        const ul = getUnitLabelShort(item.unit_type);
        const name = escHtml(item.product_name);
        return `<div class="till-item pos-cart-item">
            <div class="ti-info"><b title="${name}">${name}</b><small>${formatCurrency(item.unit_price)} / ${ul}</small></div>
            <div class="ti-qty">
                <button type="button" onclick="updateCartQty(${idx}, -1)" title="Decrease" aria-label="One less ${name}">−</button>
                <input type="number" class="qty-val" value="${item.quantity}" min="0" step="${getQtyStep(item.unit_type)}" aria-label="Quantity of ${name}" onchange="setCartQty(${idx}, this.value)" onclick="this.select()">
                <button type="button" onclick="updateCartQty(${idx}, 1)" title="Increase" aria-label="One more ${name}">+</button>
            </div>
            <div class="ti-total">${formatCurrency(item.total_price)}</div>
            <button type="button" class="ti-remove" onclick="removeFromCart(${idx})" title="Remove" aria-label="Remove ${name}"><span class="material-symbols-outlined">close</span></button>
        </div>`;
    }).join('');
}

function animateCartChange() {
    if (!window.fetchMotion) return;
    const items = document.querySelectorAll('.pos-cart-item');
    fetchMotion.cartPulse(document.getElementById('cartCount'), items[items.length - 1]);
}

// The min/max on the discount input only constrain the spinner arrows —
// typing 150 straight in used to sail through and render a negative total
// with a "Charge ₱-1250.00" button. Clamp at the one place every caller reads,
// and correct the field so the cashier sees what will actually be applied.
function getDiscountPercent() {
    const el = document.getElementById('posDiscount');
    const raw = parseFloat(el?.value);
    if (!isFinite(raw)) return 0;
    const clamped = Math.min(posMaxDiscount, Math.max(0, raw));
    if (el && clamped !== raw) {
        el.value = clamped;
        if (raw > posMaxDiscount) showToast(`The largest discount allowed is ${posMaxDiscount}%`, 'warning');
    }
    return clamped;
}

function updateCartTotals() {
    const subtotal = cartItems.reduce((sum, i) => sum + i.total_price, 0);
    const discPct = getDiscountPercent();
    const discAmt = subtotal * (discPct / 100);
    const total = subtotal - discAmt;
    document.getElementById('posSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('posDiscountAmount').textContent = '-' + formatCurrency(discAmt);
    document.getElementById('posTotal').textContent = formatCurrency(total);
    const payTotal = document.getElementById('posPayTotal');
    if (payTotal) payTotal.textContent = formatCurrency(total);
    updateChange();
}

function getCartTotal() {
    const subtotal = cartItems.reduce((sum, i) => sum + i.total_price, 0);
    const discPct = getDiscountPercent();
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
    changeEl.textContent = (change < 0 ? '-' : '') + formatCurrency(Math.abs(change));
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
    const discount = getDiscountPercent();
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
        <div><strong>Subtotal:</strong> ${formatCurrency(subtotal)}</div>
        ${discount > 0 ? `<div><strong>Discount:</strong> ${discount}% (-${formatCurrency(discAmt)})</div>` : ''}
        <div style="font-size:16px;font-weight:800;margin-top:6px;padding-top:8px;border-top:2px solid var(--border-glass);"><strong>Total:</strong> ${formatCurrency(total)}</div>
        <div style="margin-top:6px;"><strong>Payment:</strong> CASH</div>
        <div><strong>Cash received:</strong> ${formatCurrency(tendered)}</div>
        <div><strong>Change:</strong> <span style="font-weight:800;color:var(--success);">${formatCurrency(change)}</span></div>
        <div><strong>Customer:</strong> ${escHtml(customer)}</div>
    </div>`;
    showConfirmDialog('Confirm cash sale', msg, async () => {
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
    }, 'Complete sale', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">payments</span>');
}

async function printReceipt(saleId, tendered, change) {
    try {
        const res = await fetch(`${API_BASE}/sales/${saleId}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) { showToast('Could not load receipt data', 'error'); return; }
        const sale = data.data;

        // Preferred path: send raw ESC/POS straight to the thermal printer over
        // WebUSB (like Loyverse). Only when the printer is already connected —
        // otherwise fall through to the browser print dialog below.
        if (window.escposPrint && escposPrint.isConnected()) {
            try {
                await escposPrint.printReceipt(sale, tendered, change);
                showToast('Receipt printed', 'success');
                return;
            } catch (e) {
                console.error('Direct print failed, using browser dialog:', e);
                showToast('Direct printer error — using print dialog', 'info');
            }
        }

        const itemsHTML = (sale.items || []).map(item => {
            const ul = getUnitLabel(item.unit_type);
            return `<tr><td style="padding:3px 4px;border-bottom:1px dashed #ccc;">${escHtml(item.product_name)}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:center;">${parseFloat(item.quantity)}${ul}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">${formatCurrency(parseFloat(item.unit_price))}</td><td style="padding:3px 4px;border-bottom:1px dashed #ccc;text-align:right;">${formatCurrency(parseFloat(item.subtotal || item.quantity * item.unit_price))}</td></tr>`;
        }).join('');
        const total = parseFloat(sale.total_amount || 0).toFixed(2);
        const disc = parseFloat(sale.discount_percent || 0).toFixed(2);
        const subtotal = parseFloat(sale.total_amount || 0).toFixed(2);
        const date = new Date(sale.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const receiptHTML = `
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
                    <div>Payment: ${escHtml((sale.payment_method || 'cash').toUpperCase())}</div>
                </div>
                <hr>
                <table>
                    <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>
                    <tbody>${itemsHTML}</tbody>
                </table>
                <hr>
                <div class="total-row"><span>Subtotal:</span><span>₱${subtotal}</span></div>
                ${disc > 0 ? `<div class="total-row"><span>Discount (${disc}%):</span><span>-${formatCurrency((parseFloat(subtotal) * disc / 100))}</span></div>` : ''}
                <div class="grand-total">TOTAL: ₱${total}</div>
                <div class="footer">
                    <div>Payment: ${escHtml((sale.payment_method || 'cash').toUpperCase())}</div>
                    ${typeof tendered === 'number' && tendered > 0 ? `<div>Cash: ${formatCurrency(tendered)}</div><div>Change: ${formatCurrency((change || 0))}</div>` : ''}
                    <div style="margin-top:8px;">Thank you for your purchase!</div>
                    <div style="margin-top:4px;">Items are non-returnable</div>
                    <div class="barcode">${String(sale.sale_number || sale.id).padStart(6, '0')}</div>
                    <div style="font-size:8px;color:#aaa;margin-top:4px;">This serves as your official receipt</div>
                </div>
            </body></html>
        `;
        // Print via a hidden iframe instead of opening a separate receipt
        // window/tab: the print dialog fires over the POS page and the frame is
        // removed afterward, so nothing navigates away.
        const old = document.getElementById('receiptPrintFrame');
        if (old) old.remove();
        const frame = document.createElement('iframe');
        frame.id = 'receiptPrintFrame';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;visibility:hidden;';
        document.body.appendChild(frame);
        const fdoc = frame.contentWindow.document;
        fdoc.open();
        fdoc.write(receiptHTML);
        fdoc.close();
        // Receipt has only inline content, so a short delay is enough to lay it
        // out before printing. Guard so we print exactly once.
        let printed = false;
        const doPrint = () => {
            if (printed) return;
            printed = true;
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch (e) { console.error('Print failed:', e); }
            setTimeout(() => frame.remove(), 1000);
        };
        frame.contentWindow.onload = doPrint;
        setTimeout(doPrint, 350); // fallback if onload doesn't fire for a written doc
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
        suggest.innerHTML = matches.map(p => {
            const blocked = unavailableReason(p);
            return `<div class="pos-suggest-item${blocked ? ' unavailable' : ''}" ${blocked ? 'aria-disabled="true"' : `data-suggest="${Number(p.id)}"`}>
                <span class="pos-suggest-name">${escHtml(p.name)}</span>
                <span class="pos-suggest-price">${blocked ? blocked : formatCurrency(parseFloat(p.unit_price || 0))}</span>
            </div>`;
        }
        ).join('');
        suggest.style.display = 'block';
    });
    suggest.addEventListener('click', e => {
        const row = e.target.closest('[data-suggest]');
        if (!row) return;
        addToCart(Number(row.dataset.suggest));
        suggest.style.display = 'none';
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.till-search')) suggest.style.display = 'none';
    });
}


/* ---------- The till: starting cash, my sales, end-of-day count ----------
   All of it is the signed-in cashier's own drawer for today. The server
   decides whose and which day; nothing here sends either. */
let posTill = null;                 // { opening_set, opening_cash, counted, max_discount_percent }
let posMaxDiscount = 100;           // replaced by the shop's limit once the till loads

async function loadTill() {
    try {
        const res = await fetch(`${API_BASE}/sales/till`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) return;
        posTill = data.data;
        posMaxDiscount = Number(posTill.max_discount_percent);
        const input = document.getElementById('posDiscount');
        if (input) input.max = posMaxDiscount;
        const hint = document.getElementById('posDiscountLimit');
        if (hint) hint.textContent = posMaxDiscount < 100 ? `up to ${posMaxDiscount}%` : '';
        // First thing each day: what is in the drawer before any sale.
        if (!posTill.opening_set && !posTill.counted) openPosOpen(false);
    } catch (e) {
        console.error('Till load failed:', e);
    }
}

function openPosOpen(canCancel) {
    document.getElementById('posOpenCancel').hidden = !canCancel;
    const input = document.getElementById('posOpenAmount');
    input.value = posTill && posTill.opening_set ? posTill.opening_cash : '';
    document.getElementById('posOpenModal').classList.add('active');
    setTimeout(() => input.focus(), 50);
}

function closePosOpen() {
    document.getElementById('posOpenModal').classList.remove('active');
}

function changePosOpen() {
    closePosEod();
    openPosOpen(true);
}

async function savePosOpen() {
    const amount = parseFloat(document.getElementById('posOpenAmount').value);
    if (isNaN(amount) || amount < 0) { showToast('Enter the cash in the drawer, or 0 if it is empty', 'warning'); return; }
    const btn = document.getElementById('posOpenSave');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/sales/till/open`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ opening_cash: amount })
        });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'The starting cash could not be saved', 'error'); return; }
        if (posTill) { posTill.opening_set = true; posTill.opening_cash = data.data.opening_cash; }
        closePosOpen();
        showToast('Starting cash saved: ' + formatCurrency(data.data.opening_cash), 'success');
    } catch (e) {
        console.error('Starting cash save failed:', e);
        showToast('The starting cash could not be saved', 'error');
    } finally {
        btn.disabled = false;
    }
}

/* ---- My sales today ---- */

async function openMySales() {
    document.getElementById('posMySalesModal').classList.add('active');
    await loadMySales();
}

function closeMySales() {
    document.getElementById('posMySalesModal').classList.remove('active');
}

async function loadMySales() {
    const body = document.getElementById('posMySalesBody');
    const message = text => { body.innerHTML = `<tr><td colspan="6" class="pos-mysales-empty">${escHtml(text)}</td></tr>`; };
    try {
        const res = await fetch(`${API_BASE}/sales/mine`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) { message('Your sales could not be loaded.'); return; }
        if (!data.data.length) { message('You have not made a sale yet today.'); return; }
        body.innerHTML = data.data.map(s => {
            const id = Number(s.id);
            const voided = s.payment_status === 'voided';
            const status = voided ? '<span class="status-badge status-expired">Voided</span>'
                : s.void_requested ? '<span class="status-badge status-low-stock">Void requested</span>'
                : '<span class="status-badge status-in-stock">Completed</span>';
            const actions = `<button class="btn-view" data-reprint="${id}">Reprint</button>`
                + (voided || s.void_requested ? '' : `<button class="btn-delete" data-void="${id}">Ask for void</button>`);
            return `<tr class="${voided ? 'pos-mysales-voided' : ''}">
                <td>${new Date(Number(s.created_at)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td>
                <td>#${id}<span style="color:var(--text-muted);"> · ${formatQty(s.item_count)} item${Number(s.item_count) === 1 ? '' : 's'}</span></td>
                <td>${escHtml(s.customer_name || 'Walk-in')}</td>
                <td class="num">${formatCurrency(s.final_amount)}</td>
                <td>${status}</td>
                <td>${actions}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('My sales load failed:', e);
        message('Your sales could not be loaded.');
    }
}

document.addEventListener('click', e => {
    const reprint = e.target.closest('[data-reprint]');
    if (reprint) { printReceipt(Number(reprint.dataset.reprint)); return; }
    const ask = e.target.closest('[data-void]');
    if (ask) requestVoid(Number(ask.dataset.void));
});

function requestVoid(id) {
    showPromptDialog(
        'Ask for sale #' + id + ' to be voided',
        'A manager will review it. Until then the sale stays as it is. What went wrong?',
        async reason => {
            reason = (reason || '').trim();
            if (reason.length < 3) { showToast('Say briefly what went wrong', 'warning'); return; }
            try {
                const res = await fetch(`${API_BASE}/sales/${id}/void-request`, {
                    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ reason })
                });
                const data = await res.json();
                if (!data.success) { showToast(data.message || 'The request could not be sent', 'error'); return; }
                showToast('Sent to a manager', 'success');
                loadMySales();
            } catch (e) {
                console.error('Void request failed:', e);
                showToast('The request could not be sent', 'error');
            }
        },
        'Send request', null, 'text', ''
    );
}

/* ---- End-of-day count ----
   Blind: the expected amount is not shown, or even sent, until the cashier
   has entered what they counted. Once saved it is final for the day. */

async function openPosEod() {
    const modal = document.getElementById('posEodModal');
    if (!modal) return;
    modal.classList.add('active');
    document.getElementById('posEodDate').textContent = 'For today, ' +
        new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '.';
    document.getElementById('posEodStatus').textContent = '';
    document.getElementById('posEodCounted').value = '';
    document.getElementById('posEodNotes').value = '';
    try {
        const res = await fetch(`${API_BASE}/sales/eod`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Could not load');
        const d = data.data;
        document.getElementById('posEodOpening').textContent = d.opening_set ? formatCurrency(d.opening_cash) : 'Not entered';
        document.getElementById('posEodTxns').textContent = `${d.transactions} sale${Number(d.transactions) === 1 ? '' : 's'}`;
        // cash put in or taken out is what the cashier recorded, so it is shown; the expected total still is not
        const moved = Number(d.cash_in) > 0 || Number(d.cash_out) > 0;
        document.getElementById('posEodMoves').hidden = !moved;
        document.getElementById('posEodCashIn').textContent = formatCurrency(d.cash_in || 0);
        document.getElementById('posEodCashOut').textContent = formatCurrency(d.cash_out || 0);
        showPosEodResult(d.counted ? { ...d.result, opening_cash: d.opening_cash } : null);
        if (!d.counted) document.getElementById('posEodCounted').focus();
    } catch (e) {
        console.error('End-of-day load failed:', e);
        document.getElementById('posEodStatus').textContent = 'The count could not be loaded. Try again.';
    }
}

function showPosEodResult(result) {
    const done = !!result;
    document.getElementById('posEodEntry').hidden = done;
    document.getElementById('posEodResult').hidden = !done;
    document.getElementById('posEodSave').hidden = done;
    document.getElementById('posEodChangeOpening').hidden = done;
    if (!done) return;
    const diff = Number(result.discrepancy);
    const el = document.getElementById('posEodDiff');
    el.textContent = diff === 0 ? 'Balanced' : diff > 0 ? 'Over by ' + formatCurrency(diff) : 'Short by ' + formatCurrency(Math.abs(diff));
    el.style.color = diff === 0 ? 'var(--success)' : diff > 0 ? 'var(--warning)' : 'var(--danger)';
    document.getElementById('posEodExpected').textContent = formatCurrency(result.expected_cash);
    document.getElementById('posEodCountedOut').textContent = formatCurrency(result.counted_cash);
    document.getElementById('posEodNotesOut').textContent = result.notes ? 'Notes: ' + result.notes : '';
    // How the expected figure was reached, now that the count is in.
    const how = document.getElementById('posEodHow');
    if (how) {
        const opening = Number(result.opening_cash) || 0, cashIn = Number(result.cash_in) || 0, cashOut = Number(result.cash_out) || 0;
        const sales = Math.round((Number(result.expected_cash) - opening - cashIn + cashOut) * 100) / 100;
        how.textContent = 'Expected = starting cash ' + formatCurrency(opening) + ' + cash sales ' + formatCurrency(sales)
            + (cashIn ? ' + put in ' + formatCurrency(cashIn) : '')
            + (cashOut ? ' − taken out ' + formatCurrency(cashOut) : '') + '.';
    }
}

/* ---- Cash in or out of the drawer ----
   Anything that changes the cash in the drawer other than a sale. Each entry
   adjusts what the drawer should hold, so the count at the end of the day
   still balances, and each one is reported to the administrator. */
let posCashKind = 'out';

function setPosCashKind(kind) {
    posCashKind = kind === 'in' ? 'in' : 'out';
    document.querySelectorAll('#posCashKind .seg-btn').forEach(b => {
        const on = b.dataset.kind === posCashKind;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const out = posCashKind === 'out';
    document.getElementById('posCashReasonLabel').textContent = out ? 'Who took it, and what for' : 'Who put it in, and why';
    document.getElementById('posCashReason').placeholder = out ? 'For example: Owner collected the afternoon sales' : 'For example: Owner added coins for change';
    document.getElementById('posCashSave').textContent = out ? 'Record cash taken out' : 'Record cash put in';
}

function renderPosCash(d) {
    const list = document.getElementById('posCashList');
    const moves = d.moves || [];
    document.getElementById('posCashTotals').textContent = moves.length
        ? 'Put in ' + formatCurrency(d.cash_in || 0) + ' · Taken out ' + formatCurrency(d.cash_out || 0)
        : '';
    list.innerHTML = moves.length ? moves.map(m => {
        const time = new Date(Number(m.created_at)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const out = m.kind === 'out';
        return `<div class="pos-cash-row ${out ? 'out' : 'in'}">
            <span class="material-symbols-outlined">${out ? 'north_east' : 'south_west'}</span>
            <div><b>${escHtml(m.reason)}</b><small>${time} · ${out ? 'Taken out' : 'Put in'}</small></div>
            <strong>${out ? '−' : '+'}${formatCurrency(m.amount)}</strong>
        </div>`;
    }).join('') : '<div class="pos-cash-none">No cash has been put in or taken out today.</div>';
    // once today is counted the record is closed
    const closed = !!d.counted;
    document.getElementById('posCashEntry').hidden = closed;
    document.getElementById('posCashSave').hidden = closed;
    const status = document.getElementById('posCashStatus');
    status.hidden = !closed;
    status.textContent = closed ? "Today's cash count is already recorded, so nothing more can be added for today." : '';
}

async function openPosCash() {
    const modal = document.getElementById('posCashModal');
    if (!modal) return;
    modal.classList.add('active');
    setPosCashKind('out');
    document.getElementById('posCashAmount').value = '';
    document.getElementById('posCashReason').value = '';
    try {
        const res = await fetch(`${API_BASE}/sales/till/cash`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Could not load');
        renderPosCash(data.data);
        if (!data.data.counted) document.getElementById('posCashAmount').focus();
    } catch (e) {
        console.error('Cash in/out load failed:', e);
        document.getElementById('posCashList').innerHTML = '<div class="pos-cash-none">Could not be loaded. Close this and try again.</div>';
    }
}

function closePosCash() {
    document.getElementById('posCashModal')?.classList.remove('active');
}

function savePosCash() {
    const amount = parseFloat(document.getElementById('posCashAmount').value);
    const reason = document.getElementById('posCashReason').value.trim();
    const out = posCashKind === 'out';
    if (isNaN(amount) || amount <= 0) { showToast('Enter the amount', 'warning'); document.getElementById('posCashAmount').focus(); return; }
    if (reason.length < 3) { showToast(out ? 'Say who took the cash and what for' : 'Say who put the cash in and why', 'warning'); document.getElementById('posCashReason').focus(); return; }
    showConfirmDialog(out ? 'Record cash taken out?' : 'Record cash put in?',
        formatCurrency(amount) + (out ? ' taken out of the drawer. ' : ' put into the drawer. ') + 'This cannot be removed afterwards, and the administrator is told.',
        async () => {
            const btn = document.getElementById('posCashSave');
            btn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/sales/till/cash`, {
                    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ kind: posCashKind, amount, reason })
                });
                const data = await res.json();
                if (!data.success) { showToast(data.message || 'That could not be recorded', 'error'); return; }
                showToast(data.message || 'Recorded', 'success');
                document.getElementById('posCashAmount').value = '';
                document.getElementById('posCashReason').value = '';
                renderPosCash({ ...data.data, counted: false });
            } catch (e) {
                console.error('Cash in/out save failed:', e);
                showToast('That could not be recorded', 'error');
            } finally {
                btn.disabled = false;
            }
        }, out ? 'Record it' : 'Record it');
}

function closePosEod() {
    document.getElementById('posEodModal')?.classList.remove('active');
}

function savePosEod() {
    const counted = parseFloat(document.getElementById('posEodCounted').value);
    if (isNaN(counted) || counted < 0) { showToast('Enter the cash counted in the drawer', 'warning'); return; }
    showConfirmDialog('Save the count?',
        'You counted ' + formatCurrency(counted) + '. This closes your drawer for today and cannot be changed afterwards.',
        async () => {
            const btn = document.getElementById('posEodSave');
            btn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/sales/eod`, {
                    method: 'POST', headers: getAuthHeaders(),
                    body: JSON.stringify({ counted_cash: counted, notes: document.getElementById('posEodNotes').value })
                });
                const data = await res.json();
                if (!data.success) { showToast(data.message || 'The count could not be saved', 'error'); return; }
                if (posTill) posTill.counted = true;
                showPosEodResult({ ...data.data, notes: document.getElementById('posEodNotes').value });
            } catch (e) {
                console.error('End-of-day save failed:', e);
                showToast('The count could not be saved', 'error');
            } finally {
                btn.disabled = false;
            }
        }, 'Save count');
}
