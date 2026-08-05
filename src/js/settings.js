document.addEventListener('DOMContentLoaded', function () {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    loadSettings();
    setupTabs();
    setupThemeToggle();
    setupSidebarToggle();
    setupNotifToggle();
    setupEmailSettings();
    setupAppearance();
    updateDate();

    const nameEl = document.getElementById('userName');
    const user = getUser();
    if (user && nameEl) nameEl.textContent = user.full_name || user.username || user.email;
    if (typeof applyUserIdentity === 'function') applyUserIdentity();
    updateAvatarControls();
});

/* ===== Appearance: accent color + text size ===== */
// Each preset carries the full set of "primary" values so the look stays
// balanced. Values are stored resolved in localStorage so the early inline
// script on every page can apply them before first paint (no colour flash).
var ACCENTS = [
    { key: 'coral',   name: 'Coral',   primary: '#EE6A5F', dark: '#E14C42', light: '#FFA79E', gradA: '#F88070', gradB: '#E5504A' },
    { key: 'blue',    name: 'Blue',    primary: '#3B82F6', dark: '#2563EB', light: '#93C5FD', gradA: '#60A5FA', gradB: '#2563EB' },
    { key: 'indigo',  name: 'Indigo',  primary: '#6366F1', dark: '#4F46E5', light: '#A5B4FC', gradA: '#818CF8', gradB: '#4F46E5' },
    { key: 'violet',  name: 'Violet',  primary: '#8B5CF6', dark: '#7C3AED', light: '#C4B5FD', gradA: '#A78BFA', gradB: '#7C3AED' },
    { key: 'emerald', name: 'Emerald', primary: '#10B981', dark: '#059669', light: '#6EE7B7', gradA: '#34D399', gradB: '#059669' },
    { key: 'teal',    name: 'Teal',    primary: '#14B8A6', dark: '#0D9488', light: '#5EEAD4', gradA: '#2DD4BF', gradB: '#0D9488' },
    { key: 'amber',   name: 'Amber',   primary: '#F59E0B', dark: '#D97706', light: '#FCD34D', gradA: '#FBBF24', gradB: '#D97706' },
    { key: 'rose',    name: 'Rose',    primary: '#F43F5E', dark: '#E11D48', light: '#FDA4AF', gradA: '#FB7185', gradB: '#E11D48' }
];
var DEFAULT_ACCENT = 'coral';
var DEFAULT_SCALE = '1';

function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

function accentVars(a) {
    return {
        '--primary': a.primary,
        '--primary-dark': a.dark,
        '--primary-light': a.light,
        '--primary-bg': hexToRgba(a.primary, 0.10),
        '--primary-glow': hexToRgba(a.primary, 0.24),
        '--primary-gradient': 'linear-gradient(135deg, ' + a.gradA + ', ' + a.gradB + ')',
        // subtle full-page background tint in the accent colour
        '--accent-wash': hexToRgba(a.primary, 0.07)
    };
}

function applyAccent(key, persist) {
    var a = ACCENTS.filter(function (x) { return x.key === key; })[0] || ACCENTS[0];
    var vars = accentVars(a);
    for (var k in vars) document.documentElement.style.setProperty(k, vars[k]);
    if (persist) {
        localStorage.setItem('accentName', a.key);
        localStorage.setItem('accentVars', JSON.stringify(vars));
    }
    // reflect selection in the swatch grid
    document.querySelectorAll('.accent-swatch').forEach(function (el) {
        el.classList.toggle('active', el.dataset.key === a.key);
    });
}

function applyTextScale(scale, persist) {
    document.documentElement.style.zoom = (scale && scale !== '1') ? scale : '';
    if (persist) localStorage.setItem('textScale', scale);
    reflectSeg('textSizeSeg', 'scale', scale);
}

/* --- custom accent from any hex --- */
function mix(hex1, hex2, t) {
    var a = hex1.replace('#', ''), b = hex2.replace('#', '');
    var r = Math.round(parseInt(a.substr(0, 2), 16) * (1 - t) + parseInt(b.substr(0, 2), 16) * t);
    var g = Math.round(parseInt(a.substr(2, 2), 16) * (1 - t) + parseInt(b.substr(2, 2), 16) * t);
    var bl = Math.round(parseInt(a.substr(4, 2), 16) * (1 - t) + parseInt(b.substr(4, 2), 16) * t);
    return '#' + [r, g, bl].map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
}

