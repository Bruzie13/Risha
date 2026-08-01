const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let allUsers = [];
let editingUserId = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    const role = getUserRole();
    if (role !== 'admin') {
        const warning = document.getElementById('adminWarning');
        if (warning) warning.hidden = false;
        const table = document.getElementById('usersTable');
        if (table) table.style.display = 'none';
        document.querySelector('.page-header-actions .btn-primary')?.remove();
        return;
    }
    await loadUsers();
});

// MySQL hands back 1/0, not true/false — comparing against `false` alone
// reported every deactivated account as Active.
function isActive(u) {
    return u.is_active !== false && Number(u.is_active) !== 0;
}

function showingInactive() {
    return !!document.getElementById('showInactive')?.checked;
}

async function loadUsers() {
    try {
        const url = `${API_BASE}/auth/users` + (showingInactive() ? '?includeInactive=1' : '');
        const response = await fetch(url, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success) {
            allUsers = Array.isArray(data.data) ? data.data : [];
            displayUsers(allUsers);
        }
    } catch (error) {
        console.error('Error loading users:', error);
        showToast('Failed to load users', 'error');
    }
}

function showMoreUsers() {
    displayCount += PAGE_SIZE;
    const term = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    const filtered = allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.role || '').toLowerCase().includes(term)
    );
    displayUsers(filtered);
}

function showLessUsers() {
    displayCount = 0;
    showMoreUsers();
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No users found</td></tr>';
        updatePagination('usersPagination', users, displayCount, 'showMoreUsers', 'showLessUsers', PAGE_SIZE);
        return;
    }
    const shown = users.slice(0, displayCount);
    tbody.innerHTML = shown.map(u => `
        <tr>
            <td>${escHtml(u.full_name || 'N/A')}</td>
            <td>
                ${escHtml(u.email)}
                ${Number(u.email_verified) === 1
                    ? '<span class="verify-badge verified" title="This address has been confirmed by the account holder"><span class="material-symbols-outlined">verified</span> Verified</span>'
                    : '<span class="verify-badge pending" title="Cannot sign in until the confirmation link is clicked"><span class="material-symbols-outlined">mark_email_unread</span> Unconfirmed</span>'}
            </td>
            <td><span class="role-badge role-${u.role}">${escHtml(u.role)}</span></td>
            <td>
                <span class="status-badge ${isActive(u) ? 'status-in-stock' : 'status-expired'}">
                    ${isActive(u) ? 'Active' : 'Deactivated'}
                </span>
            </td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}</td>
            <td>
                ${!isActive(u)
                    ? `<button class="btn-edit" onclick="restoreUser(${u.id})" title="Reactivate this account — its username and email were never released">Restore</button>`
                    : `${Number(u.email_verified) === 1 ? '' : `<button class="btn-edit" onclick="resendVerification(${u.id})" title="Send the confirmation link again">Resend</button>`}
                <button class="btn-edit" onclick="openEditUserModal(${u.id})">Edit</button>
                <button class="btn-delete" onclick="deleteUser(${u.id})">Delete</button>`}
            </td>
        </tr>
    `).join('');
    updatePagination('usersPagination', users, displayCount, 'showMoreUsers', 'showLessUsers', PAGE_SIZE);
}

document.getElementById('searchInput')?.addEventListener('keyup', (e) => {
    displayCount = PAGE_SIZE;
    const term = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.role || '').toLowerCase().includes(term)
    );
    displayUsers(filtered);
});

/* ── Email verification code (new accounts only) ──────────────────────────
   The account is not created until a code mailed to the address comes back,
   so a mistyped Gmail is caught here rather than the day someone needs it. */
let codedEmail = null;   // the address the pending code was sent to

function onEmailChanged() {
    // Typing a different address invalidates the code already sent.
    const current = document.getElementById('userEmail').value.trim().toLowerCase();
    if (codedEmail && current !== codedEmail) {
        codedEmail = null;
        document.getElementById('emailCodeRow').style.display = 'none';
        document.getElementById('userEmailCode').value = '';
        document.getElementById('userEmailCode').required = false;
    }
}

