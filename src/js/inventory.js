const API_URL = '/api';
const PAGE_SIZE = 10;
const LOW_STOCK_PAGE_SIZE = 5;
let displayCount = PAGE_SIZE;
let allProducts = [];
let editingProductId = null;
let lowStockOnly = false;
let reorderTab = false;

// Load page on startup
window.addEventListener('load', async () => {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }
    if (isViewer()) {
        document.querySelectorAll('.page-header-actions .btn-primary, .page-header-actions .btn-secondary, .page-header-actions .btn-warning').forEach(b => b.style.display = 'none');
        document.getElementById('bulkBar').style.display = 'none';
        document.querySelector('#productDetailsModal .btn-primary')?.remove();
        document.querySelector('#productDetailsModal .btn-danger')?.remove();
        const selectAllTh = document.querySelector('.data-table thead th:first-child');
        if (selectAllTh) selectAllTh.style.display = 'none';
        const actionsTh = document.querySelector('.data-table thead th:last-child');
        if (actionsTh) actionsTh.textContent = '';
    }
    await loadCategories();
    await loadSuppliers();
    await loadProducts();
});

// Load categories for the dropdown and filter
async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/products/categories`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (data.success) {
            const categorySelect = document.getElementById('category_id');
            const filterSelect = document.getElementById('categoryFilter');
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
            const sel = document.getElementById('supplier_id');
            (Array.isArray(data.data) ? data.data : []).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                sel.appendChild(opt);
            });
        }
    } catch (error) {
        console.error('Error loading suppliers:', error);
    }
}

// Load all products
async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/products`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (data.success) {
            allProducts = data.data;
            displayProducts(allProducts);
            updateStats();
        }
    } catch (error) {
        console.error('Error loading products:', error);
        showToast('Failed to load products', 'error');
    }
}