function applyCustomAccent(hex, persist) {
    var a = {
        key: 'custom', primary: hex,
        dark: mix(hex, '#000000', 0.18),
        light: mix(hex, '#ffffff', 0.42),
        gradA: mix(hex, '#ffffff', 0.10),
        gradB: mix(hex, '#000000', 0.10)
    };
    var vars = accentVars(a);
    for (var k in vars) document.documentElement.style.setProperty(k, vars[k]);
    if (persist) {
        localStorage.setItem('accentName', 'custom');
        localStorage.setItem('accentCustom', hex);
        localStorage.setItem('accentVars', JSON.stringify(vars));
    }
    document.querySelectorAll('.accent-swatch').forEach(function (el) { el.classList.remove('active'); });
    var picker = document.getElementById('accentPicker');
    if (picker) { picker.value = hex; picker.classList.add('active'); }
}

/* --- theme mode: system / light / dark --- */
function applyThemeMode(mode, persist) {
    if (persist) localStorage.setItem('theme', mode); // 'system' | 'light' | 'dark'
    var dark = mode === 'dark' || (mode === 'system' &&
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-mode', dark);
    reflectSeg('themeModeSeg', 'mode', mode);
    var toggle = document.getElementById('settingsDarkModeToggle');
    if (toggle) toggle.checked = dark;
    var btn = document.getElementById('themeToggleBtn');
    if (btn) btn.querySelector('.material-symbols-outlined').textContent = dark ? 'light_mode' : 'dark_mode';
}

/* --- UI font family --- */
var FONTS = {
    sans: { '--font-sans': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", '--font-display': "'Plus Jakarta Sans', 'Nunito', 'Inter', sans-serif" },
    serif: { '--font-sans': "Georgia, 'Iowan Old Style', 'Times New Roman', serif", '--font-display': "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
    mono: { '--font-sans': "'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace", '--font-display': "'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, monospace" }
};
function applyFont(name, persist) {
    var f = FONTS[name] || FONTS.sans;
    for (var k in f) document.documentElement.style.setProperty(k, f[k]);
    if (persist) {
        localStorage.setItem('uiFont', name);
        localStorage.setItem('fontVars', JSON.stringify(f));
    }
    reflectSeg('fontSeg', 'font', name);
}

function reflectSeg(segId, attr, value) {
    var seg = document.getElementById(segId);
    if (!seg) return;
    seg.querySelectorAll('.seg-btn').forEach(function (el) {
        el.classList.toggle('active', el.dataset[attr] === value);
    });
}

/* --- preview-then-save state --- */
var pendingAppearance = null;
var appearanceDirty = false;

function loadSavedAppearance() {
    return {
        accentName: localStorage.getItem('accentName') || DEFAULT_ACCENT,
        accentCustom: localStorage.getItem('accentCustom') || null,
        uiFont: localStorage.getItem('uiFont') || 'sans',
        textScale: localStorage.getItem('textScale') || DEFAULT_SCALE,
        theme: localStorage.getItem('theme') || 'system',
        backdrop: localStorage.getItem('ambientBackdrop') === 'off' ? 'off' : 'on'
    };
}

// The WebGL ambient backdrop. Persisting is deferred to Save, like the rest
// of this panel, so previewing it costs nothing.
function applyBackdrop(mode, persist) {
    var on = mode !== 'off';
    if (typeof setAmbientBackdrop === 'function') setAmbientBackdrop(on, !!persist);
    else if (persist) localStorage.setItem('ambientBackdrop', on ? 'on' : 'off');
    reflectSeg('backdropSeg', 'backdrop', on ? 'on' : 'off');
}
// Apply a whole appearance state live; persist=true writes it to localStorage.
function applyAppearanceState(s, persist) {
    if (s.accentName === 'custom' && s.accentCustom) applyCustomAccent(s.accentCustom, persist);
    else applyAccent(s.accentName, persist);
    applyFont(s.uiFont, persist);
    applyTextScale(s.textScale, persist);
    applyThemeMode(s.theme, persist);
    applyBackdrop(s.backdrop, persist);
}
function markAppearanceDirty(on) {
    appearanceDirty = on;
    var bar = document.getElementById('appearanceSaveBar');
    if (bar) bar.classList.toggle('active', on);
}
function saveAppearance() {
    applyAppearanceState(pendingAppearance, true);
    markAppearanceDirty(false);
    if (typeof showToast === 'function') showToast('Appearance saved', 'success');
}
function discardAppearance() {
    pendingAppearance = loadSavedAppearance();
    applyAppearanceState(pendingAppearance, false);
    markAppearanceDirty(false);
    if (typeof showToast === 'function') showToast('Changes discarded', 'info');
}

function setupAppearance() {
    pendingAppearance = loadSavedAppearance();

    // theme mode (live preview only; committed on Save)
    var themeSeg = document.getElementById('themeModeSeg');
    if (themeSeg) themeSeg.querySelectorAll('.seg-btn').forEach(function (el) {
        el.addEventListener('click', function () {
            pendingAppearance.theme = el.dataset.mode;
            applyThemeMode(el.dataset.mode, false);
            markAppearanceDirty(true);
        });
    });

    // accent swatches
    var grid = document.getElementById('accentSwatches');
    if (grid) {
        grid.innerHTML = ACCENTS.map(function (a) {
            return '<button type="button" class="accent-swatch" data-key="' + a.key + '" title="' + a.name +
                '" style="background:linear-gradient(135deg,' + a.gradA + ',' + a.gradB + ');"></button>';
        }).join('');
        grid.querySelectorAll('.accent-swatch').forEach(function (el) {
            el.addEventListener('click', function () {
                pendingAppearance.accentName = el.dataset.key;
                pendingAppearance.accentCustom = null;
                applyAccent(el.dataset.key, false);
                markAppearanceDirty(true);
            });
        });
    }
    // custom color picker
    var picker = document.getElementById('accentPicker');
    if (picker) picker.addEventListener('input', function () {
        pendingAppearance.accentName = 'custom';
        pendingAppearance.accentCustom = picker.value;
        applyCustomAccent(picker.value, false);
        markAppearanceDirty(true);
    });

    // font family
    var fontSeg = document.getElementById('fontSeg');
    if (fontSeg) fontSeg.querySelectorAll('.seg-btn').forEach(function (el) {
        el.addEventListener('click', function () {
            pendingAppearance.uiFont = el.dataset.font;
            applyFont(el.dataset.font, false);
            markAppearanceDirty(true);
        });
    });

    // text size
    var seg = document.getElementById('textSizeSeg');
    if (seg) seg.querySelectorAll('.seg-btn').forEach(function (el) {
        el.addEventListener('click', function () {
            pendingAppearance.textScale = el.dataset.scale;
            applyTextScale(el.dataset.scale, false);
            markAppearanceDirty(true);
        });
    });

    // animated backdrop
    var bdSeg = document.getElementById('backdropSeg');
    if (bdSeg) bdSeg.querySelectorAll('.seg-btn').forEach(function (el) {
        el.addEventListener('click', function () {
            pendingAppearance.backdrop = el.dataset.backdrop;
            applyBackdrop(el.dataset.backdrop, false);
            markAppearanceDirty(true);
        });
    });

    // reset — previews defaults; user still confirms with Save
    var reset = document.getElementById('resetAppearanceBtn');
    if (reset) reset.addEventListener('click', function () {
        localStorage.removeItem('accentCustom');
        pendingAppearance = { accentName: DEFAULT_ACCENT, accentCustom: null, uiFont: 'sans', textScale: DEFAULT_SCALE, theme: 'system', backdrop: 'on' };
        applyAppearanceState(pendingAppearance, false);
        markAppearanceDirty(true);
    });

    // save / discard bar
    var saveBtn = document.getElementById('appearanceSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAppearance);
    var discardBtn = document.getElementById('appearanceDiscardBtn');
    if (discardBtn) discardBtn.addEventListener('click', discardAppearance);

    // reflect the currently saved choices (no dirty state on load)
    applyAppearanceState(pendingAppearance, false);
    markAppearanceDirty(false);
}

function updateDate() {
    var el = document.getElementById('settingsDateDisplay');
    if (!el) return;
    var d = new Date();
    el.textContent = d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function setupTabs() {
    var tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            var panels = document.querySelectorAll('.settings-panel');
            panels.forEach(function (p) { p.classList.remove('active'); });
            var target = document.getElementById('panel-' + tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });
}

function loadSettings() {
    var user = getUser();
    if (!user) return;


    var displayNameEl = document.getElementById('settingsDisplayName');
    var roleEl = document.getElementById('settingsDisplayRole');
    var nameInput = document.getElementById('settingsFullName');
    var emailInput = document.getElementById('settingsEmail');
    var usernameInput = document.getElementById('settingsUsername');
    var sessionUser = document.getElementById('settingsSessionUser');
    var sessionRole = document.getElementById('settingsSessionRole');

    var name = user.full_name || user.username || user.email || 'User';
    if (typeof applyUserIdentity === 'function') applyUserIdentity();
    if (displayNameEl) displayNameEl.textContent = name;
    if (roleEl) roleEl.textContent = (user.role || 'staff');
    if (nameInput) nameInput.value = user.full_name || '';
    if (emailInput) emailInput.value = user.email || '';
    if (usernameInput) usernameInput.value = user.username || '';
    if (sessionUser) sessionUser.textContent = name;
    if (sessionRole) sessionRole.textContent = user.role || 'staff';
}

function setupThemeToggle() {
    var checkbox = document.getElementById('settingsDarkModeToggle');
    if (!checkbox) return;
    checkbox.checked = document.documentElement.classList.contains('dark-mode');
    checkbox.addEventListener('change', function () {
        // keep the 3-way Theme control in sync (it sets the same 'theme' key)
        if (typeof applyThemeMode === 'function') {
            applyThemeMode(checkbox.checked ? 'dark' : 'light', true);
        }
    });
}

function setupSidebarToggle() {
    var checkbox = document.getElementById('settingsSidebarToggle');
    if (!checkbox) return;
    checkbox.checked = document.documentElement.classList.contains('sidebar-hidden');
    checkbox.addEventListener('change', function () {
        var hidden = checkbox.checked;
        document.documentElement.classList.toggle('sidebar-hidden', hidden);
        localStorage.setItem('sidebarHidden', hidden ? 'true' : 'false');
        var btn = document.getElementById('sidebarToggleBtn');
        if (btn) btn.innerHTML = hidden ? '<span class="material-symbols-outlined">chevron_right</span>' : '<span class="material-symbols-outlined">chevron_left</span>';
    });
}

function setupNotifToggle() {
    var checkbox = document.getElementById('settingsNotifToggle');
    if (!checkbox) return;
    var saved = localStorage.getItem('notifEnabled');
    if (saved !== null) checkbox.checked = saved === 'true';
    checkbox.addEventListener('change', function () {
        localStorage.setItem('notifEnabled', checkbox.checked);
    });
}

async function saveProfile() {
    var nameInput = document.getElementById('settingsFullName');
    var emailInput = document.getElementById('settingsEmail');
    var name = nameInput ? nameInput.value.trim() : '';
    var email = emailInput ? emailInput.value.trim() : '';
    if (!name) {
        showToast('Please enter your full name', 'error');
        return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    try {
        var user = getUser();
        if (!user) return;
        // /auth/profile is self-service (any role); /auth/users/:id is admin-only
        var res = await fetch(API_BASE + '/auth/profile', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ full_name: name, email: email })
        });
        var data = await res.json();
        if (data.success) {
            user.full_name = name;
            user.email = (data.data && data.data.email) || email;
            localStorage.setItem('user', JSON.stringify(user));
            loadSettings();
            var nameEl = document.getElementById('userName');
            if (nameEl) nameEl.textContent = name;
            if (typeof applyUserIdentity === 'function') applyUserIdentity();
            showSuccessDialog('Profile updated', 'Your account details have been saved.', { icon: 'person' });
        } else {
            showToast(data.message || 'Failed to update profile', 'error');
        }
    } catch (e) {
        showToast('Error updating profile', 'error');
    }
}

function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach(function (el) { el.textContent = ''; });
}

function showFieldError(id, message) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">error</span> ' + message;
}

