let expirationData = null;

window.addEventListener('load', async () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    renderGreeting();
    await loadUserInfo();
    await loadDashboardStats();
    await loadDayBrief();
    await loadNotifications();
    await loadCharts();
    await loadAdvancedMetrics();
    await loadExpirationRisk();
    await loadRecentSales();
    await loadRecentPOs();
    await loadLowStockAlerts();
    watchThemeForCharts();
    if (typeof setInterval !== 'undefined') {
        setInterval(refreshDashboard, 30000);
        setInterval(loadRecentSales, 10000);
    }
});

/* ── Urgency: one number, 0 to 1, that the motion layer reads ─────────────
   Every row that can run out of something computes this from its real
   figure. The CSS turns it into tempo, heat and meter width, so how fast a
   row breathes IS the data — no legend to learn. */

function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n) || 0));
}

/* Expiry is scaled against the 90-day window the dashboard already reports
   on. The curve is deliberately not linear: the difference between 3 days
   and 10 matters enormously to a shopkeeper, while 70 vs 80 does not, so
   urgency climbs steeply only near the end. */
function expiryUrgency(days) {
    if (days === null || days === undefined || isNaN(days)) return 0;
    if (days <= 0) return 1;
    const linear = clamp01(1 - (days / 90));
    // Exponent > 1 spreads the near end apart. A gentler curve made 3 days and
    // 30 days read as 0.98 and 0.80 — visually identical, which would have made
    // the whole signal useless exactly where it matters most.
    return Number(Math.pow(linear, 1.6).toFixed(2));
}

// Motion alone is not an accessible signal, so the same reading is available
// as text on hover and to a screen reader.
function urgencyLabel(u) {
    if (u >= 0.75) return 'Critical — act today';
    if (u >= 0.45) return 'Urgent — act this week';
    if (u >= 0.2) return 'Worth watching';
    return 'No action needed yet';
}

