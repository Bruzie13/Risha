const API_URL = '/api';
const PAGE_SIZE = 10;
const LOW_STOCK_PAGE_SIZE = 5;
let displayCount = PAGE_SIZE;
let allProducts = [];      // only the pages loaded so far for the current query
let serverTotal = 0;       // total rows matching the current query (from the server)
let productStats = null;   // aggregate numbers for stat cards / chips
let catalogSize = null;    // last known catalog size from the stock poll
let searchDebounce = null;
let editingProductId = null;
let lowStockOnly = false;
let reorderTab = false;
let statusFilter = '';
let sortKey = '';
let sortDir = 1;

// Load page on startup
window.addEventListener('load', async () => {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }
    if (!canManage()) {
        document.getElementById('bulkBar').style.display = 'none';
        document.querySelector('#productDetailsModal .btn-primary')?.remove();
        document.querySelector('#productDetailsModal .btn-danger')?.remove();
        const selectAllTh = document.querySelector('.data-table thead th:first-child');
        if (selectAllTh) selectAllTh.style.display = 'none';
        const actionsTh = document.querySelector('.data-table thead th:last-child');
        if (actionsTh) actionsTh.textContent = '';
    }
    // restore saved view (grid default) before products render
    document.querySelectorAll('.inv-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === invView));
    document.getElementById('productsGrid').style.display = invView === 'grid' ? 'grid' : 'none';
    document.getElementById('productsTableWrap').style.display = invView === 'list' ? 'block' : 'none';
    await loadCategories();
    await loadSuppliers();
    await loadProducts();
    // deep links from the dashboard (e.g. inventory.html?filter=reorder)
    const wanted = new URLSearchParams(window.location.search).get('filter');
    if (wanted) {
        const chip = document.querySelector(`#statusChips .chip[data-status="${wanted}"]`);
        if (chip) chip.click(); else setStatusFilter(wanted);
    }
    // Live stock: sales on the POS show here without a refresh
    setInterval(refreshStockLevels, 10000);
});

// Load categories for the dropdown and filter
async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/products/categories`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (data.success) {
            const categorySelect = document.getElementById('category_id');
            const filterSelect = document.getElementById('categoryFilter');
            const names = document.getElementById('csvCategoryNames');
            if (names) names.textContent = data.data.map(c => c.name).join(', ');
            data.data.forEach(category => {
                const opt1 = document.createElement('option');
                opt1.value = category.id;
                opt1.textContent = category.name;
                categorySelect.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = category.id;
                opt2.textContent = category.name;
                filterSelect.appendChild(opt2);
            });
        }
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Load suppliers for the dropdown
async function loadSuppliers() {
    try {
        const response = await fetch(`${API_URL}/suppliers`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            // the product form and the import dialog offer the same suppliers
            const list = Array.isArray(data.data) ? data.data : [];
            ['supplier_id', 'csvSupplier'].forEach(id => {
                const sel = document.getElementById(id);
                if (!sel) return;
                list.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.name;
                    sel.appendChild(opt);
                });
            });
            // with nobody to choose, say what to do instead of leaving an empty list
            const none = document.getElementById('supplierNone');
            if (none) none.hidden = list.length > 0;
        }
    } catch (error) {
        console.error('Error loading suppliers:', error);
    }
}

// The server does the filtering, sorting and paging: we only ever hold the
// pages fetched so far, and "Show more" asks the backend for the next page.
function invPageSize() {
    return reorderTab ? LOW_STOCK_PAGE_SIZE : PAGE_SIZE;
}

function currentProductQuery() {
    const params = new URLSearchParams();
    const search = document.getElementById('searchInput')?.value?.trim() || '';
    const category = document.getElementById('categoryFilter')?.value || '';
    const species = document.getElementById('speciesFilter')?.value || '';
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (species) params.set('species', species);
    if (statusFilter) params.set('status', statusFilter);
    else if (reorderTab) params.set('status', 'reorder');
    if (sortKey) {
        params.set('sort', sortKey);
        if (sortDir === -1) params.set('dir', 'desc');
    }
    return params;
}

// reset=true refetches page 1 for the current filters; reset=false appends
// the next page (Show more).
async function loadProducts(reset = true) {
    try {
        const params = currentProductQuery();
        if (reset) displayCount = invPageSize();
        params.set('limit', Math.max(displayCount - (reset ? 0 : allProducts.length), invPageSize()));
        params.set('offset', reset ? 0 : allProducts.length);
        const response = await fetch(`${API_URL}/products?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allProducts = reset ? data.data : allProducts.concat(data.data);
            serverTotal = data.total ?? allProducts.length;
            displayProducts(allProducts);
            updateStats();
        }
    } catch (error) {
        console.error('Error loading products:', error);
        showToast(couldNot('load products', error), 'error');
    }
}