// ------- Email settings (admin only) -------

async function downloadBackup() {
    var btn = document.getElementById('downloadBackupBtn');
    btn.disabled = true;
    try {
        var res = await fetch(API_BASE + '/backup', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Backup failed (' + res.status + ')');
        var blob = await res.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'risha-backup-' + new Date().toISOString().slice(0, 10) + '.json.gz';
        a.click();
        URL.revokeObjectURL(a.href);
        showSuccessDialog('Backup downloaded', 'Store the file somewhere safe — restore with scripts/restore-backup.js.', { icon: 'cloud_download' });
    } catch (e) {
        showErrorDialog('Backup failed', e.message);
    } finally {
        btn.disabled = false;
    }
}

function setupEmailSettings() {
    var user = getUser();
    if (!user || user.role !== 'admin') return;
    var backupCard = document.getElementById('backupCard');
    if (backupCard) backupCard.style.display = '';
    var tabBtn = document.getElementById('emailTabBtn');
    if (tabBtn) tabBtn.style.display = '';
    loadEmailSettings();
}

function setEmailStatus(message, type) {
    var el = document.getElementById('emailConfigStatus');
    if (!el) return;
    var color = type === 'success' ? 'var(--success, #4caf50)' : type === 'error' ? 'var(--danger, #E96A6A)' : 'var(--text-muted, #888)';
    el.style.color = color;
    el.textContent = message || '';
}

async function loadEmailSettings() {
    try {
        var res = await fetch(API_BASE + '/email-settings', { headers: getAuthHeaders() });
        var data = await res.json();
        if (!data.success) return;
        var s = data.data;
        var userInput = document.getElementById('emailSenderUser');
        var passInput = document.getElementById('emailSenderPass');
        var nameInput = document.getElementById('emailFromName');
        var enabledToggle = document.getElementById('emailEnabledToggle');
        var testInput = document.getElementById('emailTestRecipient');
        if (userInput) userInput.value = s.email_user || '';
        if (passInput) passInput.placeholder = s.email_pass_set ? '•••••••• (saved — leave blank to keep)' : '16-character app password';
        if (nameInput) nameInput.value = s.email_from_name || '';
        if (enabledToggle) enabledToggle.checked = !!s.email_enabled;
        var me = getUser();
        if (testInput && !testInput.value && me && me.email) testInput.value = me.email;
        if (s.email_user && s.email_pass_set) {
            setEmailStatus('Configured — sender: ' + s.email_user + (s.source === 'env' ? ' (from .env file)' : ''), 'info');
        } else {
            setEmailStatus('Not configured yet. Enter a Gmail address and app password.', 'error');
        }
    } catch (e) {
        setEmailStatus('Could not load email settings', 'error');
    }
}

async function saveEmailSettings() {
    var btn = document.getElementById('saveEmailBtn');
    var emailUser = (document.getElementById('emailSenderUser').value || '').trim();
    var emailPass = document.getElementById('emailSenderPass').value;
    var fromName = (document.getElementById('emailFromName').value || '').trim();
    var enabled = document.getElementById('emailEnabledToggle').checked;

    if (!emailUser) {
        setEmailStatus('Sender Gmail address is required', 'error');
        return;
    }

    btn.disabled = true;
    setEmailStatus('Verifying credentials with Gmail…', 'info');
    try {
        var res = await fetch(API_BASE + '/email-settings', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                email_user: emailUser,
                email_pass: emailPass || undefined,
                email_from_name: fromName,
                email_enabled: enabled
            })
        });
        var data = await res.json();
        if (data.success) {
            setEmailStatus('Saved — credentials verified with Gmail ✓', 'success');
            showSuccessDialog('Email settings saved', 'Credentials verified with Gmail — supplier emails are good to go.', { icon: 'mark_email_read' });
            document.getElementById('emailSenderPass').value = '';
            loadEmailSettings();
        } else {
            setEmailStatus(data.message || 'Failed to save settings', 'error');
            showToast(data.message || 'Failed to save email settings', 'error');
        }
    } catch (e) {
        setEmailStatus('Error saving settings', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function sendTestEmail() {
    var btn = document.getElementById('testEmailBtn');
    var to = (document.getElementById('emailTestRecipient').value || '').trim();
    if (!to) {
        showToast('Enter a recipient email first', 'error');
        return;
    }
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">hourglass_top</span> Sending…';
    try {
        var res = await fetch(API_BASE + '/email-settings/test', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ to: to })
        });
        var data = await res.json();
        if (data.success) {
            showSuccessDialog('Test email sent', data.message || 'Check the inbox to confirm delivery.', { icon: 'outgoing_mail' });
        } else {
            showToast(data.message || 'Failed to send test email', 'error');
        }
    } catch (e) {
        showToast('Error sending test email', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
}

async function changePassword() {
    clearFieldErrors();
    var currentPw = document.getElementById('settingsCurrentPw');
    var newPw = document.getElementById('settingsNewPw');
    var confirmPw = document.getElementById('settingsConfirmPw');

    if (!currentPw.value && !newPw.value && !confirmPw.value) {
        showFieldError('errorCurrentPw', 'Enter current password');
        showFieldError('errorNewPw', 'Enter new password');
        showFieldError('errorConfirmPw', 'Confirm new password');
        return;
    }
    if (!currentPw.value) {
        showFieldError('errorCurrentPw', 'Enter current password');
        return;
    }
    if (!newPw.value) {
        showFieldError('errorNewPw', 'Enter new password');
        return;
    }
    if (!confirmPw.value) {
        showFieldError('errorConfirmPw', 'Confirm new password');
        return;
    }
    var pwError = passwordPolicyError(newPw.value);
    if (pwError) {
        showFieldError('errorNewPw', pwError);
        showErrorDialog('Password too weak', pwError + '.');
        return;
    }
    if (newPw.value !== confirmPw.value) {
        showFieldError('errorConfirmPw', 'Passwords do not match');
        showErrorDialog('Passwords do not match', 'The new password and its confirmation must be identical.');
        return;
    }

    try {
        var res = await fetch(API_BASE + '/auth/change-password', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ currentPassword: currentPw.value, newPassword: newPw.value })
        });
        var data = await res.json();
        if (data.success) {
            // Changing the password retires every session it opened. The server
            // hands back a replacement for THIS browser; without storing it the
            // next request would be rejected and we'd bounce to the login page.
            // Keep the replacement wherever the current session already lives,
            // so changing a password does not silently convert a till session
            // into one that survives the browser closing.
            if (data.token) {
                (sessionStorage.getItem('authToken') ? sessionStorage : localStorage)
                    .setItem('authToken', data.token);
            }
            showSuccessDialog('Password changed',
                'Use your new password next time you sign in. Any other device signed in as you has been signed out.',
                { icon: 'lock_reset' });
            currentPw.value = '';
            newPw.value = '';
            confirmPw.value = '';
        } else {
            showFieldError('errorCurrentPw', data.message || 'Failed to change password');
            showErrorDialog('Password not changed', data.message || 'Failed to change password.');
        }
    } catch (e) {
        showFieldError('errorCurrentPw', 'Failed to change password');
    }
}
/* ===== Profile picture ===== */
function settingsResizeImage(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose an image file')); return; }
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('Could not read the file')); };
        reader.onload = function () {
            var img = new Image();
            img.onerror = function () { reject(new Error('That image could not be loaded')); };
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
                else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality || 0.8));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function updateAvatarControls() {
    var user = getUser();
    var removeBtn = document.getElementById('avatarRemoveBtn');
    if (removeBtn) removeBtn.style.display = (user && user.avatar) ? '' : 'none';
}

function handleAvatarFile(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    settingsResizeImage(file, 256, 0.8)
        .then(function (dataUrl) { saveAvatar(dataUrl); })
        .catch(function (e) { showToast(e.message || 'Could not process image', 'error'); });
}

function removeAvatar() { saveAvatar(null); }

async function saveAvatar(dataUrl) {
    var user = getUser();
    if (!user) return;
    var nameEl = document.getElementById('settingsFullName');
    var name = ((nameEl && nameEl.value) || user.full_name || '').trim();
    try {
        var res = await fetch(API_BASE + '/auth/profile', {
            method: 'PUT', headers: getAuthHeaders(),
            body: JSON.stringify({ full_name: name || user.full_name, avatar: dataUrl })
        });
        var data = await res.json();
        if (data.success) {
            user.avatar = dataUrl;
            localStorage.setItem('user', JSON.stringify(user));
            if (typeof applyUserIdentity === 'function') applyUserIdentity();
            updateAvatarControls();
            showToast(dataUrl ? 'Profile photo updated' : 'Profile photo removed', 'success');
        } else {
            showToast(data.message || 'Could not save photo', 'error');
        }
    } catch (e) {
        showToast('Error saving photo', 'error');
    }
}
