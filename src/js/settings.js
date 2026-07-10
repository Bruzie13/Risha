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
    updateDate();

    const nameEl = document.getElementById('userName');
    const avatarEl = document.querySelector('.avatar .avatar-initials');
    const user = getUser();
    if (user && nameEl) nameEl.textContent = user.full_name || user.username || user.email;
    if (user && avatarEl) {
        const name = user.full_name || user.username || user.email;
        avatarEl.textContent = name.split(' ').map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }
});

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

    var initialsEl = document.querySelector('.settings-avatar-initials');
    var displayNameEl = document.getElementById('settingsDisplayName');
    var roleEl = document.getElementById('settingsDisplayRole');
    var nameInput = document.getElementById('settingsFullName');
    var emailInput = document.getElementById('settingsEmail');
    var usernameInput = document.getElementById('settingsUsername');
    var sessionUser = document.getElementById('settingsSessionUser');
    var sessionRole = document.getElementById('settingsSessionRole');

    var name = user.full_name || user.username || user.email || 'User';
    if (initialsEl) {
        initialsEl.textContent = name.split(' ').map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
    }
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
        var isDark = checkbox.checked;
        document.documentElement.classList.toggle('dark-mode', isDark);
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        var btn = document.getElementById('themeToggleBtn');
        if (btn) {
            btn.innerHTML = isDark ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
            btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
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
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        showToast('Please enter your full name', 'error');
        return;
    }

    try {
        var user = getUser();
        if (!user) return;
        // /auth/profile is self-service (any role); /auth/users/:id is admin-only
        var res = await fetch(API_BASE + '/auth/profile', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ full_name: name })
        });
        var data = await res.json();
        if (data.success) {
            user.full_name = name;
            localStorage.setItem('user', JSON.stringify(user));
            loadSettings();
            var nameEl = document.getElementById('userName');
            if (nameEl) nameEl.textContent = name;
            var avatarEl = document.querySelector('.avatar .avatar-initials');
            if (avatarEl) {
                avatarEl.textContent = name.split(' ').map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase();
            }
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

function setupEmailSettings() {
    var user = getUser();
    if (!user || user.role !== 'admin') return;
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
        return;
    }
    if (newPw.value !== confirmPw.value) {
        showFieldError('errorConfirmPw', 'Passwords do not match');
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
            showSuccessDialog('Password changed', 'Use your new password the next time you log in.', { icon: 'lock_reset' });
            currentPw.value = '';
            newPw.value = '';
            confirmPw.value = '';
        } else {
            showFieldError('errorCurrentPw', data.message || 'Failed to change password');
        }
    } catch (e) {
        showFieldError('errorCurrentPw', 'Failed to change password');
    }
}