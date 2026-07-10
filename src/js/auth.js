var API_BASE = '/api';

function getToken() {
    return localStorage.getItem('authToken');
}

function getAuthHeaders() {
    const token = getToken();
    return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

// The auth cookie is managed by the server (HttpOnly): set on login, cleared on logout.

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

// Apply saved theme and sidebar state immediately (before DOMContentLoaded to avoid flash)
(function() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
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
        btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
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
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch { return null; }
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
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            localStorage.removeItem('rememberUser');
            // Ask the server to clear the HttpOnly auth cookie, then redirect
            fetch(API_BASE + '/auth/logout', { method: 'POST' })
                .catch(function () {})
                .finally(function () { window.location.href = 'login.html'; });
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
    const iconHtml = icon && icon.startsWith('<')
        ? icon
        : '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">warning</span>';
    dialog.innerHTML = `
        <div style="margin-bottom:15px;">${iconHtml}</div>
        <h3 style="font-size:20px;color:var(--primary,#F28B82);margin-bottom:10px;font-weight:700;">${title}</h3>
        <p style="font-size:15px;color:var(--text-muted,#888);margin-bottom:25px;line-height:1.5;">${message}</p>
        <div style="display:flex;gap:12px;justify-content:center;">
            <button id="confirmCancelBtn" style="padding:12px 28px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">Cancel</button>
            <button id="confirmOkBtn" style="padding:12px 28px;border:none;border-radius:8px;background:var(--danger,#E96A6A);color:#fff;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">${btnText}</button>
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
    okBtn.addEventListener('mouseenter', () => { okBtn.style.background = '#D98275'; });
    okBtn.addEventListener('mouseleave', () => { okBtn.style.background = 'var(--danger,#E96A6A)'; });
    okBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });

    const style = document.createElement('style');
    style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(style);
}

// Success popup shown after any confirmed action completes (reorder, save, delete…).
// Auto-dismisses after 4s; click, Enter or Escape closes it immediately.
function showSuccessDialog(title, message, opts) {
    const existing = document.getElementById('successDialogOverlay');
    if (existing) existing.remove();
    const o = opts || {};

    const overlay = document.createElement('div');
    overlay.id = 'successDialogOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(2px);z-index:10000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-card,#fff);border-radius:18px;padding:32px 34px 26px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:slideUp 0.25s ease;text-align:center;';

    const iconColor = o.tone === 'danger' ? 'var(--danger,#E5484D)' : o.tone === 'info' ? 'var(--info,#3E9BD6)' : 'var(--success,#2FA36B)';
    const iconBg = o.tone === 'danger' ? 'var(--danger-bg,rgba(229,72,77,0.12))' : o.tone === 'info' ? 'var(--info-bg,rgba(62,155,214,0.12))' : 'var(--success-bg,rgba(47,163,107,0.12))';
    const iconName = o.icon || (o.tone === 'danger' ? 'delete' : o.tone === 'info' ? 'info' : 'check');
    dialog.innerHTML = `
        <div style="width:66px;height:66px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center;margin:0 auto 16px;animation:successPop 0.45s cubic-bezier(0.34,1.56,0.64,1);">
            <span class="material-symbols-outlined" style="font-size:36px;color:${iconColor};font-variation-settings:'wght' 600;">${iconName}</span>
        </div>
        <h3 style="font-family:var(--font-display,inherit);font-size:19px;color:var(--text-primary,#1c1c1c);margin-bottom:8px;font-weight:800;letter-spacing:-0.3px;">${title}</h3>
        <p style="font-size:14px;color:var(--text-muted,#888);margin-bottom:22px;line-height:1.55;">${message}</p>
        <button id="successOkBtn" style="padding:11px 34px;border:none;border-radius:10px;background:var(--primary,#EE6A5F);color:#fff;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;box-shadow:0 4px 12px rgba(238,106,95,0.3);">Done</button>
        <div style="margin-top:14px;height:3px;border-radius:2px;background:var(--gray-100,#f0f0f0);overflow:hidden;"><div id="successTimerBar" style="height:100%;width:100%;background:${iconColor};transform-origin:left;animation:successDrain 4s linear forwards;"></div></div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

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

    if (!document.getElementById('successDialogKeyframes')) {
        const style = document.createElement('style');
        style.id = 'successDialogKeyframes';
        style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes successPop{0%{transform:scale(0.4);opacity:0}100%{transform:scale(1);opacity:1}}@keyframes successDrain{from{transform:scaleX(1)}to{transform:scaleX(0)}}';
        document.head.appendChild(style);
    }
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
    const iconHtml = icon && icon.startsWith('<')
        ? icon
        : '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">edit_note</span>';
    const inputTypeAttr = inputType || 'number';
    dialog.innerHTML = `
        <div style="margin-bottom:15px;">${iconHtml}</div>
        <h3 style="font-size:20px;color:var(--primary,#F28B82);margin-bottom:10px;font-weight:700;">${title}</h3>
        <p style="font-size:15px;color:var(--text-muted,#888);margin-bottom:20px;line-height:1.5;">${message}</p>
        <input id="promptInput" type="${inputTypeAttr}" value="${defaultValue || ''}" style="width:100%;padding:12px 16px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;font-size:16px;text-align:center;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:20px;" autofocus>
        <div style="display:flex;gap:12px;justify-content:center;">
            <button id="confirmCancelBtn" style="padding:12px 28px;border:2px solid var(--border-color,#e0e0e0);border-radius:8px;background:var(--bg-card,#fff);color:var(--text-secondary,#555);font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">Cancel</button>
            <button id="confirmOkBtn" style="padding:12px 28px;border:none;border-radius:8px;background:var(--danger,#E96A6A);color:#fff;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:all 0.2s;">${btnText}</button>
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
    okBtn.addEventListener('mouseenter', () => { okBtn.style.background = '#D98275'; });
    okBtn.addEventListener('mouseleave', () => { okBtn.style.background = 'var(--danger,#E96A6A)'; });
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
        const [prodRes, suppRes] = await Promise.all([
            fetch(`${API_BASE}/products`, { headers: getAuthHeaders() }).then(r => r.json()),
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

// ===== NOTIFICATION SYSTEM =====
let notifPollInterval = null;
let lastNotifCount = -1;

function getNotifBadge() {
    return document.getElementById('notifBadge');
}

async function refreshNotifCount() {
    if (!isAuthenticated()) return;
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
                <h2><span class="material-symbols-outlined" style="font-size:20px;">keyboard</span> Keyboard Shortcuts</h2>
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
    const avatarEl = document.querySelector('.avatar-initials');
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
        themeBtn.innerHTML = isDarkMode() ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
        themeBtn.title = isDarkMode() ? 'Switch to Light Mode' : 'Switch to Dark Mode';
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

    var helpFloatBtn = document.getElementById('helpFloatBtn');
    if (!helpFloatBtn && !window.location.pathname.includes('login.html')) {
        helpFloatBtn = document.createElement('button');
        helpFloatBtn.id = 'helpFloatBtn';
        helpFloatBtn.className = 'help-float-btn';
        helpFloatBtn.innerHTML = '<span class="material-symbols-outlined">help</span>';
        helpFloatBtn.title = 'Help Guide';
        helpFloatBtn.onclick = function() {
            const modal = document.getElementById('helpGuideModal');
            if (modal && modal.classList.contains('active')) {
                closeHelpGuide();
            } else {
                openHelpGuide();
            }
        };
        document.body.appendChild(helpFloatBtn);
    }
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
