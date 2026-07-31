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

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/auth/users`, { headers: getAuthHeaders() });
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
            <td>${escHtml(u.email)}</td>
            <td><span class="role-badge role-${u.role}">${escHtml(u.role)}</span></td>
            <td>
                <span class="status-badge ${u.is_active !== false ? 'status-in-stock' : 'status-expired'}">
                    ${u.is_active !== false ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}</td>
            <td>
                <button class="btn-edit" onclick="openEditUserModal(${u.id})">Edit</button>
                <button class="btn-delete" onclick="deleteUser(${u.id})">Delete</button>
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

function openAddUserModal() {
    editingUserId = null;
    document.getElementById('userModalTitle').textContent = 'Add New User';
    document.getElementById('userForm').reset();
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
            showSuccessDialog(
                editingUserId ? 'User updated' : 'User created',
                editingUserId ? 'The account details have been saved.' : 'The new account can log in right away.',
                { icon: 'person' }
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
    showConfirmDialog('Delete User', 'Are you sure you want to delete this user? This cannot be undone.', async () => {
        try {
            const response = await fetch(`${API_BASE}/auth/users/${id}`, {
                method: 'DELETE', headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                showSuccessDialog('User deleted', 'The account has been removed and can no longer log in.', { tone: 'danger' });
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