// Poll the tiny id→stock endpoint; refetch the visible page(s) on real change
// so server-side filters/sort stay correct.
async function refreshStockLevels() {
    if (document.hidden || !allProducts.length) return;
    try {
        const response = await fetch(`${API_URL}/products/stock-levels`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (!data.success || !Array.isArray(data.data)) return;
        const levels = new Map(data.data.map(r => [r.id, parseFloat(r.stock_quantity)]));
        const changed = allProducts.some(p => levels.has(p.id) && parseFloat(p.stock_quantity) !== levels.get(p.id));
        const removed = allProducts.some(p => !levels.has(p.id));
        const grewOrShrank = catalogSize !== null && data.data.length !== catalogSize;
        catalogSize = data.data.length;
        if (changed || removed || grewOrShrank) await reloadCurrentPages();
    } catch (e) {
        // Network hiccup — next poll retries.
    }
}

// Refetch everything currently on screen (same query, one request).
async function reloadCurrentPages() {
    const params = currentProductQuery();
    params.set('limit', Math.max(allProducts.length, invPageSize()));
    params.set('offset', 0);
    try {
        const response = await fetch(`${API_URL}/products?${params}`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allProducts = data.data;
            serverTotal = data.total ?? allProducts.length;
            displayProducts(allProducts);
            updateStats();
        }
    } catch (e) { /* next poll retries */ }
}

// Whole-catalog admin tools (barcode/image managers) fetch a light list —
// every product, but without the heavy base64 images.
async function loadToolCatalog(withImages) {
    const res = await fetch(`${API_URL}/products${withImages ? '' : '?fields=light'}`, { headers: getAuthHeaders() });
    const data = await res.json();
    toolCatalog = (data.success && Array.isArray(data.data)) ? data.data : [];
    return toolCatalog;
}
let toolCatalog = [];
let toolCatalogHasImages = false;

/* ── Status helpers ── */
// Priority: expired > expiring > out > low > in (matches badge logic)
function productStatus(p) {
    const days = daysUntilExpiry(p);
    if (days !== null) {
        if (days < 0) return 'expired';
        if (days <= 30) return 'expiring';
    }
    const stock = Number(p.stock_quantity) || 0;
    if (stock === 0) return 'out';
    if (stock <= (p.reorder_level ?? 10)) return 'low';
    return 'in';
}

function daysUntilExpiry(p) {
    if (!p.expiration_date) return null;
    const raw = String(p.expiration_date);
    // Date-only strings parse as local midnight; ISO datetimes (UTC from the DB)
    // must be converted to local time BEFORE stripping the time, or PH dates
    // stored as previous-day 16:00Z land on the wrong calendar day.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T00:00:00') : new Date(raw);
    if (isNaN(d.getTime())) return null;
    const expiry = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((expiry - today) / 86400000);
}

const AVATAR_ICONS = {
    food: 'pet_supplies', treat: 'pet_supplies', toy: 'toys', medicine: 'medication',
    health: 'medication', grooming: 'soap', accessor: 'checkroom', litter: 'delete_sweep'
};

function productIcon(p) {
    const cat = (p.category_name || p.category || '').toLowerCase();
    for (const key in AVATAR_ICONS) {
        if (cat.includes(key)) return AVATAR_ICONS[key];
    }
    return 'inventory_2';
}

// Card grid is the distinctive default view; the table stays for dense scanning
let invView = localStorage.getItem('invView') || 'grid';

function setInvView(mode) {
    invView = mode;
    localStorage.setItem('invView', mode);
    document.querySelectorAll('.inv-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
    document.getElementById('productsGrid').style.display = mode === 'grid' ? 'grid' : 'none';
    document.getElementById('productsTableWrap').style.display = mode === 'list' ? 'block' : 'none';
    displayProducts(getFilteredProducts());
}

// status → color theme for a product card
function cardTheme(status) {
    switch (status) {
        case 'expired': return { color: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Expired' };
        case 'out': return { color: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Out of stock' };
        case 'expiring': return { color: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Expiring' };
        case 'low': return { color: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Low stock' };
        default: return { color: 'var(--success)', bg: 'var(--success-bg)', label: 'Healthy' };
    }
}

function displayProductsGrid(products) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    const viewer = !canManage();

    if (products.length === 0) {
        const hasFilters = !!(document.getElementById('searchInput')?.value ||
            document.getElementById('categoryFilter')?.value ||
            document.getElementById('speciesFilter')?.value || statusFilter || reorderTab);
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:56px 22px;text-align:center;">
            <span class="material-symbols-outlined" style="font-size:46px;color:var(--border-strong,#ccc);display:block;margin-bottom:10px;">${hasFilters ? 'search_off' : 'inventory_2'}</span>
            <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${hasFilters ? 'No products match your filters' : 'No products yet'}</div>
            <div style="color:var(--text-muted);">${hasFilters ? 'Try adjusting your search or filters.' : (viewer ? 'Products will appear here once added.' : 'Add your first product to get started.')}</div>
            ${hasFilters ? '<button class="btn-secondary" onclick="showAllProducts()" style="margin-top:14px;padding:8px 18px;font-size:13px;">Clear filters</button>' : (viewer ? '' : '<button class="btn-primary" onclick="openAddProductModal()" style="margin-top:14px;padding:8px 18px;font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">add</span> Add product</button>')}
        </div>`;
        updatePagination('inventoryPagination', { length: serverTotal }, displayCount, 'showMoreProducts', 'showLessProducts', invPageSize());
        return;
    }

    const C = 163.36; // circumference of the r=26 gauge ring
    grid.innerHTML = products.slice(0, displayCount).map((p, i) => {
        const status = productStatus(p);
        const t = cardTheme(status);
        const stock = Number(p.stock_quantity) || 0;
        const reorder = p.reorder_level ?? 10;
        const pct = Math.min(100, Math.round((stock / Math.max(reorder * 2, 1)) * 100));
        const offset = C * (1 - pct / 100);
        const days = daysUntilExpiry(p);

        let expiry = '';
        if (p.expiration_date && days !== null) {
            const d = new Date(p.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const cls = days < 0 ? 'expired' : days <= 30 ? 'soon' : '';
            const label = days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`;
            expiry = `<div class="pcard-expiry ${cls}"><span class="material-symbols-outlined">${days < 0 ? 'error' : 'schedule'}</span> ${d} · ${label}</div>`;
        } else {
            expiry = `<div class="pcard-expiry"><span class="material-symbols-outlined">event_available</span> No expiration set</div>`;
        }

        return `
        <div class="pcard" style="--pc-color:${t.color};--pc-accent:${t.bg};--pc-line:${t.color};animation-delay:${Math.min(i * 35, 350)}ms;">
            ${viewer ? '' : `<input type="checkbox" class="product-checkbox pcard-check" value="${p.id}">`}
            <span class="pcard-status">${t.label}</span>
            <div class="pcard-top">
                <div class="pcard-avatar">${p.image_url ? `<img class="pcard-img" src="${escHtml(p.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="material-symbols-outlined">${productIcon(p)}</span></div>
                <div class="pcard-id">
                    <div class="pcard-name" title="${escHtml(p.name)}">${escHtml(p.name)}</div>
                    <div class="pcard-sub">${escHtml(p.sku)}${p.brand ? ' · ' + escHtml(p.brand) : ''}</div>
                </div>
            </div>
            <div class="pcard-mid">
                <div class="stock-gauge" title="${stock} in stock (reorder at ${reorder})">
                    <svg width="64" height="64" viewBox="0 0 64 64">
                        <circle class="sg-track" cx="32" cy="32" r="26" fill="none" stroke-width="6"/>
                        <circle class="sg-fill" cx="32" cy="32" r="26" fill="none" stroke-width="6" stroke-dasharray="${C}" stroke-dashoffset="${offset}"/>
                    </svg>
                    <div class="sg-num">${formatNumber(stock)}<span class="sg-unit">${getUnitLabel(p.unit_type).trim() || 'in stk'}</span></div>
                </div>
                <div class="pcard-figs">
                    <div class="pcard-price">${formatCurrency(p.unit_price)} <small>/ unit</small></div>
                    <div class="pcard-cat"><span class="dot"></span> ${escHtml(p.category_name || 'Uncategorized')}${p.species ? ' · ' + escHtml(p.species) : ''}</div>
                </div>
            </div>
            ${expiry}
            <div class="pcard-actions">
                <button onclick="viewProductDetails(${p.id})"><span class="material-symbols-outlined">visibility</span> <span class="pca-label">View</span></button>
                ${viewer ? '' : `<button onclick="openEditProductModal(${p.id})"><span class="material-symbols-outlined">edit</span> <span class="pca-label">Edit</span></button>
                <button onclick="openStockModal(${p.id})"><span class="material-symbols-outlined">inventory</span> <span class="pca-label">Stock</span></button>
                <button class="pca-danger" onclick="deleteProduct(${p.id})" title="Delete"><span class="material-symbols-outlined">delete</span></button>`}
            </div>
        </div>`;
    }).join('');

    updatePagination('inventoryPagination', { length: serverTotal }, displayCount, 'showMoreProducts', 'showLessProducts', invPageSize());
}

function displayProducts(products) {
    if (invView === 'grid') { displayProductsGrid(products); return; }
    const tbody = document.getElementById('productsTableBody');
    const viewer = !canManage();
    const colSpan = viewer ? 7 : 8;

    if (products.length === 0) {
        const hasFilters = !!(document.getElementById('searchInput')?.value ||
            document.getElementById('categoryFilter')?.value ||
            document.getElementById('speciesFilter')?.value || statusFilter || reorderTab);
        const icon = hasFilters ? 'search_off' : 'inventory_2';
        const title = hasFilters ? 'No products match your filters' : 'No products yet';
        const hint = hasFilters
            ? 'Try adjusting your search or filters.'
            : (viewer ? 'Products will appear here once added.' : 'Add your first product or import from CSV to get started.');
        const action = hasFilters
            ? '<button class="btn-secondary" onclick="showAllProducts()" style="margin-top:14px;padding:8px 18px;font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">filter_alt_off</span> Clear filters</button>'
            : (viewer ? '' : '<button class="btn-primary" onclick="openAddProductModal()" style="margin-top:14px;padding:8px 18px;font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">add</span> Add product</button>');
        tbody.innerHTML = `<tr><td colspan="${colSpan}">
            <div class="empty-state" style="padding:48px 22px;">
                <span class="material-symbols-outlined" style="font-size:44px;color:var(--border-strong,#ccc);display:block;margin-bottom:10px;">${icon}</span>
                <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${title}</div>
                <div>${hint}</div>
                ${action}
            </div>
        </td></tr>`;
        updatePagination('inventoryPagination', { length: serverTotal }, displayCount, 'showMoreProducts', 'showLessProducts', invPageSize());
    if (window.fetchMotion && !fetchMotion.reduced) { tbody.classList.remove('rows-in'); void tbody.offsetWidth; tbody.classList.add('rows-in'); }
        return;
    }

    const shown = products.slice(0, displayCount);
    tbody.innerHTML = shown.map((product, i) => {
        const status = productStatus(product);
        const days = daysUntilExpiry(product);

        // Expiration cell: date + human-readable countdown
        let expiryCell = '<span class="text-muted">—</span>';
        if (product.expiration_date && days !== null) {
            const formatted = new Date(product.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const cls = days < 0 ? 'expired' : days <= 30 ? 'soon' : '';
            const sub = days < 0
                ? `Expired ${Math.abs(days)}d ago`
                : days === 0 ? 'Expires today'
                : days <= 60 ? `In ${days} day${days === 1 ? '' : 's'}`
                : '';
            expiryCell = `<div class="cell-expiry ${cls}">
                <div class="ce-date">${formatted}</div>
                ${sub ? `<div class="ce-sub">${sub}</div>` : ''}
            </div>`;
        }

        // Stock cell: number + mini meter vs. reorder level
        const stockNum = Number(product.stock_quantity) || 0;
        const reorder = product.reorder_level ?? 10;
        const pct = Math.min(100, Math.round((stockNum / Math.max(reorder * 2, 1)) * 100));
        const fillClass = stockNum === 0 ? 'out' : stockNum <= reorder ? 'warn' : '';
        const stockColor = stockNum === 0 ? 'var(--danger)' : stockNum <= reorder ? 'var(--warning)' : 'var(--text-primary)';
        const stockCell = `<div class="cell-stock">
            <div class="cs-num" style="color:${stockColor}">${formatNumber(product.stock_quantity)}${getUnitLabel(product.unit_type)}</div>
            <div class="cs-track"><div class="cs-fill ${fillClass}" style="width:${Math.max(stockNum > 0 ? 6 : 0, pct)}%"></div></div>
        </div>`;

        const tint = (product.id % 5) + 1;

        return `
            <tr>
                ${viewer ? '' : `<td><input type="checkbox" class="product-checkbox" value="${product.id}"></td>`}
                <td>
                    <div class="cell-product">
                        <div class="cp-avatar tint-${tint}"><span class="material-symbols-outlined" style="font-size:17px;">${productIcon(product)}</span></div>
                        <div class="cp-info">
                            <div class="cp-name" title="${escHtml(product.name)}">${escHtml(product.name)}</div>
                            <div class="cp-sub">${escHtml(product.sku)}${product.brand ? ' · ' + escHtml(product.brand) : ''}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div style="font-size:12.5px;font-weight:500;color:var(--text-secondary);">${escHtml(product.category_name || 'N/A')}</div>
                    ${product.species ? `<div style="font-size:12px;color:var(--text-muted);margin-top:1px;">${escHtml(product.species)}</div>` : ''}
                </td>
                <td style="font-weight:600;color:var(--text-primary);font-variant-numeric:tabular-nums;">${formatCurrency(product.unit_price)}</td>
                <td>${stockCell}</td>
                <td>${expiryCell}</td>
                <td>${getStatusBadge(product.stock_quantity, product.reorder_level, product.expiration_date)}</td>
                <td>
                    <div class="actions-cell">
                        <button class="btn-view" onclick="viewProductDetails(${product.id})">View</button>
                        ${viewer ? '' : `<button class="btn-edit" onclick="openEditProductModal(${product.id})">Edit</button>
                        <button class="btn-action" onclick="openStockModal(${product.id})">Stock</button>
                        <button class="btn-delete" onclick="deleteProduct(${product.id})">Delete</button>`}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    updatePagination('inventoryPagination', { length: serverTotal }, displayCount, 'showMoreProducts', 'showLessProducts', invPageSize());
}

async function showMoreProducts() {
    displayCount += invPageSize();
    if (allProducts.length < Math.min(displayCount, serverTotal)) {
        await loadProducts(false); // fetch the next page from the backend
    } else {
        displayProducts(allProducts);
    }
}

function showLessProducts() {
    // one page back, mirroring Show more (it used to jump to the first page)
    displayCount = Math.max(0, displayCount - 2 * invPageSize());
    showMoreProducts();
}


function getUnitLabel(unitType) {
    const labels = { piece: '', kg: ' kg', g: ' g', liter: ' L', ml: ' mL' };
    return labels[unitType] || '';
}

// Get status badge with expiration check
function getStatusBadge(stock, reorder, expirationDate) {
    if (expirationDate) {
        const daysLeft = daysUntilExpiry({ expiration_date: expirationDate });
        if (daysLeft !== null && daysLeft < 0) {
            return '<span class="status-badge status-expired">Expired</span>';
        } else if (daysLeft !== null && daysLeft <= 30) {
            return '<span class="status-badge status-expiring-soon">Expiring soon</span>';
        }
    }

    if (stock === 0) {
        return '<span class="status-badge status-out-of-stock">Out of stock</span>';
    } else if (stock <= reorder) {
        return '<span class="status-badge status-low-stock">Low stock</span>';
    } else {
        return '<span class="status-badge status-in-stock">In stock</span>';
    }
}

/* ── Filtering + sorting ── */
// Search/category/species/status/sort all run on the server (currentProductQuery);
// what we hold locally is already the filtered, sorted result.
function getFilteredProducts() {
    return allProducts;
}

function sortBy(key) {
    if (sortKey === key) {
        sortDir = -sortDir;
    } else {
        sortKey = key;
        sortDir = 1;
    }
    const select = document.getElementById('sortSelect');
    if (select) {
        const mapped = key === 'status' ? 'status' : `${key}-${sortDir === 1 ? 'asc' : 'desc'}`;
        select.value = [...select.options].some(o => o.value === mapped) ? mapped : '';
    }
    updateSortArrows();
    loadProducts();
}

function applySortSelect(value) {
    if (!value) {
        sortKey = '';
        sortDir = 1;
    } else if (value === 'status') {
        sortKey = 'status';
        sortDir = 1;
    } else {
        const [key, dir] = value.split('-');
        sortKey = key;
        sortDir = dir === 'desc' ? -1 : 1;
    }
    updateSortArrows();
    loadProducts();
}

function updateSortArrows() {
    document.querySelectorAll('.data-table th.th-sort').forEach(th => {
        const isActive = th.dataset.key === sortKey;
        th.classList.toggle('sorted', isActive);
        const arrow = th.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = isActive && sortDir === -1 ? '▼' : '▲';
    });
}

function setStatusFilter(status, chipEl) {
    statusFilter = status;
    reorderTab = false;
    lowStockOnly = false;
    document.querySelectorAll('#statusChips .chip').forEach(c => c.classList.remove('active'));
    if (chipEl) chipEl.classList.add('active');
    else document.querySelector(`#statusChips .chip[data-status="${status}"]`)?.classList.add('active');
    const banner = document.getElementById('reorderBanner');
    if (banner) banner.style.display = 'none';
    loadProducts();
}

function filterLowStock(chipEl) {
    // the Restock needed chip: everything at/below reorder level (low + out of stock)
    setStatusFilter('reorder', chipEl);
    const banner = document.getElementById('reorderBanner');
    if (banner) banner.style.display = 'flex';
    const ct = document.getElementById('reorderCount');
    if (ct) ct.textContent = `${formatNumber(Number(productStats?.reorder_count) || 0)} product(s) need reordering`;
}

function showAllProducts() {
    lowStockOnly = false;
    reorderTab = false;
    statusFilter = '';
    const banner = document.getElementById('reorderBanner');
    if (banner) { banner.style.display = 'none'; }
    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('speciesFilter').value = '';
    document.querySelectorAll('#statusChips .chip').forEach(c => c.classList.remove('active'));
    document.querySelector('#statusChips .chip[data-status=""]')?.classList.add('active');
    loadProducts();
}

// Stat cards + chip counts come from one aggregate endpoint, so they always
// reflect the whole catalog even though only a page of products is loaded.
async function updateStats() {
    try {
        const res = await fetch(`${API_URL}/products/stats`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !data.data) return;
        const s = productStats = data.data;
        const n = v => formatNumber(Number(v) || 0);
        document.getElementById('totalProductsCount').textContent = n(s.total);
        document.getElementById('lowStockCount').textContent = n(s.reorder_count);
        document.getElementById('expiringCount').textContent = n(s.expiring_count);
        const valueEl = document.getElementById('totalValue');
        valueEl.textContent = formatCompactCurrency(Number(s.total_value) || 0);
        valueEl.title = formatCurrency(Number(s.total_value) || 0);
        document.getElementById('overstockCount').textContent = n(s.overstock_count);

        const chipCounts = {
            chipCountAll: s.total, chipCountReorder: s.reorder_count, chipCountLow: s.low_count, chipCountOut: s.out_count,
            chipCountExpiring: s.expiring_count, chipCountExpired: s.expired_count, chipCountIn: s.in_count
        };
        for (const id in chipCounts) {
            const el = document.getElementById(id);
            if (el) el.textContent = n(chipCounts[id]);
        }
        const ct = document.getElementById('reorderCount');
        const banner = document.getElementById('reorderBanner');
        if (ct && banner && banner.style.display !== 'none') {
            ct.textContent = `${n(s.reorder_count)} product(s) need reordering`;
        }
    } catch (e) { /* stats are cosmetic; next refresh retries */ }
}

// Search products
document.getElementById('searchInput')?.addEventListener('keyup', filterProducts);
document.getElementById('categoryFilter')?.addEventListener('change', filterProducts);
document.getElementById('speciesFilter')?.addEventListener('change', filterProducts);

function filterProducts() {
    if (lowStockOnly || reorderTab) {
        lowStockOnly = false;
        reorderTab = false;
        const banner = document.getElementById('reorderBanner');
        if (banner) { banner.style.display = 'none'; }
    }
    // Debounced: each keystroke would otherwise fire a server query
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => loadProducts(), 250);
}

// Open add product modal
function openAddProductModal() {
    if (!canManage()) { showToast("Your role can't add products.", 'error'); return; }
    editingProductId = null;
    editingOriginalExpiry = '';
    document.getElementById('modalTitle').textContent = 'Add new product';
    document.getElementById('productForm').reset();
    editingOriginalSku = '';
    clearProductErrors();
    document.getElementById('productMore').open = false;
    document.getElementById('sku_type').closest('.form-group').hidden = false;
    document.getElementById('sku').value = '';
    document.getElementById('skuHint').textContent = 'Made by the system from the product type. It never changes once saved.';
    // new stock needs at least a week before it expires
    document.getElementById('expiration_date').min = earliestExpiryYmd();
    updateImagePreview();
    document.getElementById('productModal').classList.add('active');
}

// Open edit product modal
async function openEditProductModal(id) {
    if (!canManage()) { showToast("Your role can't edit products.", 'error'); return; }
    try {
        const response = await fetch(`${API_URL}/products/${id}`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (data.success) {
            const product = data.data;
            editingProductId = id;
            
            document.getElementById('modalTitle').textContent = 'Edit product';
            document.getElementById('sku').value = product.sku;
            document.getElementById('name').value = product.name;
            document.getElementById('brand').value = product.brand || '';
            document.getElementById('species').value = product.species || '';
            document.getElementById('barcode').value = product.barcode || '';
            document.getElementById('image_url').value = product.image_url || '';
            updateImagePreview();
            document.getElementById('category_id').value = product.category_id;
            document.getElementById('unit_price').value = product.unit_price;
            document.getElementById('cost_price').value = product.cost_price || '';
            document.getElementById('stock_quantity').value = product.stock_quantity;
            document.getElementById('reorder_level').value = product.reorder_level;
            document.getElementById('unit_type').value = product.unit_type || 'piece';
            document.getElementById('max_stock_level').value = product.max_stock_level || '';
            editingOriginalSku = product.sku || '';
            clearProductErrors();
            document.getElementById('sku_type').closest('.form-group').hidden = true;
            document.getElementById('skuHint').textContent = 'The SKU stays the same for as long as the product exists.';
            // open the optional section when it holds something
            document.getElementById('productMore').open = !!(product.brand || product.species || product.image_url || (product.unit_type && product.unit_type !== 'piece'));
            document.getElementById('supplier_id').value = product.supplier_id || '';
            editingOriginalExpiry = product.expiration_date ? product.expiration_date.split('T')[0] : '';
            document.getElementById('expiration_date').value = editingOriginalExpiry;
            // A product whose date is near or past keeps it while other things are
            // edited; a date that is changed needs at least a week left.
            document.getElementById('expiration_date').min = editingOriginalExpiry && editingOriginalExpiry < earliestExpiryYmd() ? '' : earliestExpiryYmd();
            
            document.getElementById('productModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading product:', error);
        showToast(couldNot('load product', error), 'error');
    }
}

// View product details
async function viewProductDetails(id) {
    try {
        const response = await fetch(`${API_URL}/products/${id}`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (data.success) {
            const product = data.data;
            editingProductId = id;
            const detailsHTML = `
                ${product.image_url ? `<div class="details-image"><img src="${escHtml(product.image_url)}" alt="${escHtml(product.name)}" onerror="this.parentNode.remove()"></div>` : ''}
                <div class="details-row">
                    <span class="details-label">SKU</span>
                    <span class="details-value">${escHtml(product.sku)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Product name</span>
                    <span class="details-value">${escHtml(product.name)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Brand</span>
                    <span class="details-value">${escHtml(product.brand || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Category</span>
                    <span class="details-value">${escHtml(product.category_name || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Species</span>
                    <span class="details-value">${escHtml(product.species || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Supplier</span>
                    <span class="details-value">${escHtml(product.supplier_name || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Unit type</span>
                    <span class="details-value">${getUnitLabel(product.unit_type) || 'pcs'}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Unit price</span>
                    <span class="details-value">${formatCurrency(product.unit_price)}${product.unit_type && product.unit_type !== 'piece' ? '/' + getUnitLabel(product.unit_type).trim() : ''}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Cost price</span>
                    <span class="details-value">${formatCurrency(product.cost_price || 0)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Stock quantity</span>
                    <span class="details-value">${formatNumber(product.stock_quantity)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Reorder level</span>
                    <span class="details-value">${product.reorder_level}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Max stock level</span>
                    <span class="details-value">${escHtml(product.max_stock_level || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Expiration date</span>
                    <span class="details-value">${product.expiration_date ? new Date(product.expiration_date).toLocaleDateString() : 'N/A'}</span>
                </div>
                ${product.description ? `<div class="details-row">
                    <span class="details-label">Description</span>
                    <span class="details-value">${escHtml(product.description)}</span>
                </div>` : ''}
            `;
            document.getElementById('productDetailsContent').innerHTML = detailsHTML;
            document.getElementById('productDetailsModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading product details:', error);
        showToast(couldNot('load product details', error), 'error');
    }
}

// Close modal
function closeProductModal() {
    document.getElementById('productModal').classList.remove('active');
    editingProductId = null;
}

// Close product details modal
function closeProductDetailsModal() {
    document.getElementById('productDetailsModal').classList.remove('active');
    editingProductId = null;
}

// Edit from details modal
function editProduct() {
    if (!canManage()) { showToast("Your role can't edit products.", 'error'); return; }
    // capture before closing — closeProductDetailsModal() resets editingProductId
    const id = editingProductId;
    closeProductDetailsModal();
    if (id) openEditProductModal(id);
}

// Delete from details modal
function deleteFromDetails() {
    if (!editingProductId) return;
    deleteProduct(editingProductId);
}

// Delete product with confirmation
/* What deleting does, said before the question is answered. A product with
   items still on the shelf can be deleted, but not without being told. */
function deleteProductQuestion(products) {
    const withStock = products.filter(p => (parseFloat(p.stock_quantity) || 0) > 0);
    const one = products.length === 1;
    let text = one
        ? `Delete <strong>${escHtml(products[0].name)}</strong>? It leaves Inventory, the till and the reorder lists. Its past sales stay in the reports.`
        : `Delete ${products.length} products? They leave Inventory, the till and the reorder lists. Their past sales stay in the reports.`;
    if (withStock.length) {
        text += '<span style="display:block;margin-top:10px;">' + (one
            ? `<strong>It still has ${formatQty(withStock[0].stock_quantity)} in stock.</strong> Deleting it does not take those off the shelf.`
            : `<strong>${withStock.length} of them still ${withStock.length === 1 ? 'has' : 'have'} stock.</strong> Deleting them does not take those items off the shelf.`) + '</span>';
    }
    return text;
}

async function deleteProduct(id) {
    if (!canManage()) { showToast("Your role can't delete products.", 'error'); return; }
    const target = allProducts.find(p => p.id === id);
    showConfirmDialog('Delete product', target ? deleteProductQuestion([target]) : 'Delete this product?', async () => {
        try {
            const response = await fetch(`${API_URL}/products/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showSuccessDialog('Product deleted', 'The product has been removed from your inventory.', { tone: 'danger' });
                closeProductDetailsModal();
                await loadProducts();
            } else {
                showToast('Error: ' + (data.message || 'the server gave no reason'), 'error');
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            showToast(couldNot('delete product', error), 'error');
        }
    }, 'Yes, Delete', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete</span>');
}

// Handle product form submission
let editingOriginalExpiry = '';   // the date the product being edited already has ('' when adding)

/* ---- Product form: every field is checked, and says exactly what is wrong ---- */
let editingOriginalSku = '';
const PRODUCT_FIELDS = ['name', 'category_id', 'sku_type', 'barcode', 'unit_price', 'cost_price', 'stock_quantity', 'reorder_level', 'supplier_id', 'expiration_date', 'brand', 'max_stock_level'];
const PRICE_MAX = 99999999.99;

// what is wrong with one field, or null (the server applies the same limits)
function productFieldProblem(id) {
    const raw = (document.getElementById(id) || {}).value || '';
    const v = String(raw).trim();
    const num = Number(v);
    const twoDecimals = /^\d+(\.\d{1,2})?$/;
    switch (id) {
        case 'name':
            if (!v) return 'Enter the product name.';
            if (v.length < 2) return 'The product name is too short: use at least 2 characters.';
            return null;
        case 'category_id':
            return v ? null : 'Choose a category from the list.';
        case 'sku_type':
            // a saved product keeps its SKU; only a new one is given a type
            if (editingProductId) return null;
            return v ? null : 'Choose the product type. The SKU is made from it.';
        case 'barcode':
            if (!v) return null;
            if (!/^[A-Za-z0-9\-]+$/.test(v)) return 'The barcode can use letters, numbers and dashes only, with no spaces.';
            if (v.length < 4) return 'The barcode is too short: scan it again or click Generate.';
            return null;
        case 'unit_price':
            if (!v) return 'Enter the unit price (the selling price).';
            if (!Number.isFinite(num)) return 'The unit price has to be a number, for example 120.50.';
            if (num <= 0) return 'The unit price has to be more than ₱0.';
            if (num > PRICE_MAX) return 'The unit price is too large (₱99,999,999.99 at most).';
            if (!twoDecimals.test(v)) return 'Use at most 2 decimal places, for example 120.50.';
            return null;
        case 'cost_price': {
            if (!v) return null;
            if (!Number.isFinite(num)) return 'The cost price has to be a number, for example 95.00.';
            if (num < 0) return 'The cost price cannot be less than ₱0.';
            if (num > PRICE_MAX) return 'The cost price is too large (₱99,999,999.99 at most).';
            if (!twoDecimals.test(v)) return 'Use at most 2 decimal places, for example 95.00.';
            const price = Number(document.getElementById('unit_price').value);
            if (price > 0 && num > price) return `The cost price (₱${num.toFixed(2)}) is higher than the unit price (₱${price.toFixed(2)}): the shop would lose money on each sale. Check both prices.`;
            return null;
        }
        case 'stock_quantity': {
            if (!v) return null;
            if (!Number.isFinite(num)) return 'The stock on hand has to be a number.';
            if (num < 0) return 'The stock on hand cannot be less than 0.';
            if (num > 9999999) return 'The stock on hand is too large.';
            const unit = document.getElementById('unit_type').value || 'piece';
            if (unit === 'piece' && !Number.isInteger(num)) return 'Stock sold by the piece has to be a whole number.';
            return null;
        }
        case 'reorder_level':
        case 'max_stock_level': {
            const label = id === 'reorder_level' ? 'The reorder level' : 'The max stock level';
            if (!v) return null;
            if (!Number.isFinite(num)) return `${label} has to be a number.`;
            if (num < 0) return `${label} cannot be less than 0.`;
            if (!Number.isInteger(num)) return `${label} has to be a whole number.`;
            if (num > 1000000) return `${label} is too large (1,000,000 at most).`;
            if (id === 'max_stock_level' && num > 0) {
                const reorder = Number(document.getElementById('reorder_level').value);
                if (Number.isFinite(reorder) && num <= reorder) return `The max stock level has to be higher than the reorder level (${reorder}).`;
            }
            return null;
        }
        case 'supplier_id':
            return v ? null : 'Choose a supplier. A product needs one so it can be reordered.';
        case 'expiration_date':
            // a product that has already expired keeps its date while other things are edited
            return v && v !== editingOriginalExpiry ? expiryDateProblem(v) : null;
        case 'brand':
            return v.length > 100 ? 'The brand is too long (100 characters at most).' : null;
    }
    return null;
}

// show or clear one field's message; returns true when it is right
function checkProductField(id) {
    const problem = productFieldProblem(id);
    const box = document.getElementById('err_' + id);
    const input = document.getElementById(id);
    if (box) box.innerHTML = problem ? '<span class="material-symbols-outlined" style="font-size:14px;">error</span> ' + escHtml(problem) : '';
    if (input) { input.classList.toggle('input-invalid', !!problem); input.setAttribute('aria-invalid', problem ? 'true' : 'false'); }
    return !problem;
}

function clearProductErrors() {
    PRODUCT_FIELDS.forEach(id => {
        const box = document.getElementById('err_' + id); if (box) box.innerHTML = '';
        const input = document.getElementById(id); if (input) { input.classList.remove('input-invalid'); input.removeAttribute('aria-invalid'); }
    });
}

// the SKU a new product would get, shown as soon as its type is chosen
async function showNextSku() {
    const type = document.getElementById('sku_type').value;
    const out = document.getElementById('sku');
    if (editingProductId) return;
    if (!type) { out.value = ''; return; }
    try {
        const res = await fetch(`${API_URL}/products/next-sku?type=${encodeURIComponent(type)}`, { headers: getAuthHeaders() });
        const data = await res.json();
        out.value = data.success ? data.data.sku : '';
        document.getElementById('skuHint').textContent = data.success
            ? 'The number is given for good when you click Save product. It never changes after that.'
            : (data.message || 'The SKU is made when the product is saved.');
    } catch (e) {
        out.value = type + '-…';
        document.getElementById('skuHint').textContent = 'The number is given when the product is saved.';
    }
}

// checked when the user leaves a field, and again while a wrong one is corrected
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('sku_type')?.addEventListener('change', showNextSku);
    PRODUCT_FIELDS.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('blur', () => checkProductField(id));
        input.addEventListener(input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'input', () => {
            if (input.classList.contains('input-invalid')) checkProductField(id);
        });
    });
    // the two prices and the two stock levels are judged against each other
    ['unit_price', 'reorder_level', 'unit_type'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
        if (id === 'unit_price') checkProductField('cost_price');
        if (id === 'reorder_level') checkProductField('max_stock_level');
        if (id === 'unit_type') checkProductField('stock_quantity');
    }));
});

async function handleProductSubmit(event) {
    event.preventDefault();

    // every field is checked; the first one that is wrong gets the cursor
    const wrong = PRODUCT_FIELDS.filter(id => !checkProductField(id));
    if (wrong.length) {
        if (['brand', 'species', 'unit_type', 'max_stock_level'].includes(wrong[0])) document.getElementById('productMore').open = true;
        document.getElementById(wrong[0]).focus();
        showToast(wrong.length === 1 ? 'One field needs fixing: ' + productFieldProblem(wrong[0]) : wrong.length + ' fields need fixing. Each one says what is wrong.', 'error');
        return;
    }

    const productData = {
        sku: document.getElementById('sku').value,
        name: document.getElementById('name').value,
        brand: document.getElementById('brand').value || null,
        barcode: document.getElementById('barcode').value || null,
        image_url: document.getElementById('image_url').value.trim() || null,
        species: document.getElementById('species').value || null,
        category_id: parseInt(document.getElementById('category_id').value),
        unit_price: parseFloat(document.getElementById('unit_price').value),
        cost_price: parseFloat(document.getElementById('cost_price').value) || 0,
        stock_quantity: parseFloat(document.getElementById('stock_quantity').value) || 0,
        reorder_level: parseInt(document.getElementById('reorder_level').value) || 10,
        unit_type: document.getElementById('unit_type').value || 'piece',
        max_stock_level: parseInt(document.getElementById('max_stock_level').value) || null,
        supplier_id: parseInt(document.getElementById('supplier_id').value) || null,
        expiration_date: document.getElementById('expiration_date').value || null
    };
    // the SKU is the system's: a new product sends its type, an edit sends no SKU
    delete productData.sku;
    if (!editingProductId) productData.sku_type = document.getElementById('sku_type').value;
    productData.name = productData.name.trim();
    if (productData.barcode) productData.barcode = productData.barcode.trim();
    if (productData.brand) productData.brand = productData.brand.trim();

    await saveProduct(productData);
}

let productSaving = false;      // a save is on its way: a second press of Save is ignored

/* Sends the product. When its name is already in use the server asks first;
   saying yes sends it again with that question answered. */
async function saveProduct(productData) {
    if (productSaving) return;
    const saveBtn = document.querySelector('#productForm button[type="submit"]');
    const saveLabel = saveBtn ? saveBtn.textContent : '';
    productSaving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    let askAgain = null;
    try {
        const response = await fetch(editingProductId ? `${API_URL}/products/${editingProductId}` : `${API_URL}/products`, {
            method: editingProductId ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(productData)
        });
        const data = await response.json();

        if (data.success) {
            showSuccessDialog(
                editingProductId ? 'Product updated' : 'Product added',
                editingProductId ? `${escHtml(productData.name)} has been saved with the new details.` : `${escHtml(productData.name)} is now in your inventory with the SKU <strong>${escHtml((data.data && data.data.sku) || '')}</strong>.`,
                { icon: 'inventory_2' }
            );
            closeProductModal();
            await loadProducts();
        } else if (data.code === 'SAME_NAME') {
            askAgain = data.message;
        } else {
            showToast(data.message || 'The product was not saved', 'error');
        }
    } catch (error) {
        console.error('Error saving product:', error);
        showToast(couldNot('save product', error), 'error');
    } finally {
        productSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveLabel; }
    }
    if (askAgain) {
        showConfirmDialog('This name is already in use',
            `${escHtml(askAgain)} Two products with one name are hard to tell apart at the till. Save this one under the same name anyway?`,
            () => saveProduct(Object.assign({}, productData, { allow_same_name: true })),
            'Yes, save it');
    }
}

// Stock adjustment functions
let stockAdjustProductId = null;
/* One press of Save is one change. A number is made each time the stock window
   opens and sent with the change; the server acts on a number once. The button
   is also locked while a change is being saved. */
let stockRequestKey = null;
let stockSaving = false;
function newRequestKey() { return 1 + Math.floor(Math.random() * 2147483646); }

function openStockModal(productId) {
    if (!canManage()) { showToast("Your role can't adjust stock.", 'error'); return; }
    stockAdjustProductId = productId;
    stockRequestKey = newRequestKey();
    const product = allProducts.find(p => p.id === productId);
    document.getElementById('stockProductName').textContent = product ? product.name : 'Unknown product';
    document.getElementById('stockQuantity').value = 1;
    document.getElementById('stockAdjustType').value = 'in';
    document.getElementById('stockReason').value = '';
    const exp = document.getElementById('stockExpiry');
    if (exp) { exp.value = ''; exp.min = earliestExpiryYmd(); }
    document.getElementById('stockModal').classList.add('active');
    updateStockPreview();
}

/* The product's date has passed: stock added to it needs the new batch's date. */
function stockProductExpired(product) {
    const d = product && product.expiration_date ? String(product.expiration_date).slice(0, 10) : '';
    return !!d && d < localTodayYmd();
}

/* Why a stock change cannot be made, or null. The server applies the same rule. */
function stockChangeProblem(stock, qty, type) {
    if (!(qty > 0)) return 'Enter a quantity above zero.';
    if (type !== 'in' && qty > stock) return `Only ${formatQty(stock)} in stock: you cannot remove ${formatQty(qty)}.`;
    return null;
}

/* Under the quantity box: what the stock will become, or why it cannot be done. */
function updateStockPreview() {
    const el = document.getElementById('stockPreview');
    if (!el) return;
    const product = allProducts.find(p => p.id === stockAdjustProductId);
    const stock = product ? parseFloat(product.stock_quantity) || 0 : 0;
    const qty = parseFloat(document.getElementById('stockQuantity').value);
    const type = document.getElementById('stockAdjustType').value;
    const problem = stockChangeProblem(stock, qty, type);
    el.style.color = problem ? 'var(--danger)' : 'var(--text-muted)';
    const replacing = type === 'in' && stockProductExpired(product) && stock > 0;
    el.textContent = problem || (replacing
        ? `The ${formatQty(stock)} expired will be removed. Stock will go from ${formatQty(stock)} to ${formatQty(qty)}.`
        : `Stock will go from ${formatQty(stock)} to ${formatQty(type === 'in' ? stock + qty : stock - qty)}.`);
    // the expiry field belongs to stock being added; it is required once the product has expired
    const group = document.getElementById('stockExpiryGroup');
    if (group) {
        group.style.display = type === 'in' ? '' : 'none';
        const expired = stockProductExpired(product);
        document.getElementById('stockExpiryLabel').textContent = expired ? 'Expiration date of the stock being added *' : 'Expiration date of the stock being added (optional)';
        const hint = document.getElementById('stockExpiryHint');
        hint.textContent = expired ? `This product expired on ${String(product.expiration_date).slice(0, 10)}. Enter the new stock's date.` : "Leave it blank to keep the product's current date.";
        hint.style.color = expired ? 'var(--danger)' : 'var(--text-muted)';
    }
}

function closeStockModal() {
    document.getElementById('stockModal').classList.remove('active');
    stockAdjustProductId = null;
}

async function saveStockAdjustment() {
    const qty = parseFloat(document.getElementById('stockQuantity').value);
    const type = document.getElementById('stockAdjustType').value;
    const reason = document.getElementById('stockReason').value || type;
    if (!stockAdjustProductId) { showToast('No product selected', 'error'); return; }
    const onShelf = allProducts.find(p => p.id === stockAdjustProductId);
    const problem = stockChangeProblem(onShelf ? parseFloat(onShelf.stock_quantity) || 0 : 0, qty, type);
    if (problem) { showToast(problem, 'error'); updateStockPreview(); document.getElementById('stockQuantity').focus(); return; }
    const expiry = type === 'in' ? (document.getElementById('stockExpiry').value || '') : '';
    if (type === 'in' && !expiry && stockProductExpired(onShelf)) {
        showToast(`${onShelf.name} expired on ${String(onShelf.expiration_date).slice(0, 10)}. Enter the expiration date of the stock being added.`, 'error');
        document.getElementById('stockExpiry').focus(); return;
    }
    const expiryIssue = expiryDateProblem(expiry);
    if (expiryIssue) { showToast(expiryIssue, 'error'); document.getElementById('stockExpiry').focus(); return; }
    if (stockSaving) return;

    const saveBtn = document.getElementById('stockSaveBtn');
    stockSaving = true;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
        const response = await fetch(`${API_URL}/products/${stockAdjustProductId}/stock`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(Object.assign({ quantity: qty, movement_type: type, notes: reason, request_key: stockRequestKey }, expiry ? { expiration_date: expiry } : {}))
        });
        const data = await response.json();
        if (data.success) {
            showSuccessDialog('Stock adjusted', `Recorded ${type === 'in' ? '+' : '−'}${formatQty(qty)}.` + (data.removed_expired ? ` The ${formatQty(data.removed_expired)} expired were removed.` : '') + ` Stock is now ${formatQty(data.data && data.data.stock_quantity)}.`, { icon: 'sync_alt' });
            closeStockModal();
            await loadProducts();
        } else {
            showToast(data.message || 'The change was not saved', 'error');
            // the stock moved since this page loaded: show the real number and judge again
            if (data.code === 'NOT_ENOUGH_STOCK' && onShelf && data.data) { onShelf.stock_quantity = data.data.stock_quantity; updateStockPreview(); }
        }
    } catch (error) {
        console.error('Error adjusting stock:', error);
        // the number is kept, so pressing Save again cannot apply the change twice
        showToast('The change could not be confirmed. Check the connection and press Save again.', 'error');
    } finally {
        stockSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save adjustment'; }
    }
}

function showWarnings(warnings) {
    const list = warnings.map(w => `<div style="padding:6px 0;border-bottom:1px solid var(--border-color,#eee);font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;color:var(--danger);">warning_amber</span> ${escHtml(w)}</div>`).join('');
    showConfirmDialog('Reorder warnings', list, () => {}, 'Got It', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">smart_toy</span>');
}

// Auto-reorder function — shows product selection list
const REORDER_PAGE_SIZE = 5;

async function autoReorder() {
    if (!canManage()) { showToast("Your role can't reorder.", 'error'); return; }
    // Only a page of products is loaded, so ask the backend for the full
    // low-stock list (light = no image payloads).
    let lowStock = [];
    try {
        const res = await fetch(`${API_URL}/products/low-stock?fields=light`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) lowStock = data.data;
    } catch (e) {
        showToast(couldNot('load low-stock products', e), 'error');
        return;
    }
    if (!lowStock.length) { showToast('No products need reordering', 'info'); return; }

    let displayed = REORDER_PAGE_SIZE;
    const selected = new Set();

    const existing = document.getElementById('reorderModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'reorderModalOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card,#fff);border-radius:12px;padding:0;max-width:600px;width:95%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp 0.25s ease;';

    function render() {
        const items = lowStock.slice(0, displayed);
        const blocked = lowStock.filter(p => !p.supplier_name).length;
        const rowsHtml = items.map(p => {
            const checked = selected.has(p.id) ? 'checked' : '';
            // An order has to go to someone. A product with no supplier, or whose
            // supplier has been deleted, is listed so it is not forgotten, but it
            // cannot be ticked until a supplier is assigned (the server skips it too).
            const orderable = !!p.supplier_name;
            const status = p.stock_quantity === 0 ? 'Out of stock' : 'Low stock';
            const statusColor = p.stock_quantity === 0 ? 'var(--danger)' : 'var(--warning)';
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border-color,#eee);">
                <input type="checkbox" id="reord-${p.id}" ${orderable ? checked : 'disabled'} title="${orderable ? '' : 'Assign a supplier to this product first'}" style="width:18px;height:18px;cursor:${orderable ? 'pointer' : 'not-allowed'};flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escHtml(p.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted,#888);">${escHtml(p.sku || '')} · ${orderable ? escHtml(p.supplier_name) : '<span style="color:var(--danger);font-weight:600;">No supplier: assign one first</span>'}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:12px;color:var(--text-muted,#888);">Stock: <strong>${formatNumber(p.stock_quantity)}</strong></div>
                    <div style="font-size:12px;color:var(--text-muted,#888);">Reorder at: <strong>${p.reorder_level}</strong></div>
                </div>
                <span style="font-size:12px;font-weight:600;padding:3px 8px;border-radius:4px;background:${statusColor}15;color:${statusColor}">${status}</span>
            </div>`;
        }).join('');

        const remaining = lowStock.length - displayed;
        const pagerBtnStyle = 'flex:1;padding:10px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;text-align:center;';
        const moreBtn = remaining > 0
            ? `<button id="reorderLoadMore" style="${pagerBtnStyle}">Show ${Math.min(remaining, REORDER_PAGE_SIZE)} more (${remaining} remaining)</button>`
            : '';
        const lessBtn = displayed > REORDER_PAGE_SIZE
            ? `<button id="reorderShowLess" style="${pagerBtnStyle}">Show less</button>`
            : '';
        const loadMoreHtml = (moreBtn || lessBtn)
            ? `<div style="display:flex;gap:8px;margin:12px 16px;flex-shrink:0;">${moreBtn}${lessBtn}</div>`
            : '';

        dialog.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border-color,#eee);flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="material-symbols-outlined" style="color:var(--primary);font-size:22px;">smart_toy</span>
                    <h3 style="margin:0;font-size:17px;font-weight:700;color:var(--text-primary);">Reorder ${lowStock.length} Low-Stock Items</h3>
                </div>
                <button id="reorderClose" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted,#888);padding:0;line-height:1;">&times;</button>
            </div>
            ${blocked ? `<div style="padding:10px 18px;font-size:13px;line-height:1.45;background:var(--danger-bg);color:var(--text-primary);border-bottom:1px solid var(--border-color,#eee);flex-shrink:0;">
                <strong>${blocked} of these ${blocked === 1 ? 'has' : 'have'} no supplier</strong>, so ${blocked === 1 ? 'it' : 'they'} cannot be ordered yet. Open the product, choose a supplier, then come back.
            </div>` : ''}
            <div id="reorderList" style="overflow-y:auto;flex:1;min-height:0;">
                ${rowsHtml}
            </div>
            ${loadMoreHtml}
            <div style="display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--border-color,#eee);flex-shrink:0;">
                <button id="reorderCancelBtn" style="flex:1;padding:11px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;">Cancel</button>
                <button id="reorderSubmitBtn" style="flex:2;padding:11px;border:none;border-radius:8px;background:var(--primary,#F28B82);color:#fff;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;">Reorder Selected (${selected.size})</button>
            </div>
        `;
    }

    render();

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Add styles
    if (!document.getElementById('reorderModalStyle')) {
        const s = document.createElement('style');
        s.id = 'reorderModalStyle';
        s.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
        document.head.appendChild(s);
    }

    // Event listeners
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    dialog.addEventListener('change', e => {
        if (e.target.id && e.target.id.startsWith('reord-')) {
            const id = parseInt(e.target.id.replace('reord-', ''));
            if (e.target.checked) selected.add(id);
            else selected.delete(id);
            const btn = document.getElementById('reorderSubmitBtn');
            if (btn) btn.textContent = `Reorder Selected (${selected.size})`;
        }
    });

    dialog.addEventListener('click', e => {
        if (e.target.id === 'reorderClose' || e.target.id === 'reorderCancelBtn') {
            overlay.remove();
        }
        if (e.target.id === 'reorderLoadMore' || e.target.id === 'reorderShowLess') {
            displayed = e.target.id === 'reorderLoadMore' ? displayed + REORDER_PAGE_SIZE : Math.max(REORDER_PAGE_SIZE, displayed - REORDER_PAGE_SIZE);
            render();
            // Re-check selected items after re-render
            selected.forEach(id => {
                const cb = document.getElementById(`reord-${id}`);
                if (cb) cb.checked = true;
            });
            const btn = document.getElementById('reorderSubmitBtn');
            if (btn) btn.textContent = `Reorder Selected (${selected.size})`;
        }
        if (e.target.id === 'reorderSubmitBtn') {
            if (selected.size === 0) { showToast('Select at least one product to reorder', 'warning'); return; }
            const ids = Array.from(selected);
            overlay.remove();
            // Second confirmation before the purchase orders are created
            showConfirmDialog(
                'Final check',
                `This will create purchase orders for ${ids.length} product${ids.length === 1 ? '' : 's'} and <strong>email each order to its assigned supplier straight away</strong>. Proceed?`,
                () => doReorder(ids),
                'Yes, Create Orders',
                '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">receipt_long</span>'
            );
        }
    });
}

/* Summarise what a reorder actually did. The count of orders is only half the
   story now that each one is emailed on creation — a supplier with no address
   on file still gets an order, and staff need to know which ones did not go
   out so they can chase them. */
function reorderResultText(data, count) {
    const orders = `${count} purchase order${count === 1 ? '' : 's'} created`;
    const sent = data.emailed || 0;
    const failed = data.email_failed || 0;
    const named = (data.emails || []).filter(e => e.sent).map(e => e.supplier_name);

    if (failed === 0 && sent > 0) {
        return `${orders} and emailed to ${named.length <= 3 ? named.join(', ') : sent + ' suppliers'}.`;
    }
    if (sent === 0) {
        return `${orders}, but none could be emailed. Send them from each supplier's Performance panel.`;
    }
    return `${orders}. ${sent} emailed, ${failed} still to send — see the notes below.`;
}

async function doReorder(productIds) {
    try {
        const response = await fetch(`${API_URL}/purchase-orders/auto-generate`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ product_ids: productIds })
        });
        const data = await response.json();
        if (data.success) {
            const count = data.count || (Array.isArray(data.data) ? data.data.length : 0);
            if (count > 0) {
                showSuccessDialog('Purchase orders sent', reorderResultText(data, count), { icon: data.email_failed ? 'outgoing_mail' : 'mark_email_read' });
            } else {
                showSuccessDialog('No orders generated', data.message || 'Nothing needed reordering — see the notes for details.', { tone: 'info' });
            }
            if (data.warnings && data.warnings.length > 0) {
                setTimeout(() => showWarnings(data.warnings), 500);
            }
            await loadProducts();
        } else {
            showToast('Error: ' + (data.message || 'the server gave no reason'), 'error');
        }
    } catch (error) {
        console.error('Error in reorder:', error);
        showToast(couldNot('reorder', error), 'error');
    }
}

// ===== BULK ACTIONS =====
document.getElementById('selectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBulkBar();
});

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('product-checkbox')) updateBulkBar();
});

function updateBulkBar() {
    const checked = document.querySelectorAll('.product-checkbox:checked');
    const bar = document.getElementById('bulkBar');
    const count = document.getElementById('bulkCount');
    if (!bar || !count) return;
    if (checked.length > 0) {
        bar.style.display = 'flex';
        count.textContent = `${checked.length} selected`;
    } else {
        bar.style.display = 'none';
        document.getElementById('selectAll').checked = false;
    }
}

function getSelectedIds() {
    return Array.from(document.querySelectorAll('.product-checkbox:checked')).map(cb => parseInt(cb.value));
}

function clearSelection() {
    document.querySelectorAll('.product-checkbox:checked').forEach(cb => cb.checked = false);
    updateBulkBar();
}

async function bulkReorder() {
    if (!canManage()) { showToast("Your role can't reorder.", 'error'); return; }
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    showConfirmDialog('Bulk reorder', `Generate purchase orders for ${ids.length} selected product(s)?`, () => {
        // Second confirmation before the purchase orders are created
        showConfirmDialog('Final check', `This will create the purchase orders and <strong>email each one to its assigned supplier straight away</strong>. Proceed?`, async () => {
        try {
            const response = await fetch(`${API_URL}/purchase-orders/auto-generate`, {
                method: 'POST', headers: getAuthHeaders(),
                body: JSON.stringify({ product_ids: ids })
            });
            const data = await response.json();
            const count = data.count || (Array.isArray(data.data) ? data.data.length : 0);
            if (count > 0) {
                showSuccessDialog('Purchase orders sent', reorderResultText(data, count), { icon: data.email_failed ? 'outgoing_mail' : 'mark_email_read' });
            } else {
                showSuccessDialog('No orders generated', data.message || 'Nothing needed reordering — see the notes for details.', { tone: 'info' });
            }
            if (data.warnings && data.warnings.length > 0) {
                setTimeout(() => showWarnings(data.warnings), 500);
            }
            clearSelection();
            await loadProducts();
        } catch (error) {
            console.error('Bulk reorder error:', error);
            showToast(couldNot('reorder', error), 'error');
        }
        }, 'Yes, Send Orders', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">outgoing_mail</span>');
    }, 'Yes, Reorder', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">inventory</span>');
}

async function bulkAdjustStock() {
    if (!canManage()) { showToast("Your role can't adjust stock.", 'error'); return; }
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    showPromptDialog('Bulk stock adjust', `Enter quantity to add/remove for ${ids.length} product(s):<br>(positive = add stock, negative = remove stock)`, (qty) => {
        if (qty === null || qty === '') return;
        const numQty = parseInt(qty);
        if (isNaN(numQty) || numQty === 0) { showToast('Enter the quantity as a number other than 0: a positive number adds stock, a negative number removes it.', 'error'); return; }
        const type = numQty > 0 ? 'in' : 'out';
        showConfirmDialog('Confirm adjustment', `Adjust stock by ${numQty} for ${ids.length} product(s)?`, async () => {
            if (stockSaving) return;
            stockSaving = true;
            try {
                let successCount = 0;
                const refused = [];
                for (const id of ids) {
                    const res = await fetch(`${API_URL}/products/${id}/stock`, {
                        method: 'PUT', headers: getAuthHeaders(),
                        body: JSON.stringify({ quantity: Math.abs(numQty), movement_type: type, notes: 'Bulk adjustment', request_key: newRequestKey() })
                    });
                    const data = await res.json();
                    if (data.success) successCount++;
                    else { const p = allProducts.find(x => x.id === id); refused.push(`${p ? p.name : 'Product #' + id}: ${data.message || 'not changed'}`); }
                }
                // a product that was not changed is named with the reason, not just left out of the count
                const refusedHtml = refused.length
                    ? '<span style="display:block;margin-top:10px;text-align:left;font-size:13px;"><strong>Not changed:</strong>'
                        + refused.slice(0, 8).map(r => `<span style="display:block;margin-top:4px;">${escHtml(r)}</span>`).join('')
                        + (refused.length > 8 ? `<span style="display:block;margin-top:4px;">and ${refused.length - 8} more</span>` : '') + '</span>'
                    : '';
                showSuccessDialog('Stock adjusted', `Updated ${successCount} of ${ids.length} selected product${ids.length === 1 ? '' : 's'}.` + refusedHtml, { icon: 'sync_alt', stay: refused.length > 0 });
                clearSelection();
                await loadProducts();
            } catch (error) {
                console.error('Bulk adjust error:', error);
                showToast(couldNot('adjust stock', error), 'error');
            } finally {
                stockSaving = false;
            }
        }, 'Yes, Adjust', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">assignment</span>');
    }, 'Continue', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">edit_note</span>', 'number', '10');
}

async function bulkDelete() {
    if (!canManage()) { showToast("Your role can't delete products.", 'error'); return; }
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    showConfirmDialog('Bulk delete', deleteProductQuestion(ids.map(id => allProducts.find(p => p.id === id)).filter(Boolean)) || `Delete ${ids.length} product(s)?`, async () => {
        try {
            let successCount = 0;
            for (const id of ids) {
                const res = await fetch(`${API_URL}/products/${id}`, {
                    method: 'DELETE', headers: getAuthHeaders()
                });
                const data = await res.json();
                if (data.success) successCount++;
            }
            showSuccessDialog('Products deleted', `Removed ${successCount} of ${ids.length} selected product${ids.length === 1 ? '' : 's'} from inventory.`, { tone: 'danger' });
            clearSelection();
            await loadProducts();
        } catch (error) {
            console.error('Bulk delete error:', error);
            showToast(couldNot('delete products', error), 'error');
        }
    }, 'Yes, Delete All', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete</span>');
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    const productModal = document.getElementById('productModal');
    const detailsModal = document.getElementById('productDetailsModal');
    const stockModal = document.getElementById('stockModal');
    const csvModal = document.getElementById('csvImportModal');
    
    if (e.target === productModal) {
        closeProductModal();
    }
    if (e.target === detailsModal) {
        closeProductDetailsModal();
    }
    if (e.target === stockModal) {
        closeStockModal();
    }
    if (e.target === csvModal) {
        closeCsvImportModal();
    }
});

// ===== CSV IMPORT =====
let csvParsedData = [];

function openCsvImportModal() {
    if (!canManage()) { showToast("Your role can't import products.", 'error'); return; }
    document.getElementById('csvImportModal').classList.add('active');
    document.getElementById('csvPreview').innerHTML = '';
    document.getElementById('csvFile').value = '';
    document.getElementById('csvSupplier').value = '';
    csvParsedData = [];
    document.getElementById('importBtn').disabled = false;
}

function closeCsvImportModal() {
    document.getElementById('csvImportModal').classList.remove('active');
    csvParsedData = [];
}

document.getElementById('csvFile')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        const text = event.target.result;
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            document.getElementById('csvPreview').innerHTML = '<div class="text-center" style="padding:20px;color:var(--danger);">CSV must have a header row and at least one data row</div>';
            return;
        }
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
        const required = ['sku', 'name'];
        const missing = required.filter(r => !headers.includes(r));
        if (missing.length) {
            document.getElementById('csvPreview').innerHTML = `<div class="text-center" style="padding:20px;color:var(--danger);">Missing required columns: ${missing.join(', ')}</div>`;
            return;
        }
        csvParsedData = [];
        for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ''));
            const row = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
            if (row.sku && row.name) csvParsedData.push(row);
        }
        let previewHtml = `<div style="font-size:13px;font-weight:600;margin-bottom:8px;">Parsed ${csvParsedData.length} products</div>`;
        previewHtml += '<div style="max-height:200px;overflow-y:auto;font-size:12px;">';
        previewHtml += '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:var(--gray-100);">';
        headers.slice(0, 6).forEach(h => { previewHtml += `<th style="padding:6px 8px;text-align:left;">${escHtml(h)}</th>`; });
        previewHtml += '</tr></thead><tbody>';
        csvParsedData.slice(0, 10).forEach(row => {
            previewHtml += '<tr>';
            headers.slice(0, 6).forEach(h => { previewHtml += `<td style="padding:4px 8px;border-bottom:1px solid var(--border-color);">${escHtml(row[h] || '')}</td>`; });
            previewHtml += '</tr>';
        });
        if (csvParsedData.length > 10) previewHtml += `<tr><td colspan="6" style="padding:8px;text-align:center;color:var(--text-muted);">...and ${csvParsedData.length - 10} more</td></tr>`;
        previewHtml += '</tbody></table></div>';
        document.getElementById('csvPreview').innerHTML = previewHtml;
    };
    reader.readAsText(file);
});

async function importCsvProducts() {
    if (!canManage()) { showToast("Your role can't import products.", 'error'); return; }
    if (!csvParsedData.length) { showToast('No valid products to import', 'error'); return; }
    // every product needs a supplier, and the file has no column for one
    const supplierId = parseInt(document.getElementById('csvSupplier').value) || null;
    if (!supplierId) { showToast('Choose the supplier for these products first', 'warning'); document.getElementById('csvSupplier').focus(); return; }
    const btn = document.getElementById('importBtn');
    btn.disabled = true;
    btn.textContent = 'Importing...';

    try {
        const catRes = await fetch(`${API_URL}/products/categories`, { headers: getAuthHeaders() }).then(r => r.json());
        const cats = catRes.data || [];

        // a row with no category, or one the shop does not have, is left out and
        // named in the result; it is not filed under the first category
        const total = csvParsedData.length;
        const leftOut = [];
        const products = [];
        csvParsedData.forEach(row => {
            const typed = String(row.category || '').trim();
            const match = typed ? cats.find(c => String(c.name).toLowerCase() === typed.toLowerCase()) : null;
            if (!match) {
                leftOut.push({ sku: row.sku, error: typed ? `"${typed}" is not one of your categories` : 'no category' });
                return;
            }
            products.push({
                sku: row.sku,
                name: row.name,
                brand: row.brand || null,
                species: row.species || null,
                category_id: match.id,
                unit_price: parseFloat(row.unit_price) || 0,
                cost_price: parseFloat(row.cost_price) || 0,
                unit_type: row.unit_type || 'piece',
                stock_quantity: parseFloat(row.stock_quantity) || 0,
                reorder_level: parseInt(row.reorder_level) || 10,
                description: row.description || null,
                barcode: row.barcode || null,
                supplier_id: supplierId
            });
        });

        // nothing is sent when no row is fit to send
        let data = { success: true, data: { created: 0, errors: [] } };
        if (products.length) {
            const response = await fetch(`${API_URL}/products/bulk`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ products })
            });
            data = await response.json();
        }
        if (data.success) {
            // rows left out here or refused by the server are named with the reason, not just counted
            const skipped = leftOut.concat((data.data && Array.isArray(data.data.errors)) ? data.data.errors : []);
            const created = (data.data && Number(data.data.created)) || 0;
            const skippedHtml = skipped.length
                ? '<span style="display:block;margin-top:10px;text-align:left;font-size:13px;"><strong>Not imported:</strong>'
                    + skipped.slice(0, 8).map(e => `<span style="display:block;margin-top:4px;">${escHtml(e.sku || '(no SKU)')}: ${escHtml(e.error || 'refused')}</span>`).join('')
                    + (skipped.length > 8 ? `<span style="display:block;margin-top:4px;">and ${skipped.length - 8} more</span>` : '') + '</span>'
                : '';
            const summary = `Imported ${created} of ${total} product${total === 1 ? '' : 's'}.`;
            if (created) showSuccessDialog(skipped.length ? 'Import finished, with rows left out' : 'Import complete', summary + skippedHtml, { stay: skipped.length > 0, icon: 'upload_file' });
            else showErrorDialog('Nothing was imported', summary + skippedHtml, { stay: true });
        } else {
            showToast('Import failed: ' + (data.message || 'the server gave no reason'), 'error');
        }
        closeCsvImportModal();
        await loadProducts();
    } catch (e) {
        console.error('CSV import error:', e);
        showToast('Import failed', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Import products';
    }
}

function downloadCsvTemplate() {
    const headers = ['sku', 'name', 'brand', 'category', 'unit_price', 'cost_price', 'stock_quantity', 'reorder_level', 'unit_type', 'description', 'barcode', 'species'];
    const sample = ['DOG-001', 'Sample Product', 'BrandName', 'Food', '199.99', '120.00', '50', '10', 'piece', 'Product description', 'BARCODE001', 'Dog'];
    const csv = headers.join(',') + '\n' + sample.join(',');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
}
/* ===== Barcode assignment ===== */
// Deterministic in-store barcode (UPC-A length) derived from the product id.
function makeInStoreBarcode(id) {
    return '250' + String(id).padStart(9, '0');
}

// "Generate" button on the Add/Edit product form.
function generateBarcodeField() {
    const input = document.getElementById('barcode');
    if (!input) return;
    input.value = editingProductId
        ? makeInStoreBarcode(editingProductId)
        : '2' + String(Date.now()).slice(-11);
    input.focus();
}

function openBarcodeManager() {
    if (!canManage()) { showToast("Your role can't edit products.", 'error'); return; }
    const modal = document.getElementById('barcodeManagerModal');
    const search = document.getElementById('barcodeManagerSearch');
    const showAll = document.getElementById('barcodeShowAll');
    if (search) search.value = '';
    if (showAll) showAll.checked = false;
    modal.classList.add('active');
    toolCatalog = [];
    toolCatalogHasImages = false;
    renderBarcodeManagerList();
    loadToolCatalog(false).then(renderBarcodeManagerList);
    setTimeout(() => search && search.focus(), 100);
}

function closeBarcodeManager() {
    document.getElementById('barcodeManagerModal').classList.remove('active');
    loadProducts();
}

function renderBarcodeManagerList() {
    const list = document.getElementById('barcodeManagerList');
    const countEl = document.getElementById('barcodeManagerCount');
    if (!list) return;
    const q = (document.getElementById('barcodeManagerSearch')?.value || '').toLowerCase().trim();
    const showAll = document.getElementById('barcodeShowAll')?.checked;
    const missing = toolCatalog.filter(p => !p.barcode || String(p.barcode).trim() === '').length;
    let items = toolCatalog.slice();
    if (!showAll) items = items.filter(p => !p.barcode || String(p.barcode).trim() === '');
    if (q) items = items.filter(p =>
        (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (countEl) countEl.textContent = missing + ' product' + (missing === 1 ? '' : 's') + ' without a barcode' +
        (showAll ? ' · showing all' : '');

    if (items.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:13px;">' +
            (missing === 0 ? 'All products have barcodes. 🎉' : 'No products match your filter.') + '</div>';
        return;
    }
    list.innerHTML = items.map(p =>
        '<div class="bc-row" data-id="' + p.id + '">' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-weight:600;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(p.name || '') + '</div>' +
                '<div style="font-size:12px;color:var(--text-muted);">' + escHtml(p.sku || '') + '</div>' +
            '</div>' +
            '<input type="text" class="form-input bc-input" placeholder="Scan or type…" value="' + escHtml(p.barcode || '') + '" style="width:190px;flex-shrink:0;">' +
            '<button type="button" class="btn-secondary bc-gen" title="Generate" style="padding:6px 10px;flex-shrink:0;"><span class="material-symbols-outlined" style="font-size:15px;">auto_fix_high</span></button>' +
            '<span class="bc-status" style="width:20px;flex-shrink:0;text-align:center;"></span>' +
        '</div>'
    ).join('');

    list.querySelectorAll('.bc-row').forEach(row => {
        const id = parseInt(row.dataset.id);
        const input = row.querySelector('.bc-input');
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); saveRowBarcode(id, input.value, row); }
        });
        row.querySelector('.bc-gen').addEventListener('click', () => {
            input.value = makeInStoreBarcode(id);
            saveRowBarcode(id, input.value, row);
        });
    });
}

