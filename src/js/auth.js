var API_BASE = '/api';

/* Where the token lives decides how long you stay signed in.

   sessionStorage is per browser session: close the browser and it is gone, so
   the next visit asks for a password again. localStorage survives restarts,
   which is what "Remember me" means — and it is opt-in, because a shop till is
   often a shared machine and staying signed in on it by default is the wrong
   answer. Reads check both, so the rest of the app never has to care which. */
function getToken() {
    return sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
}

function setToken(token, remember, user) {
    clearToken();
    var store = remember ? localStorage : sessionStorage;
    store.setItem('authToken', token);
    if (user) store.setItem('user', typeof user === 'string' ? user : JSON.stringify(user));
    // Remembering the account also means offering the username next time.
    if (remember && user) {
        try {
            var u = typeof user === 'string' ? JSON.parse(user) : user;
            if (u && u.username) localStorage.setItem('rememberUser', u.username);
        } catch (e) {}
    } else {
        localStorage.removeItem('rememberUser');
    }
}

function clearToken() {
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('user');
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
}

function getAuthHeaders() {
    const token = getToken();
    return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

// The auth cookie is managed by the server (HttpOnly): set on login, cleared on logout.

// Auto-redirect to login when the session is invalid/expired (401 only —
// 403 means "logged in but not allowed", which must NOT end the session)
const origFetch = window.fetch;
window.fetch = function() {
    return origFetch.apply(this, arguments).then(function(res) {
        if (res.status === 401 && !res.url.includes('/auth/login')) {
            clearToken();
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
        }
        return res;
    });
};

// UI gating: only admins/managers may modify inventory, suppliers, and
// purchase orders
function canManage() {
    const role = getUserRole();
    return role === 'admin' || role === 'manager';
}

/* Which screens an account may open. This mirrors backend/utils/roles.js and
   exists only to keep the interface honest — hiding links that would bounce
   and sending each account to its own screen. The server enforces the same
   rules on every page and every API call, so editing this in the browser
   opens nothing. */
const FENCED_ROLE_PAGES = {
    cashier: ['pos.html', 'settings.html'],
    supplier: ['supplier.html', 'settings.html']
};
const SELLING_ROLES = ['cashier'];

/* What a role is called on screen. The study describes two access points,
   Administrator and Staff; the till account is the Staff one. */
const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', cashier: 'Staff', viewer: 'Viewer', supplier: 'Supplier' };
function roleLabel(role) {
    return ROLE_LABELS[role] || (role ? String(role).charAt(0).toUpperCase() + String(role).slice(1) : '');
}

function isFencedRole(role) {
    return Object.prototype.hasOwnProperty.call(FENCED_ROLE_PAGES, role || getUserRole());
}

function roleHome(role) {
    role = role || getUserRole();
    return role === 'cashier' ? 'pos.html' : role === 'supplier' ? 'supplier.html' : 'dashboard.html';
}

/** May the signed-in account open this link? Non-page links are always fine. */
function canOpenPage(href) {
    const m = /([a-z0-9-]+\.html)(?:[?#].*)?$/i.exec(String(href || ''));
    if (!m) return true;
    const page = m[1].toLowerCase();
    const role = getUserRole();
    if (isFencedRole(role)) return FENCED_ROLE_PAGES[role].includes(page);
    if (page === 'pos.html') return SELLING_ROLES.includes(role);
    if (page === 'supplier.html') return false;
    return true;
}

// Wrong screen for this account: leave before anything renders.
(function () {
    const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const open = ['', 'login.html', 'reset-password.html', 'verify-email.html'];
    if (open.includes(page) || !getToken() || !getUser()) return;
    if (canOpenPage(page)) { sessionStorage.removeItem('roleBounce'); return; }

    /* Two accounts open in two tabs share one page cookie, and it belongs to
       whichever signed in last — so the server can send this tab to the other
       account's home page. Asking the server to check this tab's own token
       re-issues the cookie for this account; only then go home. Without that
       step the two tabs' rules disagree for ever and the page ping-pongs. */
    document.documentElement.style.visibility = 'hidden';
    let bounces = [];
    try { bounces = JSON.parse(sessionStorage.getItem('roleBounce') || '[]'); } catch (e) {}
    bounces = bounces.filter(t => Date.now() - t < 10000).concat(Date.now());
    sessionStorage.setItem('roleBounce', JSON.stringify(bounces));
    if (bounces.length > 3) {
        // Something is still sending us round in circles; stop and start clean.
        sessionStorage.removeItem('roleBounce');
        clearToken();
        window.location.replace('login.html');
        return;
    }
    fetch(`${API_BASE}/auth/verify`, { headers: getAuthHeaders() })
        .catch(function () {})
        .finally(function () { window.location.replace(roleHome()); });
})();

/* Trim the interface to what this account can use: links to screens it cannot
   open disappear, and a till or supplier account loses the shop-wide extras
   (alerts bell, search palette). */
function applyRoleInterface() {
    const role = getUserRole();
    if (!role) return;
    document.querySelectorAll('a[href]').forEach(a => {
        if (!canOpenPage(a.getAttribute('href'))) a.remove();
    });
    if (!isFencedRole(role)) return;
    const nav = document.querySelector('.sidebar-nav');
    if (nav && role === 'supplier' && !nav.querySelector('a[href="supplier.html"]')) {
        const link = document.createElement('a');
        link.href = 'supplier.html';
        link.className = 'nav-link';
        link.title = 'Orders and products';
        link.innerHTML = '<span class="nav-icon material-symbols-outlined">local_shipping</span><span class="nav-label">Orders and products</span>';
        nav.prepend(link);
    }
    document.querySelectorAll('#notifBellBtn, #jumpCta, .jump-cta, #alertChip').forEach(el => el.remove());
}

// After logout, the browser's Back button can resurrect a cached copy of an
// authenticated page (back/forward cache). Re-check the session whenever a
// page is restored that way and bounce to login if it's gone.
window.addEventListener('pageshow', function (e) {
    if (e.persisted && !getToken() && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
    }
});

// Apply saved theme and sidebar state immediately (before DOMContentLoaded to avoid flash)
(function() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || ((saved === 'system' || !saved) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark-mode');
    }
    if (localStorage.getItem('sidebarHidden') === 'true') {
        document.documentElement.classList.add('sidebar-hidden');
    }
}());

var isDarkMode = function() { return document.documentElement.classList.contains('dark-mode'); };

function toggleTheme() {
    var isDark = !isDarkMode();
    document.documentElement.classList.toggle('dark-mode', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    var btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.innerHTML = isDark ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
        btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

function isSidebarHidden() {
    return document.documentElement.classList.contains('sidebar-hidden');
}

function toggleSidebarVisibility() {
    const hidden = !isSidebarHidden();
    document.documentElement.classList.toggle('sidebar-hidden', hidden);
    localStorage.setItem('sidebarHidden', hidden ? 'true' : 'false');
    const btn = document.getElementById('sidebarToggleBtn');
    if (btn) btn.innerHTML = hidden ? '<span class="material-symbols-outlined">chevron_right</span>' : '<span class="material-symbols-outlined">chevron_left</span>';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
}

// Mirrors backend/utils/passwordPolicy.js — returns null if OK, else the reason
function passwordPolicyError(pw) {
    if (typeof pw !== 'string' || pw.length < 6) return 'Must be at least 6 characters';
    if (!/[A-Z]/.test(pw)) return 'Add at least one uppercase letter (A–Z)';
    if (!/[a-z]/.test(pw)) return 'Add at least one lowercase letter (a–z)';
    if (!/[0-9]/.test(pw)) return 'Add at least one number (0–9)';
    if (!/[^A-Za-z0-9]/.test(pw)) return 'Add at least one special character (e.g. !@#$%)';
    return null;
}

function isAuthenticated() {
    return !!getToken();
}

function getUser() {
    try {
        const userStr = sessionStorage.getItem('user') || localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch { return null; }
}

// Identity avatar: an initials monogram on a deterministic gradient — the
// avatar style used by Google Workspace, Notion, Linear and Slack. Clean,
// professional, and unique per person by name-derived colour.
function hashName(name) {
    let h = 2166136261;
    for (const ch of String(name || 'User')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h;
}

// Muted, evenly-weighted tones: enough to tell two people apart at a glance
// without the avatar becoming the loudest thing on the page.
const AVATAR_COLORS = ['#4A6FA5', '#5B7A66', '#8A6A4F', '#6E5A8A', '#4F7D85', '#8A5A5A', '#5F6B7A', '#7A6F4A'];

// First letters of the first and last name; falls back to the first two
// characters of a single-word name / username.
function initialsOf(name) {
    const parts = String(name || 'User').trim().split(/\s+/).filter(Boolean);
    let ini = parts.length >= 2
        ? parts[0][0] + parts[parts.length - 1][0]
        : (parts[0] || 'U').slice(0, 2);
    return ini.toUpperCase().replace(/[<>&]/g, '');
}

function identiconURI(name) {
    const color = AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
    const ini = initialsOf(name);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
        `<rect width='100' height='100' fill='${color}'/>` +
        `<text x='50' y='50' dy='0.35em' text-anchor='middle' ` +
        `font-family='Inter, Segoe UI, system-ui, -apple-system, sans-serif' ` +
        `font-size='40' font-weight='500' fill='#ffffff'>${ini}</text>` +
        `</svg>`;
    return { uri: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, bg: color };
}

// Paint every user avatar (sidebar, hero, settings) with the identicon
function applyUserIdentity() {
    const user = getUser();
    if (!user) return;
    const name = user.full_name || user.username || user.email || 'User';
    const photo = user.avatar;
    const ic = identiconURI(name);
    document.querySelectorAll('.avatar, .settings-avatar, .hero-avatar').forEach(el => {
        if (photo) {
            el.style.backgroundImage = 'url("' + photo + '")';
            el.style.backgroundColor = '';
        } else {
            el.style.backgroundImage = ic.uri;
            el.style.backgroundColor = ic.bg;
        }
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.dataset.mascot = '1';
        const glyph = el.querySelector('.avatar-initials, .settings-avatar-initials');
        if (glyph) glyph.textContent = '';
    });
    const hero = document.getElementById('heroInitials');
    if (hero) hero.textContent = '';
}

function getUserRole() {
    const user = getUser();
    return user ? user.role : null;
}

function isViewer() {
    return getUserRole() === 'viewer';
}

function logout() {
    showConfirmDialog(
        'Logout',
        'Are you sure you want to logout?',
        () => {
            clearToken();
            localStorage.removeItem('rememberUser');
            // Ask the server to clear the HttpOnly auth cookie, then redirect
            fetch(API_BASE + '/auth/logout', { method: 'POST' })
                .catch(function () {})
                .finally(function () { window.location.href = 'login.html'; });
        },
        'Yes, Logout'
    );
}

/* ===== ONE DIALOG DESIGN =====
   Every centered popup in the app (confirm, prompt, success, error) is built
   from this shell so they all look identical: a small status icon, a plain
   title, the message, and the buttons. */

const DIALOG_TONES = {
    primary: { color: 'var(--primary)', bg: 'var(--primary-bg)' },
    success: { color: 'var(--success)', bg: 'var(--success-bg)' },
    danger: { color: 'var(--danger)', bg: 'var(--danger-bg)' },
    info: { color: 'var(--info)', bg: 'var(--info-bg)' },
    warning: { color: 'var(--warning)', bg: 'var(--warning-bg)' }
};

function buildDialogShell(overlayId, tone, iconName, title, message) {
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();
    const t = DIALOG_TONES[tone] || DIALOG_TONES.primary;

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'app-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'app-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <div class="app-dialog-main">
            <div class="app-dialog-icon" style="background:${t.bg};color:${t.color};">
                <span class="material-symbols-outlined">${iconName}</span>
            </div>
            <div style="min-width:0;">
                <h3>${title}</h3>
                <p>${message}</p>
            </div>
        </div>
        <div class="dialog-body"></div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    return { overlay, dialog, tone: t };
}

/* Dialog buttons are the system's own buttons, so a "Confirm" here looks and
   presses exactly like a button anywhere else. */
function dialogActions(cancelLabel, okLabel, okClass, okId) {
    return `<div class="app-dialog-actions">
        ${cancelLabel ? `<button type="button" id="confirmCancelBtn" class="btn-secondary">${cancelLabel}</button>` : ''}
        <button type="button" id="${okId || 'confirmOkBtn'}" class="${okClass || 'btn-primary'}">${okLabel}</button>
    </div>`;
}

/** For values placed inside an HTML attribute. */
function escAttr(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Legacy call sites pass raw icon HTML — recover the icon name and tone from it
function parseLegacyIcon(icon, fallbackIcon) {
    let name = fallbackIcon, tone = 'primary';
    if (typeof icon === 'string' && icon.startsWith('<')) {
        const m = icon.match(/>\s*([a-z_0-9]+)\s*</);
        if (m) name = m[1];
        if (icon.includes('--danger')) tone = 'danger';
        else if (icon.includes('--warning')) tone = 'warning';
    }
    return { name, tone };
}

function showConfirmDialog(title, message, onConfirm, confirmText, icon) {
    const { name, tone } = parseLegacyIcon(icon, 'help');
    const { overlay, dialog } = buildDialogShell('confirmDialogOverlay', tone, name, title, message);
    const body = dialog.querySelector('.dialog-body');
    body.insertAdjacentHTML('afterend', dialogActions('Cancel', confirmText || 'Confirm', tone === 'danger' ? 'btn-danger' : 'btn-primary'));

    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    dialog.querySelector('#confirmCancelBtn').addEventListener('click', close);
    const ok = dialog.querySelector('#confirmOkBtn');
    ok.addEventListener('click', () => { close(); onConfirm(); });
    setTimeout(() => ok.focus(), 30);
}

function showPromptDialog(title, message, onConfirm, confirmText, icon, inputType, defaultValue) {
    const { name, tone } = parseLegacyIcon(icon, 'edit_note');
    const { overlay, dialog } = buildDialogShell('confirmDialogOverlay', tone, name, title, message);
    const body = dialog.querySelector('.dialog-body');
    body.innerHTML = `<input id="promptInput" class="form-input" type="${escAttr(inputType || 'number')}" value="${escAttr(defaultValue)}">`;
    body.insertAdjacentHTML('afterend', dialogActions('Cancel', confirmText || 'Confirm', 'btn-primary'));

    const input = dialog.querySelector('#promptInput');
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { close(); onConfirm(input.value); } });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    dialog.querySelector('#confirmCancelBtn').addEventListener('click', close);
    dialog.querySelector('#confirmOkBtn').addEventListener('click', () => { close(); onConfirm(input.value); });
    setTimeout(() => input.focus(), 50);
}

// Success/info/error popup shown after an action completes (or fails validation).
// Auto-dismisses after 4s; click, Enter or Escape closes it immediately.
function showSuccessDialog(title, message, opts) {
    const o = opts || {};
    const tone = o.tone || 'success';
    const iconName = o.icon || (tone === 'danger' ? 'delete' : tone === 'info' ? 'info' : 'check');
    const { overlay, dialog, tone: t } = buildDialogShell('successDialogOverlay', tone, iconName, title, message);
    dialog.querySelector('.dialog-body').insertAdjacentHTML('afterend', dialogActions('', o.button || 'Done', 'btn-primary', 'successOkBtn'));

    const close = () => {
        clearTimeout(timer);
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        if (typeof o.onClose === 'function') o.onClose();
    };
    const timer = setTimeout(close, 4000);
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    dialog.querySelector('#successOkBtn').addEventListener('click', close);
}

// Validation/error popup — same design, red tone, OK button
function showErrorDialog(title, message, opts) {
    showSuccessDialog(title, message, Object.assign({ tone: 'danger', icon: 'error', button: 'OK' }, opts || {}));
}

function applyTheme() {
    // The login page is always light-themed
    if (window.location.pathname.includes('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/')) {
        document.documentElement.classList.remove('dark-mode');
        return;
    }
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || ((saved === 'system' || !saved) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark-mode');
    } else {
        document.documentElement.classList.remove('dark-mode');
    }
}

// When following the device theme, react live to OS light/dark changes.
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        var t = localStorage.getItem('theme');
        if (t === 'system' || !t) applyTheme();
    });
}

function togglePassword(event) {
    var passwordInput = document.getElementById('password');
    var toggle = event && event.currentTarget ? event.currentTarget : document.querySelector('.toggle-password');
    if (!passwordInput) return;
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (toggle) toggle.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">visibility_off</span>';
    } else {
        passwordInput.type = 'password';
        if (toggle) toggle.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">visibility</span>';
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
                <span class="material-symbols-outlined" style="font-size:20px;">search</span>
                <input id="globalSearchInput" type="text" placeholder="Search products, suppliers, sales..." autofocus>
                <button class="close-btn" onclick="closeGlobalSearch()">&times;</button>
            </div>
            <div id="searchResults" class="search-results">
                <div class="search-empty">
                    <div class="search-empty-icon"><span class="material-symbols-outlined" style="font-size:40px;">search</span></div>
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
        resultsEl.innerHTML = '<div class="search-empty"><div class="search-empty-icon"><span class="material-symbols-outlined" style="font-size:40px;">search</span></div>Type at least 2 characters to search</div>';
        return;
    }

    try {
        // Products are searched on the server (paged, no images); suppliers
        // are a small table so client-side filtering is fine.
        const [prodRes, suppRes] = await Promise.all([
            fetch(`${API_BASE}/products?search=${encodeURIComponent(query)}&limit=5&fields=light`, { headers: getAuthHeaders() }).then(r => r.json()),
            fetch(`${API_BASE}/suppliers`, { headers: getAuthHeaders() }).then(r => r.json())
        ]);

        const q = query.toLowerCase();
        const products = prodRes.data || [];
        const suppliers = (suppRes.data || []).filter(s =>
            s.name?.toLowerCase().includes(q) || s.contact_person?.toLowerCase().includes(q)
        ).slice(0, 5);

        if (!products.length && !suppliers.length) {
            resultsEl.innerHTML = '<div class="search-empty"><div class="search-empty-icon"><span class="material-symbols-outlined" style="font-size:40px;">search</span></div>No results found for "' + escHtml(query) + '"</div>';
            return;
        }

        let html = '';
        products.forEach(p => {
            html += '<div class="search-result-item" onclick="navigateTo(\'inventory.html\'); closeGlobalSearch();">'
                + '<div class="search-result-icon products"><span class="material-symbols-outlined" style="font-size:16px;">inventory_2</span></div>'
                + '<div class="search-result-info">'
                + '<div class="search-result-title">' + escHtml(p.name) + '</div>'
                + '<div class="search-result-sub">SKU: ' + escHtml(p.sku || 'N/A') + ' \u2022 Stock: ' + formatNumber(p.stock_quantity ?? 0) + ' \u2022 ' + formatCurrency(p.unit_price || 0) + '</div>'
                + '</div>'
                + '<span class="search-result-link">Inventory</span>'
                + '</div>';
        });
        suppliers.forEach(s => {
            html += '<div class="search-result-item" onclick="navigateTo(\'suppliers.html\'); closeGlobalSearch();">'
                + '<div class="search-result-icon suppliers"><span class="material-symbols-outlined" style="font-size:16px;">local_shipping</span></div>'
                + '<div class="search-result-info">'
                + '<div class="search-result-title">' + escHtml(s.name) + '</div>'
                + '<div class="search-result-sub">Contact: ' + escHtml(s.contact_person || 'N/A') + ' \u2022 ' + escHtml(s.city || '') + '</div>'
                + '</div>'
                + '<span class="search-result-link">Suppliers</span>'
                + '</div>';
        });
        resultsEl.innerHTML = html;
    } catch (e) {
        resultsEl.innerHTML = '<div class="search-empty"><div class="search-empty-icon"><span class="material-symbols-outlined" style="font-size:40px;">warning</span></div>Search unavailable</div>';
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
    const icons = {
        success: '<span class="material-symbols-outlined" style="font-size:16px;">check_circle</span>',
        error: '<span class="material-symbols-outlined" style="font-size:16px;">error</span>',
        warning: '<span class="material-symbols-outlined" style="font-size:16px;">warning_amber</span>',
        info: '<span class="material-symbols-outlined" style="font-size:16px;">info</span>'
    };
    toast.innerHTML = (icons[type] || icons.info) + ' ' + escHtml(message);
    container.appendChild(toast);
    // Never a stack: a burst of actions (scanning several items) shows the
    // latest few, not a column of messages down the screen.
    while (container.children.length > 3) container.firstElementChild.remove();
    // Long enough to read, short enough to be gone before the next action.
    // Problems stay a little longer than confirmations.
    setTimeout(() => toast.remove(), type === 'error' || type === 'warning' ? 4000 : 2200);
}

/* Kept in step with the copy in utils.js. Both exist because analytics.html and
   audit.html load auth.js without utils.js, and auth.js loads second everywhere
   else — so whichever page you are on, this is the definition that wins.

   The textContent/innerHTML trick this used to use escapes < > and &, but NOT
   quotes, which is silently wrong for the call sites that interpolate into an
   attribute (title="${escHtml(name)}"). Escape quotes too. */
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===== NOTIFICATION SYSTEM =====
let notifPollInterval = null;
let lastNotifCount = -1;

function getNotifBadge() {
    return document.getElementById('notifBadge');
}

async function refreshNotifCount() {
    if (!isAuthenticated() || isFencedRole()) return;
    try {
        const res = await fetch(`${API_BASE}/notifications/count`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success) {
            const count = data.data.count;
            const badge = getNotifBadge();
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'flex' : 'none';
                if (count > 0) badge.classList.add('has-alerts');
                else badge.classList.remove('has-alerts');
            }
            if (lastNotifCount !== -1 && count > lastNotifCount && Notification.permission === 'granted') {
                new Notification('RISHA — New Notification', {
                    body: `You have ${count} unread notification(s)`,
                    icon: '/images/logo.jpeg'
                });
            }
            lastNotifCount = count;
        }
    } catch (e) {
        // silent
    }
}

function startNotifPolling() {
    stopNotifPolling();
    refreshNotifCount();
    notifPollInterval = setInterval(refreshNotifCount, 15000);
}

function stopNotifPolling() {
    if (notifPollInterval) {
        clearInterval(notifPollInterval);
        notifPollInterval = null;
    }
}

async function openNotifDropdown() {
    const existing = document.getElementById('notifDropdown');
    if (existing) {
        existing.remove();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/notifications?limit=15`, { headers: getAuthHeaders() });
        const data = await res.json();
        const notifs = data.data || [];

        const dropdown = document.createElement('div');
        dropdown.id = 'notifDropdown';
        dropdown.className = 'notif-dropdown';
        dropdown.innerHTML = `
            <div class="notif-dropdown-header">
                <span>Notifications</span>
                <div class="notif-dropdown-actions">
                    <button onclick="markAllNotifRead()" title="Mark all read"><span class="material-symbols-outlined" style="font-size:16px;">check</span> All</button>
                    <button onclick="closeNotifDropdown()" title="Close"><span class="material-symbols-outlined" style="font-size:16px;">close</span></button>
                </div>
            </div>
            <div class="notif-dropdown-body">
                ${notifs.length === 0 ? '<div class="notif-empty">No notifications yet</div>' :
                    notifs.map(n => `
                        <div class="notif-item ${n.is_read ? 'read' : 'unread'}" onclick="markNotifRead(${n.id})">
                            <span class="notif-read-indicator">${n.is_read ? '' : '●'}</span>
                            <div class="notif-icon ${n.type}">${getNotifIcon(n.type)}</div>
                            <div class="notif-content">
                                <div class="notif-title">${escHtml(n.title)}</div>
                                <div class="notif-msg">${escHtml(n.message)}</div>
                                <div class="notif-time">${formatNotifTime(n.created_at)}</div>
                            </div>
                        </div>
                    `).join('')}
            </div>
            <div class="notif-dropdown-footer">
                <a href="notifications.html" onclick="closeNotifDropdown()">View all notifications →</a>
            </div>
        `;
        document.body.appendChild(dropdown);

        setTimeout(() => {
            document.addEventListener('click', closeNotifOutside, { once: true });
        }, 10);
    } catch (e) {
        showToast('Failed to load notifications', 'error');
    }
}

function closeNotifDropdown() {
    const el = document.getElementById('notifDropdown');
    if (el) el.remove();
}

function closeNotifOutside(e) {
    const dd = document.getElementById('notifDropdown');
    const btn = document.getElementById('notifBellBtn');
    if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
        dd.remove();
    }
}

async function markNotifRead(id) {
    try {
        await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'PUT', headers: getAuthHeaders() });
        refreshNotifCount();
        const dd = document.getElementById('notifDropdown');
        if (dd) {
            closeNotifDropdown();
            openNotifDropdown();
        }
    } catch (e) {}
}

async function markAllNotifRead() {
    try {
        await fetch(`${API_BASE}/notifications/read-all`, { method: 'PUT', headers: getAuthHeaders() });
        refreshNotifCount();
        closeNotifDropdown();
        showToast('All notifications marked as read', 'success');
    } catch (e) {
        showToast('Failed to mark all as read', 'error');
    }
}

function getNotifIcon(type) {
    const icons = {
        low_stock: '<span class="material-symbols-outlined" style="font-size:16px;">inventory_2</span>',
        stockout: '<span class="material-symbols-outlined" style="font-size:16px;">block</span>',
        expiration: '<span class="material-symbols-outlined" style="font-size:16px;">schedule</span>',
        overstock: '<span class="material-symbols-outlined" style="font-size:16px;">inventory</span>',
        reorder: '<span class="material-symbols-outlined" style="font-size:16px;">assignment</span>',
        info: '<span class="material-symbols-outlined" style="font-size:16px;">info</span>',
        warning: '<span class="material-symbols-outlined" style="font-size:16px;">warning_amber</span>',
        critical: '<span class="material-symbols-outlined" style="font-size:16px;">error</span>'
    };
    return icons[type] || '<span class="material-symbols-outlined" style="font-size:16px;">info</span>';
}

function formatNotifTime(t) {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
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
            // the box is called rememberMe; looking for "remember" meant it never came back ticked
            const rememberCheck = document.getElementById('rememberMe');
            if (rememberCheck) { rememberCheck.checked = true; }
        }
        if (isAuthenticated()) {
            try {
                const res = await fetch(`${API_BASE}/auth/verify`, { headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success) {
                    window.location.href = roleHome(data.user && data.user.role);
                    return;
                }
            } catch (e) {}
            clearToken();
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
                <h2><span class="material-symbols-outlined" style="font-size:20px;">keyboard</span> Keyboard shortcuts</h2>
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
    const roleEl = document.getElementById('sidebarUserRole');
    const avatarEl = document.querySelector('.avatar-initials');
    if ((nameEl || avatarEl) && !window.location.pathname.includes('login.html')) {
        const user = getUser();
        if (user && nameEl) nameEl.textContent = user.full_name || user.username || user.email;
        // Without this the sidebar keeps its "Staff" placeholder for everyone,
        // including admins. Never share this id with the role picker on
        // users.html — getElementById would hand the form the wrong element.
        if (user && roleEl && user.role) roleEl.textContent = roleLabel(user.role);
        applyUserIdentity();
        applyRoleInterface();
    }

    var themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        themeBtn.innerHTML = isDarkMode() ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
        themeBtn.title = isDarkMode() ? 'Switch to light mode' : 'Switch to dark mode';
        themeBtn.addEventListener('click', toggleTheme);
    }

    var sidebarBtn = document.getElementById('sidebarToggleBtn');
    if (sidebarBtn) {
        sidebarBtn.innerHTML = isSidebarHidden() ? '<span class="material-symbols-outlined">chevron_right</span>' : '<span class="material-symbols-outlined">chevron_left</span>';
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

    if (!window.location.pathname.includes('login.html')) {
        startNotifPolling();
        requestNotifPermission();
    }

    // Help is now merged into the FETCH Assistant (single floating helper).
    // The old standalone "?" button is retired; the assistant answers help
    // questions and can still open the full formatted guide on request.
    var oldHelpBtn = document.getElementById('helpFloatBtn');
    if (oldHelpBtn) oldHelpBtn.remove();
});

function openHelpGuide() {
    const modal = document.getElementById('helpGuideModal');
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('help-guide-open');
    }
}

function closeHelpGuide() {
    const modal = document.getElementById('helpGuideModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('help-guide-open');
    }
}

document.addEventListener('click', function(e) {
    const modal = document.getElementById('helpGuideModal');
    const floatBtn = document.getElementById('helpFloatBtn');
    if (modal && modal.classList.contains('active') && !modal.contains(e.target) && floatBtn && !floatBtn.contains(e.target)) {
        closeHelpGuide();
    }
});