function displayProducts(products) {
    const tbody = document.getElementById('productsTableBody');
    const viewer = isViewer();
    const colSpan = viewer ? 11 : 12;
    
    if (products.length === 0) {
        const hasFilters = !!(document.getElementById('searchInput')?.value ||
            document.getElementById('categoryFilter')?.value ||
            document.getElementById('speciesFilter')?.value || reorderTab);
        const icon = hasFilters ? 'search_off' : 'inventory_2';
        const title = hasFilters ? 'No products match your filters' : 'No products yet';
        const hint = hasFilters
            ? 'Try adjusting your search or filters.'
            : (viewer ? 'Products will appear here once added.' : 'Add your first product or import from CSV to get started.');
        const action = hasFilters
            ? '<button class="btn-secondary" onclick="showAllProducts()" style="margin-top:14px;padding:8px 18px;font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">filter_alt_off</span> Clear Filters</button>'
            : (viewer ? '' : '<button class="btn-primary" onclick="openAddProductModal()" style="margin-top:14px;padding:8px 18px;font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">add</span> Add Product</button>');
        tbody.innerHTML = `<tr><td colspan="${colSpan}">
            <div class="empty-state" style="padding:48px 22px;">
                <span class="material-symbols-outlined" style="font-size:44px;color:var(--border-strong,#ccc);display:block;margin-bottom:10px;">${icon}</span>
                <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${title}</div>
                <div>${hint}</div>
                ${action}
            </div>
        </td></tr>`;
        updatePagination('inventoryPagination', products, displayCount, 'showMoreProducts');
        return;
    }

    const shown = products.slice(0, displayCount);
    tbody.innerHTML = shown.map(product => {
        let expDateFormatted = '<span style="color:var(--text-muted);">—</span>';

        if (product.expiration_date) {
            const date = new Date(product.expiration_date);
            if (!isNaN(date.getTime())) {
                const formatted = date.toLocaleDateString('en-US', {
                    year: 'numeric', month: '2-digit', day: '2-digit'
                });
                const daysLeft = Math.floor((date - new Date()) / 86400000);
                if (daysLeft < 0) {
                    expDateFormatted = `<span style="color:var(--danger);font-weight:600;" title="Expired">${formatted}</span>`;
                } else if (daysLeft <= 30) {
                    expDateFormatted = `<span style="color:var(--warning,#e65100);font-weight:600;" title="Expires in ${daysLeft} day(s)">${formatted}</span>`;
                } else {
                    expDateFormatted = formatted;
                }
            }
        }

        const stockNum = Number(product.stock_quantity) || 0;
        const stockDisplay = formatNumber(product.stock_quantity) + getUnitLabel(product.unit_type);
        const stockCell = stockNum === 0
            ? `<span style="color:var(--danger);font-weight:700;">${stockDisplay}</span>`
            : stockNum <= product.reorder_level
                ? `<span style="color:var(--warning,#e65100);font-weight:700;">${stockDisplay}</span>`
                : stockDisplay;

        return `
            <tr>
                ${viewer ? '' : `<td><input type="checkbox" class="product-checkbox" value="${product.id}"></td>`}
                <td>${escHtml(product.sku)}</td>
                <td>${escHtml(product.name)}</td>
                <td>${escHtml(product.brand || 'N/A')}</td>
                <td>${escHtml(product.category_name || 'N/A')}</td>
                <td>${escHtml(product.species || 'N/A')}</td>
                <td>${formatCurrency(product.unit_price)}</td>
                <td>${stockCell}</td>
                <td>${product.reorder_level}</td>
                <td>${expDateFormatted}</td>
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
    updatePagination('inventoryPagination', products, displayCount, 'showMoreProducts');
}

function showMoreProducts() {
    const step = reorderTab ? LOW_STOCK_PAGE_SIZE : PAGE_SIZE;
    displayCount += step;
    let filtered;
    if (reorderTab) {
        filtered = allProducts.filter(p => p.stock_quantity <= p.reorder_level);
    } else {
        const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || '';
        const categoryId = document.getElementById('categoryFilter')?.value || '';
        const species = document.getElementById('speciesFilter')?.value || '';
        filtered = allProducts.filter(p => {
            const matchesSearch = !searchTerm ||
                (p.name || '').toLowerCase().includes(searchTerm) ||
                (p.sku || '').toLowerCase().includes(searchTerm) ||
                (p.brand || '').toLowerCase().includes(searchTerm) ||
                (p.barcode || '').toLowerCase().includes(searchTerm);
            const matchesCategory = !categoryId || p.category_id == categoryId;
            const matchesSpecies = !species || (p.species || '').toLowerCase() === species.toLowerCase();
            return matchesSearch && matchesCategory && matchesSpecies;
        });
    }
    displayProducts(filtered);
}


function getUnitLabel(unitType) {
    const labels = { piece: '', kg: ' kg', g: ' g', liter: ' L', ml: ' mL' };
    return labels[unitType] || '';
}

// Get status badge with expiration check
function getStatusBadge(stock, reorder, expirationDate) {
    // Check if product is expiring soon (within 30 days)
    if (expirationDate) {
        const expDate = new Date(expirationDate);
        const today = new Date();
        const daysUntilExpiry = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry < 0) {
            return '<span class="status-badge status-expired">Expired</span>';
        } else if (daysUntilExpiry <= 30) {
            return '<span class="status-badge status-expiring-soon">Expiring Soon</span>';
        }
    }

    if (stock === 0) {
        return '<span class="status-badge status-out-of-stock">Out of Stock</span>';
    } else if (stock <= reorder) {
        return '<span class="status-badge status-low-stock">Low Stock</span>';
    } else {
        return '<span class="status-badge status-in-stock">In Stock</span>';
    }
}

function filterLowStock() {
    lowStockOnly = true;
    reorderTab = true;
    displayCount = LOW_STOCK_PAGE_SIZE;
    const lowStock = allProducts.filter(p => p.stock_quantity <= p.reorder_level);
    const banner = document.getElementById('reorderBanner');
    if (banner) { banner.style.display = 'flex'; }
    const ct = document.getElementById('reorderCount');
    if (ct) { ct.textContent = `${lowStock.length} product(s) need reordering`; }
    displayProducts(lowStock);
}

function showAllProducts() {
    lowStockOnly = false;
    reorderTab = false;
    displayCount = PAGE_SIZE;
    const banner = document.getElementById('reorderBanner');
    if (banner) { banner.style.display = 'none'; }
    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('speciesFilter').value = '';
    displayProducts(allProducts);
}

// Update statistics
function updateStats() {
    const totalProducts = allProducts.length;
    const lowStockProducts = allProducts.filter(p => p.stock_quantity <= p.reorder_level).length;
    
    // Count products expiring within 30 days
    const today = new Date();
    const expiringProducts = allProducts.filter(p => {
        if (!p.expiration_date) return false;
        const expDate = new Date(p.expiration_date);
        const daysUntilExpiry = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
        return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
    }).length;
    
    const totalValue = allProducts.reduce((sum, p) => sum + (p.unit_price * p.stock_quantity), 0);
    const overstockProducts = allProducts.filter(p => p.max_stock_level && p.stock_quantity > p.max_stock_level * 1.5).length;

    document.getElementById('totalProductsCount').textContent = formatNumber(totalProducts);
    document.getElementById('lowStockCount').textContent = formatNumber(lowStockProducts);
    document.getElementById('expiringCount').textContent = formatNumber(expiringProducts);
    document.getElementById('totalValue').textContent = formatCurrency(totalValue);
    document.getElementById('overstockCount').textContent = formatNumber(overstockProducts);
}

// Search products
document.getElementById('searchInput')?.addEventListener('keyup', filterProducts);
document.getElementById('categoryFilter')?.addEventListener('change', filterProducts);
document.getElementById('speciesFilter')?.addEventListener('change', filterProducts);

function filterProducts() {
    if (lowStockOnly) {
        lowStockOnly = false;
        reorderTab = false;
        const banner = document.getElementById('reorderBanner');
        if (banner) { banner.style.display = 'none'; }
    }
    const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    const categoryId = document.getElementById('categoryFilter')?.value || '';
    const species = document.getElementById('speciesFilter')?.value || '';

    displayCount = PAGE_SIZE;
    const filtered = allProducts.filter(p => {
        const matchesSearch = !searchTerm ||
            (p.name || '').toLowerCase().includes(searchTerm) ||
            (p.sku || '').toLowerCase().includes(searchTerm) ||
            (p.brand || '').toLowerCase().includes(searchTerm) ||
            (p.barcode || '').toLowerCase().includes(searchTerm);
        const matchesCategory = !categoryId || p.category_id == categoryId;
        const matchesSpecies = !species || (p.species || '').toLowerCase() === species.toLowerCase();
        return matchesSearch && matchesCategory && matchesSpecies;
    });
    displayProducts(filtered);
}

// Open add product modal
function openAddProductModal() {
    if (isViewer()) { showToast('View-only account. Cannot add products.', 'error'); return; }
    editingProductId = null;
    document.getElementById('modalTitle').textContent = 'Add New Product';
    document.getElementById('productForm').reset();
    document.getElementById('productModal').classList.add('active');
}

// Open edit product modal
async function openEditProductModal(id) {
    if (isViewer()) { showToast('View-only account. Cannot edit products.', 'error'); return; }
    try {
        const response = await fetch(`${API_URL}/products/${id}`, { headers: getAuthHeaders() });
        const data = await response.json();

        if (data.success) {
            const product = data.data;
            editingProductId = id;
            
            document.getElementById('modalTitle').textContent = 'Edit Product';
            document.getElementById('sku').value = product.sku;
            document.getElementById('name').value = product.name;
            document.getElementById('brand').value = product.brand || '';
            document.getElementById('species').value = product.species || '';
            document.getElementById('breed_size').value = product.breed_size || '';
            document.getElementById('age_group').value = product.age_group || '';
            document.getElementById('health_category').value = product.health_category || '';
            document.getElementById('barcode').value = product.barcode || '';
            document.getElementById('category_id').value = product.category_id;
            document.getElementById('unit_price').value = product.unit_price;
            document.getElementById('cost_price').value = product.cost_price || '';
            document.getElementById('stock_quantity').value = product.stock_quantity;
            document.getElementById('reorder_level').value = product.reorder_level;
            document.getElementById('unit_type').value = product.unit_type || 'piece';
            document.getElementById('max_stock_level').value = product.max_stock_level || '';
            document.getElementById('supplier_id').value = product.supplier_id || '';
            document.getElementById('batch_number').value = product.batch_number || '';
            document.getElementById('expiration_date').value = product.expiration_date ? product.expiration_date.split('T')[0] : '';
            document.getElementById('description').value = product.description || '';
            
            document.getElementById('productModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading product:', error);
        showToast('Failed to load product', 'error');
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
                <div class="details-row">
                    <span class="details-label">SKU</span>
                    <span class="details-value">${escHtml(product.sku)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Product Name</span>
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
                    <span class="details-label">Breed Size</span>
                    <span class="details-value">${escHtml(product.breed_size || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Age Group</span>
                    <span class="details-value">${escHtml(product.age_group || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Health Category</span>
                    <span class="details-value">${escHtml(product.health_category || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Supplier</span>
                    <span class="details-value">${escHtml(product.supplier_name || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Unit Type</span>
                    <span class="details-value">${getUnitLabel(product.unit_type) || 'pcs'}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Unit Price</span>
                    <span class="details-value">${formatCurrency(product.unit_price)}${product.unit_type && product.unit_type !== 'piece' ? '/' + getUnitLabel(product.unit_type).trim() : ''}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Cost Price</span>
                    <span class="details-value">${formatCurrency(product.cost_price || 0)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Stock Quantity</span>
                    <span class="details-value">${formatNumber(product.stock_quantity)}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Reorder Level</span>
                    <span class="details-value">${product.reorder_level}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Max Stock Level</span>
                    <span class="details-value">${escHtml(product.max_stock_level || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Batch/Lot Number</span>
                    <span class="details-value">${escHtml(product.batch_number || 'N/A')}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Expiration Date</span>
                    <span class="details-value">${product.expiration_date ? new Date(product.expiration_date).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div class="details-row">
                    <span class="details-label">Description</span>
                    <span class="details-value">${escHtml(product.description || 'N/A')}</span>
                </div>
            `;
            document.getElementById('productDetailsContent').innerHTML = detailsHTML;
            document.getElementById('productDetailsModal').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading product details:', error);
        showToast('Failed to load product details', 'error');
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
    if (isViewer()) { showToast('View-only account. Cannot edit products.', 'error'); return; }
    closeProductDetailsModal();
    openEditProductModal(editingProductId);
}

// Delete from details modal
function deleteFromDetails() {
    if (!editingProductId) return;
    deleteProduct(editingProductId);
}

// Delete product with confirmation
async function deleteProduct(id) {
    if (isViewer()) { showToast('View-only account. Cannot delete products.', 'error'); return; }
    showConfirmDialog('Delete Product', 'Are you sure you want to delete this product? This cannot be undone.', async () => {
        try {
            const response = await fetch(`${API_URL}/products/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showToast('Product deleted!', 'success');
                closeProductDetailsModal();
                await loadProducts();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            showToast('Failed to delete product', 'error');
        }
    }, 'Yes, Delete', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete</span>');
}

// Handle product form submission
async function handleProductSubmit(event) {
    event.preventDefault();

    const productData = {
        sku: document.getElementById('sku').value,
        name: document.getElementById('name').value,
        brand: document.getElementById('brand').value || null,
        barcode: document.getElementById('barcode').value || null,
        species: document.getElementById('species').value || null,
        breed_size: document.getElementById('breed_size').value || null,
        age_group: document.getElementById('age_group').value || null,
        health_category: document.getElementById('health_category').value || null,
        category_id: parseInt(document.getElementById('category_id').value),
        unit_price: parseFloat(document.getElementById('unit_price').value),
        cost_price: parseFloat(document.getElementById('cost_price').value) || 0,
        stock_quantity: parseFloat(document.getElementById('stock_quantity').value) || 0,
        reorder_level: parseInt(document.getElementById('reorder_level').value) || 10,
        unit_type: document.getElementById('unit_type').value || 'piece',
        max_stock_level: parseInt(document.getElementById('max_stock_level').value) || null,
        supplier_id: parseInt(document.getElementById('supplier_id').value) || null,
        batch_number: document.getElementById('batch_number').value || null,
        expiration_date: document.getElementById('expiration_date').value || null,
        description: document.getElementById('description').value || null
    };

    try {
        let response;
        if (editingProductId) {
            response = await fetch(`${API_URL}/products/${editingProductId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify(productData)
            });
        } else {
            response = await fetch(`${API_URL}/products`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(productData)
            });
        }

        const data = await response.json();

        if (data.success) {
            showToast(editingProductId ? 'Product updated!' : 'Product added!', 'success');
            closeProductModal();
            await loadProducts();
        } else {
            showToast('Error: ' + (data.message || 'Unknown'), 'error');
        }
    } catch (error) {
        console.error('Error saving product:', error);
        showToast('Failed to save product', 'error');
    }
}

// Stock adjustment functions
let stockAdjustProductId = null;

function openStockModal(productId) {
    if (isViewer()) { showToast('View-only account. Cannot adjust stock.', 'error'); return; }
    stockAdjustProductId = productId;
    const product = allProducts.find(p => p.id === productId);
    document.getElementById('stockProductName').textContent = product ? product.name : 'Unknown Product';
    document.getElementById('stockQuantity').value = 1;
    document.getElementById('stockAdjustType').value = 'in';
    document.getElementById('stockReason').value = '';
    document.getElementById('stockModal').classList.add('active');
}

function closeStockModal() {
    document.getElementById('stockModal').classList.remove('active');
    stockAdjustProductId = null;
}

async function saveStockAdjustment() {
    const qty = parseFloat(document.getElementById('stockQuantity').value);
    const type = document.getElementById('stockAdjustType').value;
    const reason = document.getElementById('stockReason').value || type;
    if (!qty || qty <= 0) { showToast('Invalid quantity', 'error'); return; }
    if (!stockAdjustProductId) { showToast('No product selected', 'error'); return; }

    try {
        const response = await fetch(`${API_URL}/products/${stockAdjustProductId}/stock`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ quantity: qty, movement_type: type, notes: reason })
        });
        const data = await response.json();
        if (data.success) {
            showToast('Stock adjusted!', 'success');
            closeStockModal();
            await loadProducts();
        } else {
            showToast('Error: ' + (data.message || 'Unknown'), 'error');
        }
    } catch (error) {
        console.error('Error adjusting stock:', error);
        showToast('Failed to adjust stock', 'error');
    }
}

