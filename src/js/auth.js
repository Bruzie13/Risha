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
    if (page === 'users.html') return role === 'admin';   // every action on it is the administrator's
    return true;
}

// Wrong screen for this account: leave before anything renders.
(function () {
    const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const open = ['', 'login.html', 'reset-password.html', 'verify-email.html'];
    if (open.includes(page) || !getToken() || !getUser()) return;
    if (canOpenPage(page)) { sessionStorage.removeItem('roleBounce'); sessionStorage.removeItem('navIntent'); return; }

    /* Two accounts open in two tabs share one page cookie, and it belongs to
       whichever signed in last — so the server can send this tab to the other
       account's home page. Asking the server to check this tab's own token
       re-issues the cookie for this account; only then carry on to the page
       the click was heading for (or home, when there was no such click).
       Without that step the two tabs' rules disagree for ever and the page
       ping-pongs. */
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
        .finally(function () {
            let target = roleHome();
            try {
                const intent = JSON.parse(sessionStorage.getItem('navIntent') || 'null');
                // only ever one of our own pages, and only one this account may open
                if (intent && typeof intent.href === 'string' && /^[a-z0-9_-]+\.html([?#].*)?$/i.test(intent.href)
                    && Date.now() - intent.t < 15000 && canOpenPage(intent.href)) target = intent.href;
            } catch (e) {}
            // used once: if it bounces again, the next stop is home
            sessionStorage.removeItem('navIntent');
            window.location.replace(target);
        });
})();

/* Where this tab was heading when a link to another screen was clicked. If
   the server sends the tab somewhere else because the page cookie belongs to
   another account (above), it can still arrive once the cookie is its own. */
document.addEventListener('click', function (e) {
    const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    const href = link ? (link.getAttribute('href') || '') : '';
    if (!/^[a-z0-9_-]+\.html([?#].*)?$/i.test(href)) return;
    try { sessionStorage.setItem('navIntent', JSON.stringify({ href: href, t: Date.now() })); } catch (err) {}
}, true);

/* The page cookie is one per browser; the session is one per tab. Whenever
   this tab is the one being looked at, make the cookie this tab's, so the
   next click is judged as this account and not as whoever signed in last in
   another tab. /auth/verify re-issues the cookie only when it differs. */
(function () {
    let last = 0;
    function claimPageCookie() {
        if (document.hidden || !getToken()) return;
        const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
        if (['', 'login.html', 'reset-password.html', 'verify-email.html'].includes(page)) return;
        if (Date.now() - last < 3000) return;
        last = Date.now();
        fetch(`${API_BASE}/auth/verify`, { headers: getAuthHeaders() }).catch(function () {});
    }
    document.addEventListener('visibilitychange', claimPageCookie);
    window.addEventListener('focus', claimPageCookie);
    window.addEventListener('pageshow', function (e) { if (e.persisted) claimPageCookie(); });
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
    /* Controls this account cannot use are taken off the screen instead of
       being left to refuse when pressed. The mark is data-needs="manage"
       (administrator or manager) or data-needs="admin". Hidden, not removed:
       the page's own script may still look the element up. The server refuses
       the action itself either way. */
    if (!canManage()) document.querySelectorAll('[data-needs="manage"]').forEach(el => el.classList.add('role-hidden'));
    if (role !== 'admin') document.querySelectorAll('[data-needs="admin"]').forEach(el => el.classList.add('role-hidden'));
    if (!isFencedRole(role)) return;
    const nav = document.querySelector('.sidebar-nav');
    if (nav && role === 'supplier' && !nav.querySelector('a[href="supplier.html"]')) {
        const link = document.createElement('a');
        link.href = 'supplier.html';
        link.className = 'nav-link rail-icon-only';
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

/* The sidebar's top button: an arrow to fold it away, and once it is folded,
   the Risha logo, which opens it again. */
function paintSidebarToggle(hidden) {
    const btn = document.getElementById('sidebarToggleBtn');
    if (!btn) return;
    btn.innerHTML = hidden
        ? '<img class="sidebar-toggle-logo" src="images/logo.jpeg" alt="">'
        : '<span class="material-symbols-outlined">chevron_left</span>';
    btn.title = hidden ? 'Show the menu' : 'Collapse sidebar';
    btn.setAttribute('aria-label', btn.title);
    // on the slim strip the logo itself is the button, so it says which way it goes
    const logo = document.querySelector('.sidebar-brand .brand-icon.is-sidebar-toggle');
    if (logo) { logo.title = hidden ? 'Show the menu' : 'Hide the menu'; logo.setAttribute('aria-label', logo.title); }
}

function toggleSidebarVisibility() {
    const hidden = !isSidebarHidden();
    document.documentElement.classList.toggle('sidebar-hidden', hidden);
    // the till and supplier pages (slim strip) keep their own choice
    if (document.documentElement.classList.contains('rail-only')) localStorage.setItem('railOpen', hidden ? 'false' : 'true');
    else localStorage.setItem('sidebarHidden', hidden ? 'true' : 'false');
    paintSidebarToggle(hidden);
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

/* Save changed account details (name, photo) back to wherever this session
   lives. A session that is not "kept signed in" is in sessionStorage; writing
   to localStorage instead left the screen showing the old details, and left a
   copy of them behind after the browser closed. */
function setUser(user) {
    const store = sessionStorage.getItem('authToken') ? sessionStorage : localStorage;
    store.setItem('user', JSON.stringify(user));
}

// Default avatar, for an account without a photo: the person's initials on one
// plain dark disc, the same for everyone — light letters on charcoal, turned
// round in dark mode (--avatar-bg and --avatar-ink in global.css). No colour
// per person: the name beside it says who is signed in.

// First letters of the first and last name; falls back to the first two
// characters of a single-word name / username.
function initialsOf(name) {
    const parts = String(name || 'User').trim().split(/\s+/).filter(Boolean);
    const ini = parts.length >= 2
        ? parts[0][0] + parts[parts.length - 1][0]
        : (parts[0] || 'U').slice(0, 2);
    return ini.toUpperCase();
}

// Paint every user avatar (sidebar, hero, settings): their photo, or their initials
function applyUserIdentity() {
    const user = getUser();
    if (!user) return;
    const photo = user.avatar;
    const initials = photo ? '' : initialsOf(user.full_name || user.username || user.email);
    document.querySelectorAll('.avatar, .settings-avatar, .hero-avatar').forEach(el => {
        if (photo) {
            el.style.backgroundImage = 'url("' + photo + '")';
            el.style.backgroundColor = '';
            el.style.color = '';
        } else {
            el.style.backgroundImage = 'none';
            el.style.backgroundColor = 'var(--avatar-bg)';
            el.style.color = 'var(--avatar-ink)';
        }
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.dataset.mascot = '1';
        const glyph = el.querySelector('.avatar-initials, .settings-avatar-initials');
        if (glyph) { glyph.textContent = initials; glyph.style.color = 'inherit'; }
    });
    const hero = document.getElementById('heroInitials');
    if (hero) hero.textContent = initials;
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
            // the paw box says so at once and stays until the sign-in page is up;
            // signing out is quick, so it stays at least half a second to be read
            if (window.flLoader) window.flLoader.hold('Signing out…');
            const shown = Date.now();
            clearToken();
            localStorage.removeItem('rememberUser');
            // Ask the server to clear the HttpOnly auth cookie, then redirect
            fetch(API_BASE + '/auth/logout', { method: 'POST' })
                .catch(function () {})
                .finally(function () {
                    setTimeout(function () { window.location.href = 'login.html'; }, Math.max(0, 500 - (Date.now() - shown)));
                });
        },
        'Log out'
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

/* Today as YYYY-MM-DD on this device's clock, which in the shop is the shop's day. */
function localTodayYmd() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* The largest picture that may be picked (backend/utils/image.js has the
   same limit). The page shrinks it before sending, so what is saved is small. */
const MAX_IMAGE_MB = 10;

/* What is wrong with the picture file chosen, or null. */
function imageFileProblem(file) {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return 'Choose a PNG, JPG, WEBP or GIF picture.';
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        return `This picture is ${(file.size / 1024 / 1024).toFixed(1)} MB. Choose one of ${MAX_IMAGE_MB} MB or less.`;
    }
    return null;
}

/* What is wrong with the cash counted as typed, or null (backend/utils/till.js
   has the same rule). The box is plain text, so "+20" or "20abc" reach this
   check instead of being read as 20 or quietly emptied by a number box. */
function countedCashProblem(text) {
    const t = String(text || '').trim();
    if (!t) return 'Enter the cash counted in the drawer.';
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'Type the cash counted as a number only, like 1500 or 1500.50: no + or - signs, no letters, and at most 2 decimals.';
    if (Number(t) > 1000000) return 'That amount is too large (₱1,000,000 at most).';
    return null;
}

/* A person's full name: letters, spaces and . ' - only, no numbers
   (backend/utils/accounts.js has the same rule). `before` is the name already
   saved, which may stay as it is. */
function fullNameProblem(value, before) {
    const v = String(value || '').trim().replace(/\s+/g, ' ');
    if (!v) return 'Enter the full name.';
    if (before != null && v === String(before).trim().replace(/\s+/g, ' ')) return null;
    if (v.length < 2) return 'The full name is too short: use at least 2 characters.';
    if (!/^[\p{L}\p{M} .'-]+$/u.test(v) || !/\p{L}/u.test(v)) return "The full name can use letters, spaces and . ' - only, with no numbers.";
    return null;
}

/* Shows the problem under a money box (in its .field-error) and marks the box. */
function showFieldProblem(box, problem) {
    const err = document.getElementById(box.id + 'Error');
    if (err) err.textContent = problem || '';
    box.classList.toggle('input-invalid', !!problem);
}

/* Stock that is being added needs at least a week left before it expires
   (backend/utils/expiry.js has the same rule). */
const MIN_SHELF_DAYS = 7;

/* The first expiration date that may be saved, as YYYY-MM-DD. */
function earliestExpiryYmd() {
    const d = new Date();
    d.setDate(d.getDate() + MIN_SHELF_DAYS);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* What is wrong with the expiration date typed, or null. */
function expiryDateProblem(value) {
    if (!value) return null;
    const earliest = earliestExpiryYmd();
    if (value >= earliest) return null;
    const shown = new Date(earliest + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `The expiration date must be at least ${MIN_SHELF_DAYS} days from today: ${shown} or later.`;
}

/* opts.min sets the earliest value the box offers. opts.validate(value) may
   return a message: the question then stays open and shows it, instead of
   closing and leaving the person to start again. */
function showPromptDialog(title, message, onConfirm, confirmText, icon, inputType, defaultValue, opts) {
    const o = opts || {};
    const { name, tone } = parseLegacyIcon(icon, 'edit_note');
    const { overlay, dialog } = buildDialogShell('confirmDialogOverlay', tone, name, title, message);
    const body = dialog.querySelector('.dialog-body');
    body.innerHTML = `<input id="promptInput" class="form-input" type="${escAttr(inputType || 'number')}" value="${escAttr(defaultValue)}"${o.min ? ` min="${escAttr(o.min)}"` : ''}${o.maxLength ? ` maxlength="${escAttr(o.maxLength)}"` : ''}${o.placeholder ? ` placeholder="${escAttr(o.placeholder)}"` : ''}>
        <div id="promptError" role="alert" style="display:none;margin-top:8px;font-size:13px;font-weight:600;color:var(--danger);"></div>`;
    body.insertAdjacentHTML('afterend', dialogActions('Cancel', confirmText || 'Confirm', 'btn-primary'));

    const input = dialog.querySelector('#promptInput');
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const submit = () => {
        const problem = typeof o.validate === 'function' ? o.validate(input.value) : null;
        if (problem) {
            const err = dialog.querySelector('#promptError');
            err.textContent = problem;
            err.style.display = 'block';
            input.focus();
            return;
        }
        close();
        onConfirm(input.value);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    // a message about what was typed before goes once the box is changed
    input.addEventListener('input', () => { dialog.querySelector('#promptError').style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    dialog.querySelector('#confirmCancelBtn').addEventListener('click', close);
    dialog.querySelector('#confirmOkBtn').addEventListener('click', submit);
    setTimeout(() => input.focus(), 50);
}

// Success/info/error popup shown after an action completes (or fails validation).
// Auto-dismisses after 4s (unless opts.stay); click, Enter or Escape closes it immediately.
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
    // opts.stay: there is something to read (a list of what was left out), so it waits to be closed;
    // otherwise it closes by itself after 5 seconds, with the line around it counting down
    // a window with something to choose in it (a link or a button in its text) waits too
    const stay = o.stay || /<(button|a)\b/i.test(String(message || ''));
    const timer = stay ? null : setTimeout(close, TOAST_MS);
    if (!stay) addCountdownRing(dialog, TOAST_MS, t.color);
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
                <input id="globalSearchInput" type="text" maxlength="100" placeholder="Search products, suppliers, sales..." autofocus>
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

/* Small messages share one column at the top right: the answer to a button
   you pressed (showToast) first, new alerts that arrived by themselves under
   it. Bigger results open as a window in the middle (showSuccessDialog).
   (Carlo, 30 Oct.) */
function cornerStack() {
    let corner = document.getElementById('cornerStack');
    if (!corner) {
        corner = document.createElement('div');
        corner.id = 'cornerStack';
        corner.className = 'corner-stack';
        document.body.appendChild(corner);
    }
    return corner;
}

/* The answer to something you pressed ("Saved", "Not saved: …"): a small card
   at the top right, the same look as a new alert (Carlo, 30 Oct). It never
   blocks the page: clicks go through it to what is underneath, and only its ×
   is a button. It closes by itself after 5 seconds, with a line
   around its edge counting down; a burst of them (scanning items) shows the
   latest three. */
const TOAST_TONES = {
    success: { icon: 'check_circle', color: 'var(--success)' },
    error: { icon: 'error', color: 'var(--danger)' },
    warning: { icon: 'warning', color: 'var(--warning)' },
    info: { icon: 'info', color: 'var(--primary)' }
};
function showToast(message, type) {
    const tone = TOAST_TONES[type] || TOAST_TONES.info;
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'center-note-stack';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        cornerStack().prepend(container);
    }
    const note = document.createElement('div');
    note.className = 'alert-pop center-note center-note-' + (TOAST_TONES[type] ? type : 'info');
    note.innerHTML = `<div class="center-note-icon"><span class="material-symbols-outlined">${tone.icon}</span></div>
        <div class="alert-pop-body"><div class="center-note-text">${escHtml(message)}</div></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'alert-pop-close';
    close.title = 'Close';
    close.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">close</span>';
    close.addEventListener('click', () => note.remove());
    note.appendChild(close);
    container.appendChild(note);
    while (container.children.length > 3) container.firstElementChild.remove();
    addCountdownRing(note, TOAST_MS, tone.color);
    setTimeout(() => note.remove(), TOAST_MS);
}
const TOAST_MS = 5000;

/* A line around the edge of `el` that runs down over `ms`: how long a
   message or a window that closes by itself has left. `color` is the line's
   colour (white on a coloured message, the tone's colour on a white window). */
function addCountdownRing(el, ms, color) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ns = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(ns, 'svg');
    ring.setAttribute('class', 'countdown-ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    const edge = document.createElementNS(ns, 'rect');
    const inset = 1.5;
    edge.setAttribute('x', inset); edge.setAttribute('y', inset);
    edge.setAttribute('width', Math.max(0, r.width - inset * 2));
    edge.setAttribute('height', Math.max(0, r.height - inset * 2));
    edge.setAttribute('rx', Math.max(0, Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8, r.height / 2) - inset));
    edge.setAttribute('pathLength', '100');
    edge.style.animationDuration = ms + 'ms';
    if (color) edge.style.stroke = color;
    ring.appendChild(edge);
    el.appendChild(ring);
}

/* Kept in step with the copy in utils.js. auth.js loads after it on every
   page, so whichever page you are on, this is the definition that wins.

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
            // the Dashboard's alerts chip shows the same number as the bell
            const chipCount = document.getElementById('alertCount');
            if (chipCount) chipCount.textContent = count;
            const chip = document.getElementById('alertChip');
            if (chip) chip.classList.toggle('has-alerts', count > 0);
            // a new page, or more unread than last time: say what came in
            if (lastNotifCount === -1 || count > lastNotifCount) announceNewAlerts();
            lastNotifCount = count;
        }
    } catch (e) {
        // silent
    }
}

/* A new alert pops up at the top right with what it says, not just a bigger
   number on the bell. The newest alert already shown is kept for the tab
   (alertsShownUpTo), so moving between pages never repeats one; the first
   page after signing in shows the newest unread ones. The till skips this:
   a card over the checkout would get in the way of a sale. */
const ALERT_POP_MAX = 3;
const ALERT_POP_MS = 8000;

async function announceNewAlerts() {
    if (window.location.pathname.includes('pos.html')) return;
    try {
        const res = await fetch(`${API_BASE}/notifications?status=unread&limit=20`, { headers: getAuthHeaders() });
        const data = await res.json();
        const unread = (data && data.data) || [];
        if (!unread.length) return;
        let shownUpTo = null;
        try { shownUpTo = sessionStorage.getItem('alertsShownUpTo'); } catch (e) {}
        const fresh = unread.filter(n => shownUpTo === null || n.id > Number(shownUpTo));
        try { sessionStorage.setItem('alertsShownUpTo', String(Math.max(...unread.map(n => n.id), Number(shownUpTo) || 0))); } catch (e) {}
        if (!fresh.length) return;
        fresh.slice(0, ALERT_POP_MAX).forEach(showAlertPop);
        const more = fresh.length - ALERT_POP_MAX;
        if (more > 0) showAlertPop({ more });
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification(fresh[0].title, { body: fresh[0].message, icon: '/images/logo.jpeg' });
        }
    } catch (e) {
        // silent: the bell still shows the count
    }
}

function showAlertPop(n) {
    let stack = document.getElementById('alertPopStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'alertPopStack';
        stack.className = 'alert-pop-stack';
        stack.setAttribute('role', 'status');
        stack.setAttribute('aria-live', 'polite');
        cornerStack().appendChild(stack);
    }
    const pop = document.createElement('div');
    pop.className = 'alert-pop';
    pop.title = 'Show the alerts';
    pop.innerHTML = n.more
        ? `<div class="alert-pop-body"><div class="notif-title">${n.more} more new ${n.more === 1 ? 'alert' : 'alerts'}</div>
               <div class="notif-msg">Open the list to see them all</div></div>`
        : `<div class="notif-icon ${escHtml(n.type)}">${getNotifIcon(n.type)}</div>
           <div class="alert-pop-body"><div class="notif-title">${escHtml(n.title)}</div>
               <div class="notif-msg">${escHtml(n.message)}</div></div>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'alert-pop-close';
    close.title = 'Close';
    close.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">close</span>';
    close.addEventListener('click', (e) => { e.stopPropagation(); pop.remove(); });
    pop.appendChild(close);
    pop.addEventListener('click', () => {
        pop.remove();
        if (!document.getElementById('notifDropdown')) openNotifDropdown(document.getElementById('alertChip') || document.getElementById('notifBellBtn'));
    });
    stack.appendChild(pop);
    addCountdownRing(pop, ALERT_POP_MS, 'var(--primary)');
    setTimeout(() => pop.remove(), ALERT_POP_MS);
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

/* The list opens beside what was clicked: next to the bell at the foot of
   the sidebar, under the alerts chip on the Dashboard. A phone keeps the
   full-screen list (global.css). */
let notifAnchor = null;
function placeNotifDropdown() {
    const dd = document.getElementById('notifDropdown');
    const anchor = notifAnchor && notifAnchor.isConnected ? notifAnchor : document.getElementById('notifBellBtn');
    if (!dd || !anchor) return;
    dd.style.top = dd.style.bottom = dd.style.left = dd.style.right = dd.style.maxHeight = '';
    if (window.innerWidth <= 768) return;
    const GAP = 8, EDGE = 12;
    const r = anchor.getBoundingClientRect();
    const width = dd.offsetWidth;
    const sidebar = anchor.closest('#sidebar');
    if (sidebar) {
        // to the right of the sidebar, its foot level with the bell, growing upward
        dd.style.left = Math.round(sidebar.getBoundingClientRect().right + GAP) + 'px';
        dd.style.right = 'auto';
        dd.style.top = 'auto';
        dd.style.bottom = Math.round(Math.max(EDGE, window.innerHeight - r.bottom)) + 'px';
        dd.style.maxHeight = Math.round(Math.min(480, r.bottom - EDGE)) + 'px';
    } else {
        // under the button, kept on screen
        const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE);
        dd.style.left = Math.round(left) + 'px';
        dd.style.right = 'auto';
        dd.style.top = Math.round(r.bottom + GAP) + 'px';
        dd.style.maxHeight = Math.round(Math.min(480, window.innerHeight - r.bottom - GAP - EDGE)) + 'px';
    }
}
window.addEventListener('resize', placeNotifDropdown);

async function openNotifDropdown(anchor) {
    if (anchor) notifAnchor = anchor;
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
                    ${canManage() ? '<button onclick="markAllNotifRead()" title="Mark all read"><span class="material-symbols-outlined" style="font-size:16px;">check</span> All</button>' : ''}
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
        placeNotifDropdown();

        setTimeout(() => {
            document.addEventListener('click', closeNotifOutside, { once: true });
        }, 10);
    } catch (e) {
        showToast(couldNot('load notifications', e), 'error');
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
    // a view-only account reads notices; it does not mark them (the mark is shared)
    if (!canManage()) return;
    try {
        await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'PUT', headers: getAuthHeaders() });
        refreshNotifCount();
        document.dispatchEvent(new CustomEvent('notifs-changed'));
        const dd = document.getElementById('notifDropdown');
        if (dd) {
            closeNotifDropdown();
            openNotifDropdown();
        }
    } catch (e) {}
}

async function markAllNotifRead() {
    try {
        const res = await fetch(`${API_BASE}/notifications/read-all`, { method: 'PUT', headers: getAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) { showToast(data.message || 'Could not mark them as read', 'error'); return; }
        refreshNotifCount();
        closeNotifDropdown();
        document.dispatchEvent(new CustomEvent('notifs-changed'));
        showToast('All notifications marked as read', 'success');
    } catch (e) {
        showToast(couldNot('mark all as read', e), 'error');
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

/* Today's date at the top right of every page's header, like the Dashboard's
   (which has its own), so the day is in view wherever work is done (the End
   of day count, sales, reports). It turns over at midnight. */
function addHeaderDate() {
    const header = document.querySelector('.page-header');
    if (!header || document.getElementById('dateDisplay')) return;
    let actions = header.querySelector('.page-header-actions');
    if (!actions) { actions = document.createElement('div'); actions.className = 'page-header-actions'; header.appendChild(actions); }
    const chip = document.createElement('span');
    chip.className = 'hero-chip page-date';
    chip.id = 'dateDisplay';
    chip.title = "Today's date";
    actions.appendChild(chip);
    const paint = () => {
        const now = new Date();
        chip.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">calendar_today</span>'
            + escHtml(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
        setTimeout(paint, midnight - now);
    };
    paint();
}

document.addEventListener('DOMContentLoaded', () => {
    addHeaderDate();
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

    /* The logo at the top of the sidebar folds it away (the arrow button is
       gone); its small arrow badge and "Hide the menu" say so. On the till
       and supplier pages, whose sidebar starts as the slim strip, the logo
       also opens it ("Show the menu"). */
    const brandLogo = document.querySelector('.sidebar-brand .brand-icon');
    if (brandLogo) {
        brandLogo.classList.add('is-sidebar-toggle');
        brandLogo.setAttribute('role', 'button');
        brandLogo.setAttribute('tabindex', '0');
        brandLogo.querySelector('img')?.removeAttribute('title');
        brandLogo.addEventListener('click', () => { if (window.innerWidth > 768) toggleSidebarVisibility(); });
        brandLogo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); brandLogo.click(); }
        });
    }
    paintSidebarToggle(isSidebarHidden());

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

/* A message for something that could not be done, saying why. A fetch that
   throws never reached the server (offline, or the server is down); anything
   else carries the server's own reason. */
function couldNot(action, err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Could not ' + action + ': this computer is offline. Reconnect and try again.';
    if (!err || err.name === 'TypeError' || /fetch|network|load failed/i.test(String(err.message || ''))) return 'Could not ' + action + ': the server could not be reached. Check the connection and try again.';
    return 'Could not ' + action + ': ' + String(err.message || err).replace(/\.$/, '') + '.';
}