async function sendEmailCode() {
    const email = document.getElementById('userEmail').value.trim();
    const btn = document.getElementById('sendCodeBtn');
    if (!email) {
        showErrorDialog('Email required', 'Type the new user\'s email address first, then send the code.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
        const res = await fetch(`${API_BASE}/auth/email-code`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
            codedEmail = email.toLowerCase();
            const row = document.getElementById('emailCodeRow');
            row.style.display = '';
            const input = document.getElementById('userEmailCode');
            input.required = true;
            input.value = '';
            input.focus();
            document.getElementById('emailCodeHint').textContent = data.message;
            showToast('Code sent to ' + email, 'success');
        } else {
            showErrorDialog('Could not send the code', data.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Error sending email code:', error);
        showToast('Failed to send the code', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = codedEmail ? 'Resend code' : 'Send code';
    }
}

async function restoreUser(id) {
    const user = allUsers.find(u => u.id === id);
    showConfirmDialog(
        'Restore account',
        `Reactivate ${user?.full_name || 'this account'} (${user?.username || ''})? They will be able to sign in again with their existing password.`,
        async () => {
            try {
                const res = await fetch(`${API_BASE}/auth/users/${id}/status`, {
                    method: 'PUT', headers: getAuthHeaders()
                });
                const data = await res.json();
                if (data.success) {
                    showSuccessDialog('Account restored', data.message, { icon: 'person_check' });
                    await loadUsers();
                } else {
                    showErrorDialog('Could not restore account', data.message || 'Unknown error');
                }
            } catch (error) {
                console.error('Error restoring user:', error);
                showToast('Failed to restore account', 'error');
            }
        },
        'Yes, Restore',
        '<span class="material-symbols-outlined" style="font-size:48px;color:var(--success);">person_check</span>'
    );
}

async function resendVerification(id) {
    const user = allUsers.find(u => u.id === id);
    try {
        const res = await fetch(`${API_BASE}/auth/users/${id}/resend-verification`, {
            method: 'POST', headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
            showSuccessDialog('Confirmation link sent', data.message, { icon: 'mark_email_read' });
            await loadUsers();
        } else {
            showErrorDialog('Could not send the link', data.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Error resending verification:', error);
        showToast(`Failed to email ${user?.email || 'that user'}`, 'error');
    }
}

function resetEmailCodeState() {
    codedEmail = null;
    const row = document.getElementById('emailCodeRow');
    if (row) row.style.display = 'none';
    const input = document.getElementById('userEmailCode');
    if (input) { input.value = ''; input.required = false; }
    const btn = document.getElementById('sendCodeBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Send code'; }
}

function openAddUserModal() {
    editingUserId = null;
    document.getElementById('userModalTitle').textContent = 'Add New User';
    document.getElementById('userForm').reset();
    resetEmailCodeState();
    document.getElementById('sendCodeBtn').style.display = '';
    const unameEl = document.getElementById('userUsername');
    unameEl.disabled = false;
    unameEl.title = '';
    document.getElementById('userPassword').required = true;
    document.getElementById('passwordRequired').style.display = 'inline';
    document.getElementById('userSubmitBtn').textContent = 'Create User';
    document.getElementById('userModal').classList.add('active');
}

function openEditUserModal(id) {
    editingUserId = id;
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    document.getElementById('userModalTitle').textContent = 'Edit User';
    // Editing keeps the link-based flow: changing the address re-locks the
    // account and mails a confirmation link, no code needed here.
    resetEmailCodeState();
    document.getElementById('sendCodeBtn').style.display = 'none';
    const unameEl = document.getElementById('userUsername');
    unameEl.value = user.username || '';
    unameEl.disabled = true;
    unameEl.title = 'Usernames cannot be changed';
    document.getElementById('userFullName').value = user.full_name || '';
    document.getElementById('userEmail').value = user.email || '';
    document.getElementById('userRole').value = user.role || 'staff';
    document.getElementById('userPassword').required = false;
    document.getElementById('userPassword').value = '';
    document.getElementById('passwordRequired').style.display = 'none';
    document.getElementById('userSubmitBtn').textContent = 'Update User';
    document.getElementById('userModal').classList.add('active');
}

function closeUserModal() {
    document.getElementById('userModal').classList.remove('active');
    editingUserId = null;
}

async function handleUserSubmit(event) {
    event.preventDefault();
    const userData = {
        username: document.getElementById('userUsername').value,
        full_name: document.getElementById('userFullName').value,
        email: document.getElementById('userEmail').value
    };

    if (!editingUserId) {
        const code = document.getElementById('userEmailCode').value.trim();
        if (!codedEmail) {
            showErrorDialog('Verify the email first',
                'Press "Send code" to email a 6-digit code to that address, then type the code here. The account is only created once the code checks out.');
            return;
        }
        if (userData.email.trim().toLowerCase() !== codedEmail) {
            showErrorDialog('Email changed', 'The email address changed after the code was sent. Send a new code to this address.');
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            showErrorDialog('Code required', 'Enter the 6-digit code that was emailed to ' + userData.email + '.');
            return;
        }
        userData.emailCode = code;
    }
    // Only send a role we actually resolved: an empty value would otherwise
    // overwrite the account's real role on edit.
    const role = document.getElementById('userRole').value;
    if (role) userData.role = role;
    const password = document.getElementById('userPassword').value;
    if (password) {
        const pwError = passwordPolicyError(password);
        if (pwError) { showErrorDialog('Password too weak', pwError + '.'); return; }
        userData.password = password;
    } else if (!editingUserId) {
        showErrorDialog('Password required', 'Set a password for the new account before saving.');
        return;
    }

    try {
        let response;
        if (editingUserId) {
            response = await fetch(`${API_BASE}/auth/users/${editingUserId}`, {
                method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(userData)
            });
        } else {
            response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(userData)
            });
        }
        const data = await response.json();
        if (!data.success) {
            showErrorDialog('Could not save user', data.message || 'Unknown error');
        } else {
            // The server's message carries the real outcome — whether the
            // address ended up verified, and which one.
            showSuccessDialog(
                editingUserId ? 'User updated' : 'User created',
                data.message || (editingUserId ? 'The account details have been saved.' : 'The new account has been created.'),
                { icon: data.emailChanged ? 'mark_email_unread' : 'person' }
            );
            closeUserModal();
            await loadUsers();
        }
    } catch (error) {
        console.error('Error saving user:', error);
        showToast('Failed to save user', 'error');
    }
}

async function deleteUser(id) {
    // Deletion is a deactivation: the row stays, so the username and email stay
    // reserved. Saying "cannot be undone" sent admins hunting for a name that
    // the list no longer showed but the database still held.
    showConfirmDialog('Delete User', 'Deactivate this account? They can no longer sign in, and their username and email stay reserved. You can bring the account back later with "Show deactivated".', async () => {
        try {
            const response = await fetch(`${API_BASE}/auth/users/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showSuccessDialog('User deactivated', 'The account can no longer sign in. Tick "Show deactivated" to restore it.', { tone: 'danger' });
                await loadUsers();
            } else {
                showToast('Error: ' + (data.message || 'Unknown'), 'error');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            showToast('Failed to delete user', 'error');
        }
    }, 'Yes, Delete', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete</span>');
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('userModal')) closeUserModal();
});