async function saveRowBarcode(id, value, row) {
    const code = String(value || '').trim();
    const status = row.querySelector('.bc-status');
    if (code.length < 2) { showToast('Enter a barcode first', 'warning'); return; }
    status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;color:var(--text-muted);">hourglass_empty</span>';
    try {
        const res = await fetch(`${API_URL}/products/${id}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ barcode: code })
        });
        const data = await res.json();
        if (res.ok && data.success !== false) {
            status.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:var(--success);">check_circle</span>';
            for (const prod of [toolCatalog.find(p => p.id === id), allProducts.find(p => p.id === id)]) {
                if (prod) prod.barcode = code;
            }
            // jump to the next row that still needs a barcode
            const rows = Array.from(document.querySelectorAll('#barcodeManagerList .bc-row'));
            const idx = rows.indexOf(row);
            for (let i = idx + 1; i < rows.length; i++) {
                const nextInput = rows[i].querySelector('.bc-input');
                if (nextInput && !nextInput.value.trim()) { nextInput.focus(); break; }
            }
        } else {
            status.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger);">error</span>';
            showToast(data.message || 'Could not save (barcode may already be used)', 'error');
        }
    } catch (e) {
        status.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger);">error</span>';
        showToast(couldNot('save barcode', e), 'error');
    }
}

/* ===== Product images ===== */
// Live preview on the Add/Edit product form.
function updateImagePreview() {
    const input = document.getElementById('image_url');
    const img = document.getElementById('imagePreview');
    if (!input || !img) return;
    const url = input.value.trim();
    if (url) {
        img.src = url;
        img.style.display = 'block';
        img.onerror = function () { img.style.display = 'none'; };
    } else {
        img.style.display = 'none';
    }
}

function openImageManager() {
    if (!canManage()) { showToast("Your role can't edit products.", 'error'); return; }
    const search = document.getElementById('imageManagerSearch');
    const showAll = document.getElementById('imageShowAll');
    if (search) search.value = '';
    if (showAll) showAll.checked = false;
    document.getElementById('imageManagerModal').classList.add('active');
    toolCatalog = [];
    toolCatalogHasImages = false;
    renderImageManagerList();
    loadToolCatalog(false).then(renderImageManagerList);
    setTimeout(() => search && search.focus(), 100);
}

function closeImageManager() {
    document.getElementById('imageManagerModal').classList.remove('active');
    loadProducts();
}

function renderImageManagerList() {
    const list = document.getElementById('imageManagerList');
    const countEl = document.getElementById('imageManagerCount');
    if (!list) return;
    const q = (document.getElementById('imageManagerSearch')?.value || '').toLowerCase().trim();
    const showAll = document.getElementById('imageShowAll')?.checked;
    // The default (missing-only) view works from the light list; "show all"
    // needs the actual image data, fetched once on demand.
    if (showAll && !toolCatalogHasImages) {
        list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:13px;">Loading images…</div>';
        loadToolCatalog(true).then(() => { toolCatalogHasImages = true; renderImageManagerList(); });
        return;
    }
    const hasImg = p => p.image_url ? true : !!p.has_image;
    const missing = toolCatalog.filter(p => !hasImg(p)).length;
    let items = toolCatalog.slice();
    if (!showAll) items = items.filter(p => !hasImg(p));
    if (q) items = items.filter(p =>
        (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (countEl) countEl.textContent = missing + ' product' + (missing === 1 ? '' : 's') + ' without an image' +
        (showAll ? ' · showing all' : '');

    if (items.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:13px;">' +
            (missing === 0 ? 'All products have images. 🎉' : 'No products match your filter.') + '</div>';
        return;
    }
    list.innerHTML = items.map(p =>
        '<div class="bc-row img-row" data-id="' + p.id + '">' +
            '<img class="img-thumb" src="' + escHtml(p.image_url || '') + '" alt="" ' +
                (p.image_url ? '' : 'style="display:none;"') + ' onerror="this.style.display=\'none\'">' +
            '<span class="img-thumb-ph" ' + (p.image_url ? 'style="display:none;"' : '') + '><span class="material-symbols-outlined">image</span></span>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-weight:600;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(p.name || '') + '</div>' +
                '<div style="font-size:12px;color:var(--text-muted);">' + escHtml(p.sku || '') + '</div>' +
            '</div>' +
            '<input type="text" class="form-input img-input" placeholder="Paste URL…" value="' + escHtml(p.image_url || '') + '" style="width:180px;flex-shrink:0;">' +
            '<label class="btn-secondary" title="Upload from this device" style="cursor:pointer;padding:6px 9px;flex-shrink:0;margin:0;">' +
                '<span class="material-symbols-outlined" style="font-size:15px;">upload</span>' +
                '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-id="' + p.id + '" style="display:none;" onchange="handleManagerImageFile(this)">' +
            '</label>' +
            '<span class="bc-status" style="width:20px;flex-shrink:0;text-align:center;"></span>' +
        '</div>'
    ).join('');

    list.querySelectorAll('.img-row').forEach(row => {
        const id = parseInt(row.dataset.id);
        const input = row.querySelector('.img-input');
        const thumb = row.querySelector('.img-thumb');
        const ph = row.querySelector('.img-thumb-ph');
        // live thumbnail as they paste
        input.addEventListener('input', () => {
            const url = input.value.trim();
            if (url) { thumb.src = url; thumb.style.display = 'block'; ph.style.display = 'none'; thumb.onerror = () => { thumb.style.display = 'none'; ph.style.display = 'flex'; }; }
            else { thumb.style.display = 'none'; ph.style.display = 'flex'; }
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); saveRowImage(id, input.value, row); }
        });
    });
}

async function saveRowImage(id, value, row) {
    const url = String(value || '').trim();
    const status = row.querySelector('.bc-status');
    status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;color:var(--text-muted);">hourglass_empty</span>';
    try {
        const res = await fetch(`${API_URL}/products/${id}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ image_url: url || null })
        });
        const data = await res.json();
        if (res.ok && data.success !== false) {
            status.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:var(--success);">check_circle</span>';
            for (const prod of [toolCatalog.find(p => p.id === id), allProducts.find(p => p.id === id)]) {
                if (prod) { prod.image_url = url || null; prod.has_image = !!url; }
            }
            const rows = Array.from(document.querySelectorAll('#imageManagerList .img-row'));
            const idx = rows.indexOf(row);
            for (let i = idx + 1; i < rows.length; i++) {
                const nextInput = rows[i].querySelector('.img-input');
                if (nextInput && !nextInput.value.trim()) { nextInput.focus(); break; }
            }
        } else {
            status.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger);">error</span>';
            showToast(data.message || 'Could not save image', 'error');
        }
    } catch (e) {
        status.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger);">error</span>';
        showToast(couldNot('save image', e), 'error');
    }
}