function renderGreeting() {
    const user = getUser();
    const name = (user?.full_name || user?.username || '').trim();
    const first = name.split(' ')[0] || 'there';
    const el = document.getElementById('dashGreeting');
    if (el) el.textContent = first;
    if (typeof applyUserIdentity === 'function') applyUserIdentity();
    const roleEl = document.getElementById('heroRoleChip');
    if (roleEl) roleEl.textContent = roleLabel(user?.role);
    const dateEl = document.getElementById('dateDisplay');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Day brief: replaces the generic greeting sub-line with today's real numbers
let briefAttention = { low: 0, expiring: 0 };

async function loadDayBrief() {
    const el = document.getElementById('dashGreetingSub');
    if (!el) return;
    try {
        const res = await fetch(`${API_BASE}/sales/daily-sales?days=1`, { headers: getAuthHeaders() });
        const json = await res.json();
        const today = new Date();
        const row = (json.data || []).find(r => {
            const d = parseExpiryDate(r.date);
            return d && d.getTime() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        });
        const txns = row ? Number(row.transaction_count) : 0;
        const revenue = row ? Number(row.daily_total) : 0;
        const h = today.getHours();
        const shift = h < 12 ? 'Morning shift' : h < 18 ? 'Afternoon shift' : 'Evening shift';
        const attention = (briefAttention.low || 0) + (briefAttention.expiring || 0);
        const sep = '<span class="brief-sep">·</span>';
        const salesPart = txns > 0
            ? `<strong>${formatNumber(txns)}</strong> sale${txns === 1 ? '' : 's'} rung up${sep}<strong>${formatCurrency(revenue)}</strong> in the till`
            : 'no sales yet — register is warmed up';
        // the count opens what needs attention and what to do about it (UAT part 4, A2)
        const attentionPart = attention > 0
            ? `${sep}<button type="button" class="brief-link" onclick="openAttention()" title="See which items, and what to do"><strong class="brief-alert">${formatNumber(attention)}</strong> item${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention ›</button>`
            : `${sep}shelves looking good`;
        el.innerHTML = `${shift}${sep}${salesPart}${attentionPart}`;
    } catch {
        el.textContent = "Here's what's happening in your pet shop today.";
    }
}

/* What needs attention, opened from the line under your name: the two kinds,
   each with what to do today and a link to its list (UAT part 4, A2/A3). */
function openAttention() {
    const low = briefAttention.low || 0, expiring = briefAttention.expiring || 0;
    const rows = [];
    if (low) rows.push(['Restock needed', `${formatNumber(low)} product${low === 1 ? '' : 's'} at or below the reorder level`, 'warning']);
    if (expiring) rows.push(['Expiring soon', `${formatNumber(expiring)} product${expiring === 1 ? '' : 's'} expire within 30 days`, 'danger']);
    const todo = [];
    if (low) todo.push('Reorder what is low: Inventory → Restock needed → Reorder sends each supplier its order.');
    if (expiring) todo.push('Sell what expires first: put it at the front of the shelf, offer a discount or a bundle, and do not reorder it until it sells.');
    const actions = [];
    if (expiring) actions.push({ label: 'Open expiring products', className: low ? 'btn-secondary' : 'btn-primary', onClick: () => { location.href = 'inventory.html?filter=expiring'; } });
    if (low) actions.push({ label: 'Open restock list', onClick: () => { location.href = 'inventory.html?filter=reorder'; } });
    showDetailsDialog('Items that need attention', `${formatNumber(low + expiring)} in all. Here is what to do today.`, rows,
        { icon: 'priority_high', tone: expiring ? 'danger' : 'warning', items: { title: 'Act today', list: todo }, actions });
}

/* "Act today": a line at the top of a list that has something urgent in it,
   saying what to do about it and where (UAT part 4, A3). */
function actTodayHtml(text, button, onclick) {
    return `<div class="act-today" role="note"><span class="material-symbols-outlined" aria-hidden="true">bolt</span>
        <div><strong>Act today.</strong> ${text}</div>
        ${button ? `<button type="button" class="btn-secondary" onclick="${onclick}">${button}</button>` : ''}</div>`;
}

/* What to do about one product by how soon it expires */
function expiryAdvice(days) {
    if (days == null) return '';
    if (days < 0) return 'Take it off the shelf';
    if (days <= 7) return 'Sell today: discount it';
    if (days <= 30) return 'Put it in front, discount or bundle';
    return 'Keep an eye on it';
}

async function loadUserInfo() {
    const user = getUser();
    if (!user) return;
    const nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = user.full_name || user.username || user.email;
    if (typeof applyUserIdentity === 'function') applyUserIdentity();
}

function kpiCard(label, icon, iconClass, value, foot, valueColor) {
    return `<div class="kpi-card">
        <div class="kpi-top">
            <span class="kpi-label">${label}</span>
            <span class="kpi-icon ${iconClass}"><span class="material-symbols-outlined">${icon}</span></span>
        </div>
        <div class="kpi-value"${valueColor ? ` style="color:${valueColor};"` : ''}>${value}</div>
        <div class="kpi-foot">${foot}</div>
    </div>`;
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/stats`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const s = data.data;
            const low = s.low_stock_count ?? 0;
            const expiring = s.expiring_count ?? 0;
            briefAttention = { low, expiring };
            document.getElementById('metricCards').innerHTML =
                kpiCard('Total products', 'inventory_2', 'blue',
                    formatNumber(s.total_products ?? 0),
                    `<span class="trend-pill up">▲ ${formatNumber(s.active_products ?? 0)}</span> active`) +
                kpiCard('Total revenue', 'payments', 'coral',
                    `<span title="${formatCurrency(s.total_sales_amount ?? 0)}">${formatCompactCurrency(s.total_sales_amount ?? 0)}</span>`,
                    `${formatNumber(s.total_sales ?? 0)} sale${Number(s.total_sales) === 1 ? '' : 's'}` + (Number(s.voided_sales) > 0 ? `, ${formatNumber(s.voided_sales)} more voided` : '')) +
                kpiCard('Restock needed', 'warning', 'amber',
                    formatNumber(low),
                    low > 0 ? '<span class="trend-pill down">Needs attention</span>' : '<span class="trend-pill up">All good</span>',
                    low > 0 ? 'var(--warning)' : null) +
                kpiCard('Expiring soon', 'schedule', 'red',
                    formatNumber(expiring),
                    'Within 30 days',
                    expiring > 0 ? 'var(--danger)' : null) +
                kpiCard('Inventory value', 'account_balance', 'green',
                    '<span id="inventoryValue">—</span>',
                    'Retail estimate');
        }
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

async function loadAdvancedMetrics() {
    try {
        // the server adds up the stock value; fetching every product just to
        // add it here made the Dashboard the slowest page (speed fix, 3 Nov)
        const statRes = await fetch(`${API_BASE}/products/stats`, { headers: getAuthHeaders() }).then(r => r.json());
        const totalRetail = Number(statRes.data && statRes.data.total_value) || 0;
        const valueEl = document.getElementById('inventoryValue');
        if (valueEl) {
            valueEl.textContent = formatCompactCurrency(totalRetail);
            valueEl.title = formatCurrency(totalRetail);
        }
    } catch (e) {
        console.error('Error loading advanced metrics:', e);
    }
}

async function loadNotifications() {
    try {
        const response = await fetch(`${API_BASE}/notifications/count`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            const count = data.data.count || 0;
            const el = document.getElementById('alertCount');
            if (el) el.textContent = count;
            const chip = document.getElementById('alertChip');
            if (chip) chip.classList.toggle('has-alerts', count > 0);
            const el2 = document.getElementById('notifBadge');
            if (el2) {
                el2.textContent = count;
                el2.style.display = count > 0 ? 'flex' : 'none';
                if (count > 0) el2.classList.add('has-alerts');
                else el2.classList.remove('has-alerts');
            }
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

/* ── Live / Offline connection status ──
   "Live" is backed by the 10-second Recent Sales poll: a successful poll marks
   the dashboard Live, a failed poll (server down, no internet) marks it Offline.
   Browser online/offline events flip it immediately without waiting for a poll. */
let liveState = null;
let liveSince = Date.now();   // when the current Live or Offline spell began
let lastPollAt = null;        // last time the server answered

function setLiveStatus(ok) {
    if (ok) lastPollAt = Date.now();
    if (liveState === ok) return;
    liveState = ok;
    liveSince = Date.now();
    renderLivePopover();
    const chip = document.getElementById('liveChip');
    const chipText = document.getElementById('liveChipText');
    if (chip) {
        chip.classList.toggle('offline', !ok);
        chip.title = ok ? 'See how long you\'ve been online' : 'Connection lost — data may be out of date. Click for details';
    }
    if (chipText) chipText.textContent = ok ? 'Live' : 'Offline';
    const status = document.getElementById('recentSalesLiveStatus');
    if (status) {
        status.textContent = ok ? 'Live' : 'Offline';
        status.style.color = ok ? 'var(--success)' : 'var(--danger)';
    }
    const dot = document.getElementById('recentSalesLiveDot');
    if (dot) {
        dot.style.background = ok ? 'var(--success)' : 'var(--danger)';
        dot.style.animation = ok ? '' : 'none';
    }
}

/* The Live chip, opened: how long this screen has been online, when you
   signed in and when the server last answered. It ticks every second while
   open. */
let livePopoverTimer = null;

function formatSpan(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s === 1 ? '1 second' : `${s} seconds`;
    const m = Math.floor(s / 60);
    if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`;
    const h = Math.floor(m / 60), rest = m % 60;
    const hours = h === 1 ? '1 hour' : `${h} hours`;
    return rest ? `${hours} ${rest} min` : hours;
}

// Saved at sign-in; older sessions fall back to the token's issue time.
function signedInAt() {
    const saved = Number(sessionStorage.getItem('signedInAt') || localStorage.getItem('signedInAt'));
    if (saved) return saved;
    try {
        const part = (getToken() || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const iat = JSON.parse(atob(part)).iat;
        return iat ? iat * 1000 : null;
    } catch (e) { return null; }
}

function renderLivePopover() {
    const pop = document.getElementById('livePopover');
    if (!pop) return;
    const now = Date.now();
    const ok = liveState !== false;
    const signed = signedInAt();
    const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    pop.classList.toggle('offline', !ok);
    pop.innerHTML = `
        <div class="live-pop-head">
            <span class="pulse-dot"></span>
            <div>
                <b>${ok ? 'Connected' : 'Offline'}</b>
                <span>${ok ? 'This page is getting new data from the shop server.' : 'The shop server is not answering. What you see may be out of date.'}</span>
            </div>
        </div>
        <div class="live-pop-rows">
            <div><span>${ok ? 'Online for' : 'Offline for'}</span><b>${formatSpan(now - liveSince)}</b></div>
            <div><span>${ok ? 'Online since' : 'Offline since'}</span><b>${clock(liveSince)}</b></div>
            ${signed ? `<div><span>Signed in</span><b>${clock(signed)} · ${formatSpan(now - signed)} ago</b></div>` : ''}
            <div><span>Last update</span><b>${lastPollAt ? formatSpan(now - lastPollAt) + ' ago' : 'Waiting…'}</b></div>
        </div>
        <p class="live-pop-note">Recent sales update every 10 seconds; the figures every 30 seconds.</p>`;
}

function toggleLivePopover(anchor) {
    if (document.getElementById('livePopover')) { closeLivePopover(); return; }
    const pop = document.createElement('div');
    pop.id = 'livePopover';
    pop.className = 'live-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Connection');
    document.body.appendChild(pop);
    renderLivePopover();
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.left = Math.round(Math.min(Math.max(12, r.left), window.innerWidth - pop.offsetWidth - 12)) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    livePopoverTimer = setInterval(renderLivePopover, 1000);
    setTimeout(() => {
        document.addEventListener('click', closeLiveOutside);
        document.addEventListener('keydown', closeLiveOnEsc);
    }, 10);
}

function closeLivePopover() {
    document.getElementById('livePopover')?.remove();
    document.getElementById('liveChip')?.setAttribute('aria-expanded', 'false');
    clearInterval(livePopoverTimer);
    document.removeEventListener('click', closeLiveOutside);
    document.removeEventListener('keydown', closeLiveOnEsc);
}

function closeLiveOutside(e) {
    const pop = document.getElementById('livePopover');
    const chip = document.getElementById('liveChip');
    if (pop && !pop.contains(e.target) && !(chip && chip.contains(e.target))) closeLivePopover();
}

function closeLiveOnEsc(e) {
    if (e.key === 'Escape') closeLivePopover();
}

window.addEventListener('resize', closeLivePopover);

window.addEventListener('offline', () => setLiveStatus(false));
window.addEventListener('online', () => { setLiveStatus(true); loadRecentSales(); });

let dashSalesDisplayCount = 5;
let recentSalesSeenIds = new Set();
// What a sale's payment_status is called on screen.
const SALE_STATES = { completed: 'Completed', pending: 'Pending', voided: 'Voided', failed: 'Failed' };

async function loadRecentSales() {
    try {
        const response = await fetch(`${API_BASE}/sales?limit=20`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        setLiveStatus(true);
        const list = document.getElementById('recentSalesList');
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        let items = (data.data || []).filter(function(s) {
            return s.created_at && new Date(s.created_at) >= threeDaysAgo;
        });
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">No activity in the last 3 days</div>';
            document.getElementById('recentSalesPagination').innerHTML = '';
            return;
        }
        const existingIds = new Set();
        list.querySelectorAll('.timeline-item').forEach(el => {
            if (el.dataset.saleId) existingIds.add(el.dataset.saleId);
        });
        const newItems = items.filter(s => !existingIds.has(String(s.id)) && !recentSalesSeenIds.has(String(s.id)));
        newItems.forEach(s => recentSalesSeenIds.add(String(s.id)));
        const newCount = newItems.length;
        const limited = items.slice(0, dashSalesDisplayCount);
        list.innerHTML = limited.map((s, i) => {
            const isNew = i < newCount;
            // The server sends a sale's state as payment_status. This read
            // "status", which is never sent, so every sale said completed.
            const state = SALE_STATES[s.payment_status] ? s.payment_status : 'other';
            const avatarClass = state === 'completed' ? '' : state;
            return `<div class="timeline-item${state === 'voided' ? ' is-voided' : ''}" data-sale-id="${s.id}"${isNew ? ' style="animation:feed-slide-in 0.35s ease;"' : ''}>
                <div class="timeline-avatar ${avatarClass}"><span class="material-symbols-outlined" style="font-size:17px;">receipt_long</span></div>
                <div class="timeline-content">
                    <div class="timeline-title">#${s.id} — ${escHtml(s.customer_name || 'Walk-in')}</div>
                    <div class="timeline-sub">${s.created_at ? formatTime(s.created_at) : ''}</div>
                </div>
                <div class="timeline-right">
                    <div class="timeline-value">${formatCurrency(s.final_amount ?? s.total_amount ?? 0)}</div>
                    <div class="timeline-status ${state}">${SALE_STATES[state] || escHtml(s.payment_status || 'the server gave no reason')}</div>
                </div>
            </div>`;
        }).join('');
        updatePagination('recentSalesPagination', items, dashSalesDisplayCount, 'showMoreDashSales', 'showLessDashSales', 5);
        if (newCount > 0) {
            const status = document.getElementById('recentSalesLiveStatus');
            if (status) status.textContent = `${newCount} new`;
            setTimeout(() => {
                const s = document.getElementById('recentSalesLiveStatus');
                if (s && liveState) s.textContent = 'Live';
            }, 3000);
        }
    } catch (e) {
        // Network failure or server error — flag Offline but keep showing the
        // last data we had instead of wiping the list.
        setLiveStatus(false);
        const list = document.getElementById('recentSalesList');
        if (list && !list.querySelector('.timeline-item')) {
            list.innerHTML = '<div class="empty-state">Can\'t reach the server — retrying every 10 seconds…</div>';
        }
    }
}

function showMoreDashSales() {
    dashSalesDisplayCount += 5;
    loadRecentSales();
}

function showLessDashSales() {
    // one page back, mirroring Show more (it used to jump to the first page)
    dashSalesDisplayCount = Math.max(0, dashSalesDisplayCount - 10);
    showMoreDashSales();
}

// PO lifecycle: pending -> confirmed -> shipped -> received (server-enforced)
function poNextStep(status) {
    switch (status) {
        // an order the supplier offered waits for the shop to accept it
        case 'proposed': return { status: 'confirmed', label: 'Confirm offer', icon: 'check', title: 'Accept the supplier\'s offer: it becomes a confirmed order', offer: true };
        case 'pending': return { status: 'confirmed', label: 'Confirm', icon: 'check', title: 'Supplier confirmed this order' };
        case 'confirmed': return { status: 'shipped', label: 'Shipped', icon: 'local_shipping', title: 'Supplier has shipped the order' };
        case 'shipped': return { status: 'received', label: 'Receive', icon: 'inventory', title: 'Goods arrived — adds the ordered items to stock' };
        default: return null;
    }
}

function advancePO(id, nextStatus, poNumber, offer) {
    if (offer) {
        const po = (window.recentPOs || []).find(o => o.id === id) || {};
        showConfirmDialog('Confirm this offer',
            `Offered by <strong>${escHtml(po.supplier_name || 'the supplier')}</strong>. Accepting it makes ${escHtml(poNumber)} a confirmed order for ${formatCurrency(po.total_amount || 0)}. The supplier then ships it.`,
            () => sendPOAdvance(id, 'confirmed', poNumber, ''), 'Confirm offer',
            '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">check_circle</span>');
        return;
    }
    // Receiving prompts for the new batch's expiry so a refreshed product
    // (even a previously expired one) gets an up-to-date expiration date.
    if (nextStatus === 'received') {
        showPromptDialog(
            `Receive ${escHtml(poNumber)}`,
            'Stock will be added. Enter the new batch\'s expiration date:',
            (dateVal) => sendPOAdvance(id, 'received', poNumber, dateVal),
            'Mark Received',
            '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">inventory</span>',
            'date', '', { min: earliestExpiryYmd(), validate: expiryDateProblem, hint: 'Leave it blank only to keep a current date that has not passed yet.' }
        );
        return;
    }
    const messages = {
        confirmed: `Mark ${poNumber} as confirmed by the supplier?`,
        shipped: `Mark ${poNumber} as shipped?`
    };
    showConfirmDialog('Update purchase order', messages[nextStatus] || 'Advance this order?', () => sendPOAdvance(id, nextStatus, poNumber, ''), nextStatus === 'shipped' ? 'Mark shipped' : 'Mark confirmed', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">local_shipping</span>');
}

async function sendPOAdvance(id, nextStatus, poNumber, expiration_date) {
    {
        try {
            const body = { status: nextStatus };
            if (expiration_date) body.expiration_date = expiration_date;
            const res = await fetch(`${API_BASE}/purchase-orders/${id}/status`, {
                method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.success) {
                const notes = {
                    confirmed: `${poNumber} is confirmed. Mark it Shipped when the supplier dispatches it.`,
                    shipped: `${poNumber} is on its way — mark it Received when the goods arrive.`,
                    received: expiration_date
                        ? `${poNumber} received — stock added and expiration updated to ${expiration_date}.`
                        : `${poNumber} received — the ordered items were added to stock.`
                };
                showSuccessDialog('Order updated', notes[nextStatus], { icon: nextStatus === 'received' ? 'inventory' : 'local_shipping' });
                await loadRecentPOs();
                if (typeof loadDashboardStats === 'function') await loadDashboardStats();
            } else {
                showErrorDialog('Could not update order', data.message || 'the server gave no reason');
            }
        } catch (e) {
            showToast(couldNot('update purchase order', e), 'error');
        }
    }
}

async function loadRecentPOs() {
    try {
        const response = await fetch(`${API_BASE}/purchase-orders?limit=5`, { headers: getAuthHeaders() });   // only the five it shows
        const data = await response.json();
        const list = document.getElementById('recentPOList');
        const items = data.data || [];
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">No purchase orders yet</div>';
            return;
        }
        window.recentPOs = items;
        list.innerHTML = items.slice(0, 5).map(po => {
            const next = poNextStep(po.status);
            const actionBtn = (next && canManage())
                ? `<button class="po-advance-btn" onclick="advancePO(${po.id}, '${next.status}', '${escHtml(po.po_number || 'PO#' + po.id)}'${next.offer ? ', true' : ''})" title="${next.title}"><span class="material-symbols-outlined" style="font-size:14px;">${next.icon}</span> ${next.label}</button>`
                : '';
            return `<div class="dash-item po-item">
                <div class="item-info">
                    <div class="item-name">${escHtml(po.po_number) || 'PO#' + po.id}</div>
                    <div class="item-sub">${escHtml(po.supplier_name) || 'Supplier #' + po.supplier_id}</div>
                </div>
                <div class="item-right">
                    <div class="item-value">${formatCurrency(po.total_amount || 0)}</div>
                    ${actionBtn ? `<div style="display:flex;justify-content:flex-end;margin-top:4px;">${actionBtn}</div>` : ''}
                </div>
                ${poProgressHtml(po.status)}
            </div>`;
        }).join('');
    } catch (e) {
        document.getElementById('recentPOList').innerHTML = '<div class="empty-state">Failed to load</div>';
    }
}

async function loadLowStockAlerts() {
    try {
        const response = await fetch(`${API_BASE}/products/low-stock`, { headers: getAuthHeaders() });
        const data = await response.json();
        const list = document.getElementById('lowStockList');
        const items = data.data || [];
        if (!items.length) {
            list.innerHTML = '<div class="empty-state">All products are well-stocked</div>';
            return;
        }
        const out = items.filter(p => Number(p.stock_quantity) <= 0).length;
        const head = actTodayHtml(out
            ? `${formatNumber(out)} product${out === 1 ? ' is' : 's are'} out of stock and ${formatNumber(items.length - out)} ${items.length - out === 1 ? 'is' : 'are'} low. Reorder them now so the shelves are full again.`
            : `${formatNumber(items.length)} product${items.length === 1 ? ' is' : 's are'} low. Reorder before they run out.`,
            'Reorder now', "location.href='inventory.html?filter=reorder'");
        list.innerHTML = head + items.slice(0, 5).map(p => {
            const stock = p.stock_quantity ?? 0;
            const reorder = p.reorder_level ?? 10;
            const fillPct = Math.min(100, Math.round((stock / Math.max(reorder, 1)) * 100));
            const barClass = stock === 0 ? 'danger' : fillPct < 30 ? 'danger' : 'warning';
            // Empty shelf is maximum urgency; at or above the reorder level there
            // is nothing to shout about yet.
            const urgency = clamp01(1 - (stock / Math.max(reorder, 1)));
            return `<div class="stock-bar-item urg" style="--urgency:${urgency.toFixed(2)}" title="${urgencyLabel(urgency)}">
                <div class="stock-bar-info">
                    <div class="stock-bar-name">${escHtml(p.name)}</div>
                    <div class="stock-bar-sub">SKU: ${escHtml(p.sku || 'N/A')} · Reorder: ${formatNumber(reorder)}</div>
                </div>
                <div class="stock-bar-track">
                    <div class="stock-bar-fill ${barClass}" style="width:${Math.max(4, fillPct)}%"></div>
                </div>
                <div class="stock-bar-num" style="color:${stock === 0 ? 'var(--danger)' : 'var(--warning)'}">${formatNumber(stock)}</div>
                <span class="urg-meter" aria-hidden="true"></span>
            </div>`;
        }).join('');
    } catch (e) {
        document.getElementById('lowStockList').innerHTML = '<div class="empty-state">Failed to load</div>';
    }
}

/* ── Charts ── */
let salesChartInstance = null;
let categoryChartInstance = null;
let lastChartData = null;

function chartTheme() {
    const css = getComputedStyle(document.documentElement);
    return {
        text: css.getPropertyValue('--text-muted').trim() || '#8A94A8',
        grid: css.getPropertyValue('--border-subtle').trim() || '#F0F3F8',
        card: css.getPropertyValue('--bg-card').trim() || '#FFFFFF',
        line: css.getPropertyValue('--chart-1').trim() || '#2A63AD',
        fill: (css.getPropertyValue('--chart-1-soft').trim() || '#BCCCE4') + '40'
    };
}

// Categories need distinct hues, but muted ones: the chart should not
// out-shout the figures beside it.
const CHART_PALETTE = ['#0D96E6', '#E3202B', '#FFC21A', '#12A37B', '#7C5CC4', '#F28A1F', '#5A6E82', '#7CCBF7'];

async function loadCharts() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/charts`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            lastChartData = data.data;
            renderSalesTrendChart(data.data.sales || data.data);
            renderInventoryChart(data.data.category_breakdown);
        }
    } catch (error) {
        console.error('Error loading chart data:', error);
    }
}

function renderSalesTrendChart(data) {
    const canvas = document.getElementById('salesChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (salesChartInstance) salesChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const theme = chartTheme();
    const items = (Array.isArray(data) ? [...data] : []).sort((a, b) =>
        new Date(a.date || a.sale_date || a.created_at) - new Date(b.date || b.sale_date || b.created_at));
    const labels = items.map(d => {
        const dt = new Date(d.date || d.sale_date || d.created_at);
        return isNaN(dt.getTime()) ? (d.label || '') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = items.map(d => parseFloat(d.daily_total || d.total_amount || d.total || d.value || 0));
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{
                label: 'Revenue (₱)',
                data: values.length ? values : [0],
                borderColor: theme.line,
                backgroundColor: theme.fill,
                fill: true,
                tension: 0.2,
                borderWidth: 1.75,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointBackgroundColor: theme.line,
                pointBorderColor: theme.card,
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: theme.text, font: { size: 11 }, maxTicksLimit: 8 }, grid: { display: false }, border: { display: false } },
                y: { beginAtZero: true, ticks: { color: theme.text, font: { size: 11 }, maxTicksLimit: 6 }, grid: { color: theme.grid }, border: { display: false } }
            }
        }
    });
}

function renderInventoryChart(categories) {
    const canvas = document.getElementById('categoryChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (categoryChartInstance) categoryChartInstance.destroy();
    const ctx = canvas.getContext('2d');
    const theme = chartTheme();
    const items = Array.isArray(categories) && categories.length ? categories : [{ label: 'No data', value: 1 }];
    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: items.map(c => c.label || c.name || 'N/A'),
            datasets: [{
                data: items.map(c => c.value || c.count || 1),
                backgroundColor: CHART_PALETTE.slice(0, items.length),
                borderColor: theme.card,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: theme.text, font: { size: 11 }, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 12 }
                }
            }
        }
    });
}

function watchThemeForCharts() {
    const observer = new MutationObserver(() => {
        if (lastChartData) {
            renderSalesTrendChart(lastChartData.sales || lastChartData);
            renderInventoryChart(lastChartData.category_breakdown);
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

async function refreshDashboard() {
    await loadDashboardStats();
    await loadDayBrief();
    await loadAdvancedMetrics();
    await loadNotifications();
    await loadExpirationRisk();
    await loadRecentSales();
    await loadRecentPOs();
    await loadLowStockAlerts();
}

// expiration_date may arrive as 'YYYY-MM-DD' or a UTC ISO datetime — convert to
// local time first, then strip to the local calendar day
function parseExpiryDate(raw) {
    if (!raw) return null;
    const s = String(raw);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysFromToday(date) {
    if (!date) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((date - today) / 86400000);
}

async function loadExpirationRisk() {
    try {
        const response = await fetch(`${API_BASE}/dashboard/expiration-risk`, { headers: getAuthHeaders() });
        const data = await response.json();
        if (data.success && data.data) {
            expirationData = data.data;
            const grid = document.getElementById('expiryGrid');
            grid.innerHTML = `
                <div class="expiry-radar-card critical is-clickcard" role="button" tabindex="0" onclick="showExpirationProducts('critical')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
                    <div class="radar-num">${data.data.critical.count}</div>
                    <div class="radar-label">Within 30 days</div>
                    <span class="click-hint">View list</span>
                </div>
                <div class="expiry-radar-card warning is-clickcard" role="button" tabindex="0" onclick="showExpirationProducts('warning')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
                    <div class="radar-num">${data.data.warning.count}</div>
                    <div class="radar-label">In 31 to 60 days</div>
                    <span class="click-hint">View list</span>
                </div>
                <div class="expiry-radar-card notice is-clickcard" role="button" tabindex="0" onclick="showExpirationProducts('notice')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
                    <div class="radar-num">${data.data.notice.count}</div>
                    <div class="radar-label">In 61 to 90 days</div>
                    <span class="click-hint">View list</span>
                </div>
            `;
            // something expires within 30 days: say what to do (UAT part 4, A3)
            const critical = Number(data.data.critical.count) || 0;
            document.getElementById('expiryActToday')?.remove();
            if (critical) {
                grid.insertAdjacentHTML('afterend', `<div id="expiryActToday">${actTodayHtml(
                    `${formatNumber(critical)} product${critical === 1 ? ' expires' : 's expire'} within 30 days. Put ${critical === 1 ? 'it' : 'them'} at the front of the shelf, offer a discount or bundle, and do not reorder until ${critical === 1 ? 'it sells' : 'they sell'}.`,
                    'See which', "showExpirationProducts('critical')")}</div>`);
            }
            const productList = document.getElementById('expiryProductList');
            const allExpiring = [...(data.data.critical.products || []), ...(data.data.warning.products || []), ...(data.data.notice.products || [])].slice(0, 5);
            if (allExpiring.length > 0) {
                productList.innerHTML = allExpiring.map(p => {
                    const exp = parseExpiryDate(p.expiration_date);
                    const days = p.days_until_expiry ?? daysFromToday(exp);
                    const daysClass = days !== null && days <= 30 ? 'danger' : days !== null && days <= 60 ? 'warning' : 'info';
                    const urgency = expiryUrgency(days);
                    return `<div class="product-expiry-item urg" style="--urgency:${urgency}" title="${urgencyLabel(urgency)}">
                        <div class="pei-info">
                            <div class="pei-name">${escHtml(p.name)}</div>
                            <div class="pei-sub">Expires ${exp ? exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'} · Stock: ${formatNumber(p.stock_quantity || 0)}</div>
                            ${days !== null && days <= 30 ? `<div class="pei-advice ${daysClass}">${expiryAdvice(days)}</div>` : ''}
                        </div>
                        <div class="pei-days ${daysClass}">${days !== null ? days + ' days' : '—'}</div>
                        <span class="urg-meter" aria-hidden="true"></span>
                    </div>`;
                }).join('');
            } else {
                productList.innerHTML = '';
            }
        }
    } catch (error) {
        console.error('Error loading expiration risk:', error);
    }
}

function showExpirationProducts(riskLevel) {
    if (!expirationData || !expirationData[riskLevel]) return;
    const group = expirationData[riskLevel];
    const labels = { critical: 'Expiring within 30 days', warning: 'Expiring in 31 to 60 days', notice: 'Expiring in 61 to 90 days' };
    document.getElementById('expirationModalTitle').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">schedule</span> ' + labels[riskLevel] + ' (' + group.count + ' product(s))';
    const body = document.getElementById('expirationModalBody');
    if (!group.products.length) {
        body.innerHTML = '<div class="empty-state">No products in this range</div>';
    } else {
        body.innerHTML = (riskLevel === 'critical' ? actTodayHtml('Put these at the front of the shelf, offer a discount or bundle, and do not reorder them until they sell. Anything 7 days or less from its date: sell it today.') : '')
            + group.products.map(p => {
            const exp = parseExpiryDate(p.expiration_date);
            const days = p.days_until_expiry ?? daysFromToday(exp);
            return `
            <div class="details-row">
                <span class="details-label">${escHtml(p.name)}${riskLevel === 'critical' ? `<small class="pei-advice danger" style="display:block;">${expiryAdvice(days)}</small>` : ''}</span>
                <span class="details-value" style="color:${riskLevel === 'critical' ? 'var(--danger)' : riskLevel === 'warning' ? 'var(--warning)' : 'var(--info)'};font-weight:600;">${exp ? exp.toLocaleDateString() : 'N/A'} · ${formatNumber(p.stock_quantity || 0)} qty</span>
            </div>
        `;
        }).join('');
    }
    document.getElementById('expirationModal').classList.add('active');
}

function closeExpirationModal() {
    document.getElementById('expirationModal').classList.remove('active');
}

function navigateTo(page) {
    window.location.href = page;
}

function formatTime(t) {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('expirationModal')) closeExpirationModal();
});
