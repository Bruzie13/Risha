const PAGE_SIZE = 10;
let displayCount = PAGE_SIZE;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    await triggerAlertChecks();
    await loadUserInfo();
    await loadSummary();
    await loadNotifications();
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

async function loadSummary() {
    try {
        const res = await fetch(`${API_BASE}/notifications`, { headers: getAuthHeaders() });
        const data = await res.json();
        const notifs = data.data || [];

        const counts = { low_stock: 0, stockout: 0, expiration: 0, info: 0 };
        notifs.forEach(n => {
            if (counts[n.type] !== undefined) counts[n.type]++;
            else counts.info++;
        });

        document.getElementById('notifSummary').innerHTML = `
            <div class="notif-summary-card low_stock">
                <div class="sum-num">${counts.low_stock}</div>
                <div class="sum-label"><span class="material-symbols-outlined" style="font-size:16px;">inventory_2</span> Low Stock</div>
            </div>
            <div class="notif-summary-card stockout">
                <div class="sum-num">${counts.stockout}</div>
                <div class="sum-label"><span class="material-symbols-outlined" style="font-size:16px;">block</span> Out of Stock</div>
            </div>
            <div class="notif-summary-card expiration">
                <div class="sum-num">${counts.expiration}</div>
                <div class="sum-label"><span class="material-symbols-outlined" style="font-size:16px;">schedule</span> Expiring</div>
            </div>
            <div class="notif-summary-card info">
                <div class="sum-num">${notifs.length}</div>
                <div class="sum-label"><span class="material-symbols-outlined" style="font-size:16px;">assignment</span> Total</div>
            </div>
        `;
    } catch (e) {
        console.error('Error loading summary:', e);
    }
}

let cachedNotifs = [];

async function loadNotifications() {
    displayCount = PAGE_SIZE;
    const typeFilter = document.getElementById('notifTypeFilter').value;
    const statusFilter = document.getElementById('notifStatusFilter').value;

    try {
        let url = `${API_BASE}/notifications?limit=200`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        const data = await res.json();
        let notifs = data.data || [];

        if (typeFilter) {
            notifs = notifs.filter(n => n.type === typeFilter);
        }
        if (statusFilter === 'unread') {
            notifs = notifs.filter(n => !n.is_read);
        } else if (statusFilter === 'read') {
            notifs = notifs.filter(n => n.is_read);
        }

        cachedNotifs = notifs;
        renderNotifications();
    } catch (e) {
        console.error('Error loading notifications:', e);
        document.getElementById('notifList').innerHTML = '<div class="empty-state">Failed to load notifications</div>';
    }
}

function renderNotifications() {
    const list = document.getElementById('notifList');
    const shown = cachedNotifs.slice(0, displayCount);

    if (shown.length === 0) {
        list.innerHTML = '<div class="empty-state">No notifications found</div>';
        updatePagination('notifPagination', cachedNotifs, displayCount, 'showMoreNotifications');
        return;
    }

    list.innerHTML = shown.map(n => `
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
    updatePagination('notifPagination', cachedNotifs, displayCount, 'showMoreNotifications');
}

function showMoreNotifications() {
    displayCount += PAGE_SIZE;
    renderNotifications();
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

function refreshList() {
    displayCount = PAGE_SIZE;
    loadSummary();
    loadNotifications();
}
