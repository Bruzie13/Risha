var API_BASE = '/api';

function getToken() {
    return localStorage.getItem('authToken');
}

function getAuthHeaders() {
    const token = getToken();
    return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

// Auto-redirect to login on auth failures
const origFetch = window.fetch;
window.fetch = function() {
    return origFetch.apply(this, arguments).then(function(res) {
        if ((res.status === 401 || res.status === 403) && !res.url.includes('/auth/login')) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
        }
        return res;
    });
};

// Apply saved theme immediately (before DOMContentLoaded to avoid flash)
(function() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark-mode');
    }
}());

var isDarkMode = function() { return document.documentElement.classList.contains('dark-mode'); };

function toggleTheme() {
    var isDark = !isDarkMode();
    document.documentElement.classList.toggle('dark-mode', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    var btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerHTML = isDark ? '<span>\u{1F319}</span>' : '<span>\u{2600}\u{FE0F}</span>';
    if (btn) btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
}

function isAuthenticated() {
    return !!getToken();
}

function getUser() {
    try {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch { return null; }
}

function getUserRole() {
    const user = getUser();
    return user ? user.role : null;
}

function logout() {
    showConfirmDialog(
        'Logout',
        'Are you sure you want to logout?',
        () => {
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            localStorage.removeItem('rememberUser');
            window.location.href = 'login.html';
        },
        'Yes, Logout'
    );
}

function showConfirmDialog(title, message, onConfirm, confirmText, icon) {
    const existing = document.getElementById('confirmDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirmDialogOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card,#fff);border-radius:12px;padding:30px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp 0.25s ease;text-align:center;';

    const btnText = confirmText || 'Confirm';
    const iconEmoji = icon || '🚪';
    dialog.innerHTML = `
        <div style="font-size:48px;margin-bottom:15px;">${iconEmoji}</div>
        <h3 style="font-size:20px;color:var(--primary,#e67e22);margin-bottom:10px;font-weight:700;">${title}</h3>
        <p style="font-size:15px;color:var(--text-muted,#888);margin-bottom:25px;line-height:1.5;">${message}</p>
        <div style="display:flex;gap:12px;justify-content:center;">
            <button id="confirmCancelBtn" style="padding:12px 28px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">Cancel</button>
            <button id="confirmOkBtn" style="padding:12px 28px;border:none;border-radius:8px;background:linear-gradient(135deg,#d32f2f,#e53935);color:#fff;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">${btnText}</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const cancelBtn = dialog.querySelector('#confirmCancelBtn');
    const okBtn = dialog.querySelector('#confirmOkBtn');
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'var(--gray-100,#f5f5f5)'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'var(--bg-card,#fff)'; });
    cancelBtn.addEventListener('click', () => overlay.remove());
    okBtn.addEventListener('mouseenter', () => { okBtn.style.background = 'linear-gradient(135deg,#c62828,#d32f2f)'; });
    okBtn.addEventListener('mouseleave', () => { okBtn.style.background = 'linear-gradient(135deg,#d32f2f,#e53935)'; });
    okBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });

    const style = document.createElement('style');
    style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(style);
}

function showPromptDialog(title, message, onConfirm, confirmText, icon, inputType, defaultValue) {
    const existing = document.getElementById('confirmDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirmDialogOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card,#fff);border-radius:12px;padding:30px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp 0.25s ease;text-align:center;';

    const btnText = confirmText || 'Confirm';
    const iconEmoji = icon || '📝';
    const inputTypeAttr = inputType || 'number';
    dialog.innerHTML = `
        <div style="font-size:48px;margin-bottom:15px;">${iconEmoji}</div>
        <h3 style="font-size:20px;color:var(--primary,#e67e22);margin-bottom:10px;font-weight:700;">${title}</h3>
        <p style="font-size:15px;color:var(--text-muted,#888);margin-bottom:20px;line-height:1.5;">${message}</p>
        <input id="promptInput" type="${inputTypeAttr}" value="${defaultValue || ''}" style="width:100%;padding:12px 16px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;font-size:16px;text-align:center;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:20px;" autofocus>
        <div style="display:flex;gap:12px;justify-content:center;">
            <button id="confirmCancelBtn" style="padding:12px 28px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">Cancel</button>
            <button id="confirmOkBtn" style="padding:12px 28px;border:none;border-radius:8px;background:linear-gradient(135deg,#d32f2f,#e53935);color:#fff;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">${btnText}</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('#promptInput');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { overlay.remove(); onConfirm(input.value); } });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const cancelBtn = dialog.querySelector('#confirmCancelBtn');
    const okBtn = dialog.querySelector('#confirmOkBtn');
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'var(--gray-100,#f5f5f5)'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'var(--bg-card,#fff)'; });
    cancelBtn.addEventListener('click', () => overlay.remove());
    okBtn.addEventListener('mouseenter', () => { okBtn.style.background = 'linear-gradient(135deg,#c62828,#d32f2f)'; });
    okBtn.addEventListener('mouseleave', () => { okBtn.style.background = 'linear-gradient(135deg,#d32f2f,#e53935)'; });
    okBtn.addEventListener('click', () => { overlay.remove(); onConfirm(input.value); });

    const style = document.createElement('style');
    style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(style);
}

function applyTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark-mode');
    } else {
        document.documentElement.classList.remove('dark-mode');
    }
}

function togglePassword(event) {
    var passwordInput = document.getElementById('password');
    var toggle = event && event.currentTarget ? event.currentTarget : document.querySelector('.toggle-password');
    if (!passwordInput) return;
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (toggle) toggle.textContent = '\u{1F512}';
    } else {
        passwordInput.type = 'password';
        if (toggle) toggle.textContent = '\u{1F441}\u{FE0F}';
    }
}

function openGlobalSearch() {
    let overlay = document.getElementById('globalSearchOverlay');
    if (overlay) { overlay.classList.add('active'); document.getElementById('globalSearchInput').focus(); return; }

    overlay = document.createElement('div');
    overlay.id = 'globalSearchOverlay';
    overlay.className = 'search-overlay active';
    overlay.innerHTML = `
        <div class="search-modal">
            <div class="search-input-wrap">
                <span>\u{1F50D}</span>
                <input id="globalSearchInput" type="text" placeholder="Search products, suppliers, sales..." autofocus>
                <button class="close-btn" onclick="closeGlobalSearch()">&times;</button>
            </div>
            <div id="searchResults" class="search-results">
                <div class="search-empty">
                    <div class="search-empty-icon">\u{1F50D}</div>
                    Type to search across all modules
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGlobalSearch(); });
    document.addEventListener('keydown', searchKeydown);

    const input = document.getElementById('globalSearchInput');
    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => performSearch(input.value), 250);
    });
    input.focus();
}

function closeGlobalSearch() {
    const overlay = document.getElementById('globalSearchOverlay');
    if (overlay) overlay.classList.remove('active');
    document.removeEventListener('keydown', searchKeydown);
}

function searchKeydown(e) {
    if (e.key === 'Escape') closeGlobalSearch();
}

async function performSearch(query) {
    const resultsEl = document.getElementById('searchResults');
    if (!query || query.length < 2) {
        resultsEl.innerHTML = '<div class="search-empty"><div class="search-empty-icon">\u{1F50D}</div>Type at least 2 characters to search</div>';
        return;
    }

    try {
        const [prodRes, suppRes] = await Promise.all([
            fetch(`${API_BASE}/products`).then(r => r.json()),
            fetch(`${API_BASE}/suppliers`, { headers: getAuthHeaders() }).then(r => r.json())
        ]);

        const q = query.toLowerCase();
        const products = (prodRes.data || []).filter(p =>
            p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q)
        ).slice(0, 5);
        const suppliers = (suppRes.data || []).filter(s =>
            s.name?.toLowerCase().includes(q) || s.contact_person?.toLowerCase().includes(q)
        ).slice(0, 5);

        if (!products.length && !suppliers.length) {
            resultsEl.innerHTML = '<div class="search-empty"><div class="search-empty-icon">\u{1F50D}</div>No results found for "' + query + '"</div>';
            return;
        }

        let html = '';
        products.forEach(p => {
            html += '<div class="search-result-item" onclick="navigateTo(\'inventory.html\'); closeGlobalSearch();">'
                + '<div class="search-result-icon products">\u{1F4E6}</div>'
                + '<div class="search-result-info">'
                + '<div class="search-result-title">' + escHtml(p.name) + '</div>'
                + '<div class="search-result-sub">SKU: ' + escHtml(p.sku || 'N/A') + ' \u2022 Stock: ' + (p.stock_quantity ?? 0) + ' \u2022 \u20B1' + parseFloat(p.unit_price || 0).toFixed(2) + '</div>'
                + '</div>'
                + '<span class="search-result-link">Inventory</span>'
                + '</div>';
        });
        suppliers.forEach(s => {
            html += '<div class="search-result-item" onclick="navigateTo(\'suppliers.html\'); closeGlobalSearch();">'
                + '<div class="search-result-icon suppliers">\u{1F3ED}</div>'
                + '<div class="search-result-info">'
                + '<div class="search-result-title">' + escHtml(s.name) + '</div>'
                + '<div class="search-result-sub">Contact: ' + escHtml(s.contact_person || 'N/A') + ' \u2022 ' + escHtml(s.city || '') + '</div>'
                + '</div>'
                + '<span class="search-result-link">Suppliers</span>'
                + '</div>';
        });
        resultsEl.innerHTML = html;
    } catch (e) {
        resultsEl.innerHTML = '<div class="search-empty"><div class="search-empty-icon">\u26A0\uFE0F</div>Search unavailable</div>';
    }
}

function showToast(message, type) {
    type = type || 'info';
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = (icons[type] || 'ℹ️') + ' ' + message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function navigateTo(page) {
    window.location.href = page;
}

window.addEventListener('load', async () => {
    applyTheme();
    if (window.location.pathname.includes('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/')) {
        const rememberUser = localStorage.getItem('rememberUser');
        if (rememberUser) {
            const usernameInput = document.getElementById('username');
            if (usernameInput) { usernameInput.value = rememberUser; }
            const rememberCheck = document.getElementById('remember');
            if (rememberCheck) { rememberCheck.checked = true; }
        }
        if (isAuthenticated()) {
            try {
                const res = await fetch(`${API_BASE}/auth/verify`, { headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success) {
                    window.location.href = 'dashboard.html';
                    return;
                }
            } catch (e) {}
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
        }
    }
});

// Keyboard shortcuts help overlay
function showShortcuts() {
    let overlay = document.getElementById('shortcutsOverlay');
    if (overlay) { overlay.classList.add('active'); return; }
    overlay = document.createElement('div');
    overlay.id = 'shortcutsOverlay';
    overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:5000;align-items:center;justify-content:center;';
    overlay.className = 'modal active';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
            <div class="modal-header">
                <h2>⌨️ Keyboard Shortcuts</h2>
                <button class="close-btn" onclick="closeShortcuts()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="details-row"><span class="details-label">${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+K</span><span class="details-value">Global search</span></div>
                <div class="details-row"><span class="details-label">?</span><span class="details-value">This help overlay</span></div>
                <div class="details-row"><span class="details-label">Escape</span><span class="details-value">Close modal / search</span></div>
                <div class="details-row"><span class="details-label">F2</span><span class="details-value">Focus barcode scanner (POS)</span></div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="closeShortcuts()">Got it</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

function closeShortcuts() {
    const el = document.getElementById('shortcutsOverlay');
    if (el) el.remove();
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('login.html')) {
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const form = document.getElementById('loginForm');
                    if (form) form.dispatchEvent(new Event('submit'));
                }
            });
        }
    }

    const nameEl = document.getElementById('userName');
    const avatarEl = document.querySelector('.avatar');
    if ((nameEl || avatarEl) && !window.location.pathname.includes('login.html')) {
        const user = getUser();
        if (user && nameEl) nameEl.textContent = user.full_name || user.username || user.email;
        if (user && avatarEl) {
            const name = user.full_name || user.username || user.email;
            avatarEl.textContent = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        }
    }

    var themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.innerHTML = isDarkMode() ? '<span>\u{1F319}</span>' : '<span>\u{2600}\u{FE0F}</span>';
        themeBtn.title = isDarkMode() ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        themeBtn.addEventListener('click', toggleTheme);
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (!window.location.pathname.includes('login.html')) openGlobalSearch();
        }
        if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.target.closest('input,textarea,select')) {
            e.preventDefault();
            if (!window.location.pathname.includes('login.html')) showShortcuts();
        }
    });
});