/* ===== Image upload (client-side resize -> data URL, stored in image_url) ===== */
// Render/free hosting has an ephemeral disk, so we downscale the picture in the
// browser and store it as a compact data URL right in the product record.
function resizeImageFile(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const problem = imageFileProblem(file);
        if (problem) { reject(new Error(problem)); return; }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.onload = function () {
            const img = new Image();
            img.onerror = () => reject(new Error('That image could not be loaded'));
            img.onload = function () {
                let w = img.width, h = img.height;
                if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
                else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality || 0.72));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// Upload handler for the Add/Edit product form.
function handleFormImageFile(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    resizeImageFile(file, 600, 0.72).then(dataUrl => {
        document.getElementById('image_url').value = dataUrl;
        updateImagePreview();
        showToast('Image ready — save the product to keep it', 'success');
    }).catch(err => showToast(err.message || 'Could not process image', 'error'));
    inputEl.value = '';
}

// Upload handler for a row in the bulk Product Images manager.
function handleManagerImageFile(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    const id = parseInt(inputEl.dataset.id);
    inputEl.value = '';
    if (!file) return;
    const row = document.querySelector('#imageManagerList .img-row[data-id="' + id + '"]');
    if (!row) return;
    const status = row.querySelector('.bc-status');
    if (status) status.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;color:var(--text-muted);">hourglass_empty</span>';
    resizeImageFile(file, 600, 0.72).then(dataUrl => {
        const textInput = row.querySelector('.img-input');
        if (textInput) textInput.value = dataUrl;
        const thumb = row.querySelector('.img-thumb');
        const ph = row.querySelector('.img-thumb-ph');
        if (thumb) { thumb.src = dataUrl; thumb.style.display = 'block'; }
        if (ph) ph.style.display = 'none';
        saveRowImage(id, dataUrl, row);
    }).catch(err => showToast(err.message || 'Could not process image', 'error'));
}
