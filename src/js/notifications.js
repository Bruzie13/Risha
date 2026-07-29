const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;
let loadedNotifs = [];   // pages fetched so far for the current filter
let notifTotal = 0;      // total matching the current filter (from the server)

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await triggerAlertChecks();
    loadUserInfo();
    await Promise.all([loadSummary(), loadNotifications()]);
});

async function triggerAlertChecks() {
    try {
        await fetch(`${API_BASE}/notifications/check-alerts`, { method: 'POST', headers: getAuthHeaders() });
    } catch (e) {}
}

function loadUserInfo() {
    const user = getUser();
    if (!user) return;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = user.full_name || user.username || user.email;
    if (typeof applyUserIdentity === 'function') applyUserIdentity();
}

// Tallies come from one aggregate request, so they stay correct even though
// only a page of notifications is loaded.
async function loadSummary() {
    try {
        const res = await fetch(`${API_BASE}/notifications/summary`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !data.data) return;
        const s = data.data;
        const card = (cls, num, icon, label) => `
            <div class="notif-summary-card ${cls}">
                <div class="sum-num">${Number(num) || 0}</div>
                <div class="sum-label"><span class="material-symbols-outlined" style="font-size:16px;">${icon}</span> ${label}</div>
            </div>`;
        document.getElementById('notifSummary').innerHTML =
            card('low_stock', s.low_stock, 'inventory_2', 'Low Stock') +
            card('stockout', s.stockout, 'block', 'Out of Stock') +
            card('expiration', s.expiration, 'schedule', 'Expiring') +
            card('info', s.total, 'assignment', 'Total');
    } catch (e) {
        console.error('Error loading summary:', e);
    }
}

function notifQuery() {
    const params = new URLSearchParams();
    const type = document.getElementById('notifTypeFilter').value;
    const status = document.getElementById('notifStatusFilter').value;
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    return params;
}

// reset=true refetches page 1 for the current filters; reset=false appends the
// next page (Show more). Newest first.
async function loadNotifications(reset = true) {
    try {
        if (reset) displayCount = PAGE_SIZE;
        const params = notifQuery();
        params.set('limit', Math.max(displayCount - (reset ? 0 : loadedNotifs.length), PAGE_SIZE));
        params.set('offset', reset ? 0 : loadedNotifs.length);
        const res = await fetch(`${API_BASE}/notifications?${params}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) return;
        loadedNotifs = reset ? (data.data || []) : loadedNotifs.concat(data.data || []);
        notifTotal = data.total ?? loadedNotifs.length;
        renderNotifications();
    } catch (e) {
        console.error('Error loading notifications:', e);
        document.getElementById('notifList').innerHTML = '<div class="empty-state">Failed to load notifications</div>';
    }
}

// Filter changes refetch page 1 from the server.
function applyNotifFilters() {
    loadNotifications();
}

function renderNotifications() {
    const list = document.getElementById('notifList');
    if (loadedNotifs.length === 0) {
        list.innerHTML = '<div class="empty-state">No notifications found</div>';
        updatePagination('notifPagination', { length: notifTotal }, displayCount, 'showMoreNotifications', 'showLessNotifications', PAGE_SIZE);
        return;
    }
    list.innerHTML = loadedNotifs.map(n => `
        <div class="notif-list-item ${n.is_read ? '' : 'unread'}">
            <div class="notif-icon ${n.type}">${getNotifIcon(n.type)}</div>
            <div class="notif-info">
                <div class="notif-title">${escHtml(n.title)}</div>
                <div class="notif-msg">${escHtml(n.message)}</div>
                <div class="notif-time">${formatNotifTime(n.created_at)} ${n.product_name ? '· ' + escHtml(n.product_name) : ''}</div>
            </div>
            <div class="notif-actions">
                ${n.is_read ? '' : `<button onclick="markAsRead(${n.id})" title="Mark as read"><span class="material-symbols-outlined" style="font-size:16px;">check</span></button>`}
            </div>
        </div>
    `).join('');
    updatePagination('notifPagination', { length: notifTotal }, displayCount, 'showMoreNotifications', 'showLessNotifications', PAGE_SIZE);
}

async function showMoreNotifications() {
    displayCount += PAGE_SIZE;
    if (loadedNotifs.length < Math.min(displayCount, notifTotal)) {
        await loadNotifications(false);
    } else {
        renderNotifications();
    }
}

function showLessNotifications() {
    displayCount = 0;
    showMoreNotifications();
}

async function markAsRead(id) {
    try {
        await fetch(`${API_BASE}/notifications/${id}/read`, { method: 'PUT', headers: getAuthHeaders() });
        refreshList();
    } catch (e) {
        showToast('Failed to mark as read', 'error');
    }
}

async function markAllRead() {
    try {
        await fetch(`${API_BASE}/notifications/read-all`, { method: 'PUT', headers: getAuthHeaders() });
        refreshList();
        showToast('All notifications marked as read', 'success');
    } catch (e) {
        showToast('Failed to mark all as read', 'error');
    }
}

// Permanently delete every read notification, so the pile actually shrinks.
// Uses the app's own confirm dialog — this was the last place still calling
// the browser's native confirm(), which ignores the theme and looks like a
// browser warning rather than part of the system.
function clearRead() {
    showConfirmDialog(
        'Clear read notifications',
        'This permanently deletes every notification you have already read. Unread alerts are kept. This cannot be undone.',
        doClearRead,
        'Yes, Clear Them',
        '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">delete_sweep</span>'
    );
}

async function doClearRead() {
    try {
        const res = await fetch(`${API_BASE}/notifications/read`, { method: 'DELETE', headers: getAuthHeaders() });
        const data = await res.json();
        refreshList();
        showSuccessDialog('Notifications cleared',
            data.message || 'Your read notifications have been deleted.',
            { tone: 'danger' });
    } catch (e) {
        showToast('Failed to clear notifications', 'error');
    }
}

function refreshList() {
    return Promise.all([loadSummary(), loadNotifications()]);
}