function showWarnings(warnings) {
    const list = warnings.map(w => `<div style="padding:6px 0;border-bottom:1px solid var(--border-color,#eee);font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;color:var(--danger);">warning_amber</span> ${escHtml(w)}</div>`).join('');
    showConfirmDialog('Reorder Warnings', list, () => {}, 'Got It', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">smart_toy</span>');
}

// Auto-reorder function — shows product selection list
const REORDER_PAGE_SIZE = 5;

async function autoReorder() {
    if (isViewer()) { showToast('View-only account. Cannot reorder.', 'error'); return; }
    if (!allProducts.length) await loadProducts();
    const lowStock = allProducts.filter(p => p.stock_quantity <= p.reorder_level);
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
        const rowsHtml = items.map(p => {
            const checked = selected.has(p.id) ? 'checked' : '';
            const status = p.stock_quantity === 0 ? 'Out of Stock' : 'Low Stock';
            const statusColor = p.stock_quantity === 0 ? 'var(--danger)' : 'var(--warning)';
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border-color,#eee);">
                <input type="checkbox" id="reord-${p.id}" ${checked} style="width:18px;height:18px;cursor:pointer;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escHtml(p.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted,#888);">${escHtml(p.sku || '')} · ${p.supplier_name || 'No supplier'}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-size:12px;color:var(--text-muted,#888);">Stock: <strong>${formatNumber(p.stock_quantity)}</strong></div>
                    <div style="font-size:12px;color:var(--text-muted,#888);">Reorder at: <strong>${p.reorder_level}</strong></div>
                </div>
                <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;background:${statusColor}15;color:${statusColor}">${status}</span>
            </div>`;
        }).join('');

        const remaining = lowStock.length - displayed;
        const loadMoreHtml = remaining > 0
            ? `<button id="reorderLoadMore" style="display:block;width:calc(100% - 32px);margin:12px 16px;padding:10px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;text-align:center;">Show ${Math.min(remaining, REORDER_PAGE_SIZE)} more (${remaining} remaining)</button>`
            : '';

        dialog.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border-color,#eee);flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="material-symbols-outlined" style="color:var(--primary);font-size:22px;">smart_toy</span>
                    <h3 style="margin:0;font-size:17px;font-weight:700;color:var(--text-primary);">Reorder ${lowStock.length} Low-Stock Items</h3>
                </div>
                <button id="reorderClose" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted,#888);padding:0;line-height:1;">&times;</button>
            </div>
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
        if (e.target.id === 'reorderLoadMore') {
            displayed += REORDER_PAGE_SIZE;
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
            overlay.remove();
            doReorder(Array.from(selected));
        }
    });
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
            showToast(`Generated ${count} purchase order(s)!`, count > 0 ? 'success' : 'warning');
            if (data.warnings && data.warnings.length > 0) {
                setTimeout(() => showWarnings(data.warnings), 500);
            }
            await loadProducts();
        } else {
            showToast('Error: ' + (data.message || 'Unknown'), 'error');
        }
    } catch (error) {
        console.error('Error in reorder:', error);
        showToast('Failed to reorder', 'error');
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
    if (isViewer()) { showToast('View-only account. Cannot reorder.', 'error'); return; }
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    showConfirmDialog('Bulk Reorder', `Generate purchase orders for ${ids.length} selected product(s)?`, async () => {
        try {
            const response = await fetch(`${API_URL}/purchase-orders/auto-generate`, {
                method: 'POST', headers: getAuthHeaders(),
                body: JSON.stringify({ product_ids: ids })
            });
            const data = await response.json();
            const count = data.count || (Array.isArray(data.data) ? data.data.length : 0);
            const msg = count > 0
                ? `Generated ${count} purchase order(s)!`
                : (data.message || 'No purchase orders generated');
            showToast(msg, count > 0 ? 'success' : 'warning');
            if (data.warnings && data.warnings.length > 0) {
                setTimeout(() => showWarnings(data.warnings), 500);
            }
            clearSelection();
            await loadProducts();
        } catch (error) {
            console.error('Bulk reorder error:', error);
            showToast('Failed to reorder', 'error');
        }
    }, 'Yes, Reorder', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">inventory</span>');
}

async function bulkAdjustStock() {
    if (isViewer()) { showToast('View-only account. Cannot adjust stock.', 'error'); return; }
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    showPromptDialog('Bulk Stock Adjust', `Enter quantity to add/remove for ${ids.length} product(s):<br>(positive = add stock, negative = remove stock)`, (qty) => {
        if (qty === null || qty === '') return;
        const numQty = parseInt(qty);
        if (isNaN(numQty) || numQty === 0) { showToast('Invalid quantity', 'error'); return; }
        const type = numQty > 0 ? 'in' : 'out';
        showConfirmDialog('Confirm Adjustment', `Adjust stock by ${numQty} for ${ids.length} product(s)?`, async () => {
            try {
                let successCount = 0;
                for (const id of ids) {
                    const res = await fetch(`${API_URL}/products/${id}/stock`, {
                        method: 'PUT', headers: getAuthHeaders(),
                        body: JSON.stringify({ quantity: Math.abs(numQty), movement_type: type, notes: 'Bulk adjustment' })
                    });
                    const data = await res.json();
                    if (data.success) successCount++;
                }
                showToast(`Adjusted stock for ${successCount}/${ids.length} product(s)`, 'success');
                clearSelection();
                await loadProducts();
            } catch (error) {
                console.error('Bulk adjust error:', error);
                showToast('Failed to adjust stock', 'error');
            }
        }, 'Yes, Adjust', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">assignment</span>');
    }, 'Continue', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">edit_note</span>', 'number', '10');
}

async function bulkDelete() {
    if (isViewer()) { showToast('View-only account. Cannot delete products.', 'error'); return; }
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    showConfirmDialog('Bulk Delete', `Delete ${ids.length} product(s)? This cannot be undone.`, async () => {
        try {
            let successCount = 0;
            for (const id of ids) {
                const res = await fetch(`${API_URL}/products/${id}`, {
                    method: 'DELETE', headers: getAuthHeaders()
                });
                const data = await res.json();
                if (data.success) successCount++;
            }
            showToast(`Deleted ${successCount}/${ids.length} product(s)`, 'success');
            clearSelection();
            await loadProducts();
        } catch (error) {
            console.error('Bulk delete error:', error);
            showToast('Failed to delete products', 'error');
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
    if (isViewer()) { showToast('View-only account. Cannot import products.', 'error'); return; }
    document.getElementById('csvImportModal').classList.add('active');
    document.getElementById('csvPreview').innerHTML = '';
    document.getElementById('csvFile').value = '';
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
    if (isViewer()) { showToast('View-only account. Cannot import products.', 'error'); return; }
    if (!csvParsedData.length) { showToast('No valid products to import', 'error'); return; }
    const btn = document.getElementById('importBtn');
    btn.disabled = true;
    btn.textContent = 'Importing...';

    try {
        const catRes = await fetch(`${API_URL}/products/categories`, { headers: getAuthHeaders() }).then(r => r.json());
        const cats = catRes.data || [];

        const products = csvParsedData.map(row => {
            let catId = cats.length > 0 ? cats[0].id : null;
            if (row.category) {
                const match = cats.find(c => c.name.toLowerCase() === row.category.toLowerCase());
                if (match) catId = match.id;
            }
            return {
                sku: row.sku,
                name: row.name,
                brand: row.brand || null,
                species: row.species || null,
                category_id: catId,
                unit_price: parseFloat(row.unit_price) || 0,
                cost_price: parseFloat(row.cost_price) || 0,
                    unit_type: row.unit_type || 'piece',
                    stock_quantity: parseFloat(row.stock_quantity) || 0,
                    reorder_level: parseInt(row.reorder_level) || 10,
                    description: row.description || null,
                    barcode: row.barcode || null
            };
        });

        const response = await fetch(`${API_URL}/products/bulk`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ products })
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message || `Imported ${products.length} product(s)`, 'success');
        } else {
            showToast('Import failed: ' + (data.message || 'Unknown'), 'error');
        }
        closeCsvImportModal();
        await loadProducts();
    } catch (e) {
        console.error('CSV import error:', e);
        showToast('Import failed', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Import Products';
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