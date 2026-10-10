/* Suppliers → Orders. Everything between the shop and its suppliers that
   still needs someone: offers to answer, price changes to decide, orders on
   their way, and deliveries not yet paid for.

   This took the place of the live delivery map. Instead of watching a
   driver's phone, the shop reads what the supplier has told it — the date
   they promised, any line they cannot fill, and the receipt number. */
(function () {
    'use strict';

    var API = API_BASE + '/purchase-orders';
    var VIEW_KEY = 'supplierView';
    var POLL_MS = 30000;
    var board = { orders: [], price_proposals: [] };
    var visible = false;
    var timer = null;
    var openNotes = {};

    var STATUS = {
        proposed: { text: 'Offered by the supplier', tone: 'warning' },
        pending: { text: 'Waiting for the supplier to confirm', tone: 'warning' },
        confirmed: { text: 'Confirmed — not shipped yet', tone: 'ok' },
        shipped: { text: 'On its way', tone: 'ok' }
    };

    function manages() { return typeof canManage === 'function' && canManage(); }

    function todayYmd() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function niceDay(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
        if (!m) return '';
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    async function send(method, path, body) {
        try {
            var res = await fetch(API + path, { method: method, headers: getAuthHeaders(), body: JSON.stringify(body || {}) });
            var data = await res.json();
            if (!data.success) { showToast(data.message || 'That could not be saved', 'error'); return false; }
            if (data.message) showToast(data.message, 'success');
            return true;
        } catch (e) {
            console.error('Order update failed:', e);
            showToast('That could not be saved', 'error');
            return false;
        }
    }

    /* ---------- Data ---------- */

    async function refresh(announce) {
        try {
            var res = await fetch(API + '/deliveries', { headers: getAuthHeaders() });
            var data = await res.json();
            if (!data.success) throw new Error(data.message || 'failed');
            board = data.data;
            render();
            if (announce) showToast('Orders refreshed', 'success');
        } catch (e) {
            console.error('Orders board failed to load:', e);
            var list = document.getElementById('deliveriesList');
            if (list && visible) list.innerHTML = '<p class="rp-loading">Orders could not be loaded. Press Refresh to try again.</p>';
        }
    }

    function startPolling() { stopPolling(); timer = setInterval(function () { if (!document.hidden) refresh(false); }, POLL_MS); }
    function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

    /* ---------- Rendering ---------- */

    function facts(o) {
        var parts = [];
        if (o.order_date) parts.push('Ordered ' + escHtml(niceDay(o.order_date)));
        if (o.expected_delivery_date && !o.proposed_by_supplier) parts.push('you asked for it by ' + escHtml(niceDay(o.expected_delivery_date)));
        var line = parts.join(', ');
        if (o.promised_date) {
            var late = (o.status === 'confirmed' || o.status === 'shipped') && o.promised_date < todayYmd();
            line += '<br>' + (o.status === 'proposed' ? 'They could deliver on ' : 'Supplier says it arrives on ')
                + '<strong>' + escHtml(niceDay(o.promised_date)) + '</strong>'
                + (late ? ' <span class="sp-late">— late</span>' : '')
                + (o.promise_note ? ' (' + escHtml(o.promise_note) + ')' : '');
        } else if (o.status === 'pending') {
            line += '<br>' + (o.supplier_has_login
                ? 'No delivery date yet — the supplier gives one when they confirm.'
                : 'This supplier has no login, so update the order here when you hear from them.');
        }
        if (o.delivery_ref) line += '<br>Delivery receipt: <strong>' + escHtml(o.delivery_ref) + '</strong>';
        if (o.notes && o.proposed_by_supplier) line += '<br>' + escHtml(o.notes);
        if (o.supplier_phone) line += '<br>Supplier phone: ' + escHtml(o.supplier_phone);
        return line;
    }

    function lines(o) {
        return (o.items || []).map(function (i) {
            var sending = i.confirmed_quantity == null ? Number(i.quantity) : Number(i.confirmed_quantity);
            var short = i.confirmed_quantity != null && sending < Number(i.quantity);
            return '<div class="sp-line"><span>' + escHtml(i.name) + '</span><span class="' + (short ? 'sp-short' : '') + '">'
                + (short ? formatQty(sending) + ' of ' + formatQty(i.quantity) + ' — supplier is short' : formatQty(i.quantity))
                + '</span></div>';
        }).join('');
    }

    function actions(o) {
        var id = Number(o.id);
        var notes = '<button class="btn-secondary" data-act="notes" data-id="' + id + '">Notes' + (Number(o.message_count) ? ' (' + Number(o.message_count) + ')' : '') + '</button>';
        // reading an order's notes is for administrators and managers (the server refuses anyone else)
        if (!manages()) return '';
        if (o.status === 'proposed') return '<button class="btn-primary" data-act="accept" data-id="' + id + '">Accept offer</button>'
            + '<button class="btn-secondary" data-act="cancel" data-id="' + id + '">Decline</button>' + notes;
        if (o.status === 'pending') return '<button class="btn-secondary" data-act="confirmed" data-id="' + id + '">Mark confirmed</button>'
            + '<button class="btn-secondary" data-act="cancel" data-id="' + id + '">Cancel order</button>' + notes;
        if (o.status === 'confirmed') return '<button class="btn-secondary" data-act="shipped" data-id="' + id + '">Mark shipped</button>'
            + '<button class="btn-secondary" data-act="cancel" data-id="' + id + '">Cancel order</button>' + notes;
        return '<button class="btn-primary" data-act="received" data-id="' + id + '">Receive into stock</button>' + notes;
    }

    function card(o) {
        var s = STATUS[o.status] || { text: o.status, tone: 'ok' };
        var id = Number(o.id);
        return '<div class="sp-order">'
            + '<div class="sp-order-head"><span class="sp-order-title">' + escHtml(o.po_number) + ' · ' + escHtml(o.supplier_name || 'Unknown supplier')
            + '<span class="rp-badge rp-badge-' + s.tone + '">' + escHtml(s.text) + '</span></span>'
            + '<span class="sp-order-total">' + formatCurrency(o.total_amount) + '</span></div>'
            + '<div class="sp-order-facts">' + facts(o) + '</div>'
            + '<div class="sp-lines">' + lines(o) + '</div>'
            + '<div class="sp-order-actions">' + actions(o) + '</div>'
            + '<div class="sp-notes" id="board-notes-' + id + '"' + (openNotes[id] ? '' : ' hidden') + '></div>'
            + '</div>';
    }

    function render() {
        var orders = board.orders || [];
        var offers = orders.filter(function (o) { return o.status === 'proposed'; });
        var moving = orders.filter(function (o) { return o.status === 'pending' || o.status === 'confirmed' || o.status === 'shipped'; });
        var unpaid = orders.filter(function (o) { return o.status === 'received'; });
        var prices = board.price_proposals || [];

        // The badge counts what is waiting on the shop, not everything in motion.
        var late = moving.filter(function (o) { return o.promised_date && o.promised_date < todayYmd(); }).length;
        var needs = offers.length + prices.length + late;
        var badge = document.getElementById('deliveriesBadge');
        if (badge) { badge.textContent = needs; badge.style.display = needs ? '' : 'none'; }

        document.getElementById('offersCard').hidden = !offers.length;
        document.getElementById('offersList').innerHTML = offers.map(card).join('');

        document.getElementById('pricesCard').hidden = !prices.length;
        document.getElementById('pricesBody').innerHTML = prices.map(function (p) {
            var now = p.live_price != null ? Number(p.live_price) : null, next = Number(p.proposed_price);
            var change = now ? Math.round((next - now) / now * 1000) / 10 : null;
            return '<tr><td><span class="rp-strong">' + escHtml(p.product_name) + '</span>'
                + '<span class="rp-sub">' + escHtml(p.sku || '') + (p.note ? ' · ' + escHtml(p.note) : '') + '</span></td>'
                + '<td>' + escHtml(p.supplier_name) + '</td>'
                + '<td class="num">' + (now != null ? formatCurrency(now) : '—') + '</td>'
                + '<td class="num rp-strong">' + formatCurrency(next)
                + (change != null ? '<span class="rp-sub">' + (change > 0 ? '+' : '') + change + '%, you sell it at ' + formatCurrency(p.selling_price) + '</span>' : '') + '</td>'
                + '<td class="num">' + (manages()
                    ? '<button class="btn-view" data-price="' + Number(p.id) + '" data-approve="1">Accept</button> <button class="btn-view" data-price="' + Number(p.id) + '" data-approve="0">Decline</button>'
                    : '') + '</td></tr>';
        }).join('');

        document.getElementById('deliveriesList').innerHTML = moving.length
            ? moving.map(card).join('')
            : '<p class="rp-loading">Nothing is on order right now.</p>';

        var today = todayYmd();
        document.getElementById('unpaidBody').innerHTML = unpaid.length ? unpaid.map(function (o) {
            return '<tr><td class="rp-strong">' + escHtml(o.po_number) + (o.delivery_ref ? '<span class="rp-sub">Receipt ' + escHtml(o.delivery_ref) + '</span>' : '') + '</td>'
                + '<td>' + escHtml(o.supplier_name || '—') + '</td>'
                + '<td>' + (o.received_day ? escHtml(niceDay(o.received_day)) : '—') + '</td>'
                + '<td>' + (o.payment_due ? escHtml(niceDay(o.payment_due)) + (o.payment_due < today ? ' <span class="sp-late">overdue</span>' : '')
                    : escHtml(o.payment_terms || 'No terms set')) + '</td>'
                + '<td class="num rp-strong">' + formatCurrency(o.total_amount) + '</td>'
                + '<td class="num">' + (manages() ? '<button class="btn-view" data-paid="' + Number(o.id) + '">Mark paid</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="rp-loading">Every delivered order has been paid.</td></tr>';

        Object.keys(openNotes).forEach(function (id) { if (openNotes[id] && document.getElementById('board-notes-' + id)) loadNotes(Number(id)); });
    }

    /* ---------- Actions ---------- */

    function find(id) { return (board.orders || []).filter(function (o) { return Number(o.id) === Number(id); })[0]; }

    async function setStatus(id, status, extra) {
        var body = Object.assign({ status: status }, extra || {});
        if (await send('PUT', '/' + id + '/status', body)) refresh(false);
    }

    function onAction(e) {
        var paid = e.target.closest('button[data-paid]');
        if (paid) {
            var pid = Number(paid.dataset.paid), po = find(pid);
            showConfirmDialog('Mark as paid', 'Record that ' + escHtml(po ? po.po_number : 'this order') + ' has been paid to the supplier?', async function () {
                if (await send('PUT', '/' + pid + '/payment', { paid: true })) refresh(false);
            }, 'Mark paid');
            return;
        }
        var price = e.target.closest('button[data-price]');
        if (price) {
            var approve = price.dataset.approve === '1';
            showConfirmDialog(approve ? 'Accept this price' : 'Decline this price',
                approve ? 'The product\'s cost in inventory changes to the proposed price.' : 'The price stays as it is and the supplier is not charged anything new.',
                async function () { if (await send('POST', '/price-proposals/' + Number(price.dataset.price) + '/decide', { approve: approve })) refresh(false); },
                approve ? 'Accept price' : 'Decline');
            return;
        }
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        var id = Number(btn.dataset.id), act = btn.dataset.act, o = find(id);
        if (!o) return;
        var name = escHtml(o.po_number);
        if (act === 'notes') { toggleNotes(id); return; }
        if (act === 'accept') {
            showConfirmDialog('Accept this offer', name + ' becomes a confirmed order from ' + escHtml(o.supplier_name || 'the supplier') + ' for ' + formatCurrency(o.total_amount) + '.',
                function () { setStatus(id, 'confirmed'); }, 'Accept offer');
        } else if (act === 'cancel') {
            showConfirmDialog(o.status === 'proposed' ? 'Decline this offer' : 'Cancel this order', name + ' will be marked cancelled. This cannot be undone.',
                function () { setStatus(id, 'cancelled'); }, o.status === 'proposed' ? 'Decline' : 'Cancel order',
                '<span class="material-symbols-outlined" style="color:var(--danger);">cancel</span>');
        } else if (act === 'received') {
            var short = (o.items || []).some(function (i) { return i.confirmed_quantity != null && Number(i.confirmed_quantity) < Number(i.quantity); });
            showPromptDialog('Receive ' + name,
                (short ? 'The supplier sent less than ordered on some lines; only what they confirmed is added to stock. ' : 'The items are added to stock. ')
                + 'Enter the new batch\'s expiration date, or leave it blank to keep the current one:',
                function (dateVal) { setStatus(id, 'received', dateVal ? { expiration_date: dateVal } : null); },
                'Receive into stock', null, 'date', '');
        } else if (act === 'confirmed' || act === 'shipped') {
            showConfirmDialog('Update order', 'Mark ' + name + ' as ' + act + '? Use this when the supplier told you by phone or message rather than through their own login.',
                function () { setStatus(id, act); }, 'Yes, update');
        }
    }

    /* ---------- Notes ---------- */

    function toggleNotes(id) {
        var box = document.getElementById('board-notes-' + id);
        if (!box) return;
        openNotes[id] = !openNotes[id];
        box.hidden = !openNotes[id];
        if (openNotes[id]) loadNotes(id);
    }

    async function loadNotes(id) {
        var box = document.getElementById('board-notes-' + id);
        if (!box) return;
        try {
            var res = await fetch(API + '/' + id + '/messages', { headers: getAuthHeaders() });
            var data = await res.json();
            if (!data.success) throw new Error('failed');
            box.innerHTML = (data.data.length ? data.data.map(function (n) {
                return '<div class="sp-note"><span class="sp-note-meta">' + escHtml((n.author || 'Someone') + (n.from_supplier ? ' (supplier)' : '')) + ' · '
                    + escHtml(new Date(Number(n.created_at)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</span>'
                    + escHtml(n.body) + '</div>';
            }).join('') : '<p class="sp-form-hint" style="margin:0;">No notes on this order yet.</p>')
                + (manages() ? '<form class="sp-note-form" data-note-for="' + id + '"><input type="text" class="form-input" maxlength="1000" placeholder="Write a note to the supplier" aria-label="Note to the supplier" required><button type="submit" class="btn-secondary">Send</button></form>' : '');
        } catch (e) {
            box.innerHTML = '<p class="sp-form-hint" style="margin:0;">Notes could not be loaded.</p>';
        }
    }

    async function onNote(e) {
        var form = e.target.closest('form[data-note-for]');
        if (!form) return;
        e.preventDefault();
        var id = Number(form.dataset.noteFor), body = form.querySelector('input').value.trim();
        if (!body) return;
        if (await send('POST', '/' + id + '/messages', { body: body })) {
            var o = find(id);
            if (o) o.message_count = Number(o.message_count || 0) + 1;
            loadNotes(id);
        }
    }

    /* ---------- View toggle: supplier list vs orders ---------- */

    function setView(view) {
        var panel = document.getElementById('deliveriesPanel');
        var table = document.getElementById('supplierTableWrap');
        var pager = document.getElementById('supplierPagination');
        if (!panel || !table) return;
        var isOrders = view === 'deliveries';
        panel.style.display = isOrders ? '' : 'none';
        table.style.display = isOrders ? 'none' : '';
        if (pager) pager.style.display = isOrders ? 'none' : '';
        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            var on = b.dataset.view === view;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
        visible = isOrders;
        if (isOrders) { refresh(false); startPolling(); } else stopPolling();
    }

    window.refreshDeliveries = refresh;

    window.addEventListener('load', function () {
        var panel = document.getElementById('deliveriesPanel');
        if (!panel) return;
        panel.addEventListener('click', onAction);
        panel.addEventListener('submit', onNote);
        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            b.addEventListener('click', function () { setView(b.dataset.view); });
        });
        var saved = 'list';
        try { saved = localStorage.getItem(VIEW_KEY) || 'list'; } catch (e) {}
        if (new URLSearchParams(window.location.search).get('view') === 'orders') saved = 'deliveries';
        setView(saved === 'deliveries' ? 'deliveries' : 'list');
        // one early fetch so the badge is right even from the list view
        setTimeout(function () { refresh(false); }, 700);
    });
})();
