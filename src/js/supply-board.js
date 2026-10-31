/* Suppliers → Orders and Price changes. Everything between the shop and its
   suppliers that still needs someone: offers to answer, orders on their way
   and deliveries not yet paid for (Orders), and prices a supplier wants to
   change (Price changes, a tab of its own).

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
        if (o.status === 'proposed') return '<button class="btn-primary" data-act="accept" data-id="' + id + '">Confirm order</button>'
            + '<button class="btn-secondary" data-act="cancel" data-id="' + id + '">Decline</button>' + notes;
        if (o.status === 'pending') return '<button class="btn-secondary" data-act="confirmed" data-id="' + id + '">Mark confirmed</button>'
            + '<button class="btn-secondary" data-act="cancel" data-id="' + id + '">Cancel order</button>' + notes;
        if (o.status === 'confirmed') return '<button class="btn-secondary" data-act="shipped" data-id="' + id + '">Mark shipped</button>'
            + '<button class="btn-secondary" data-act="cancel" data-id="' + id + '">Cancel order</button>' + notes;
        return '<button class="btn-primary" data-act="received" data-id="' + id + '">Receive into stock</button>' + notes;
    }

    // every order and offer shows where it is, like the Dashboard (js/po-progress.js)
    var ON_THE_ROAD = ['proposed', 'pending', 'confirmed', 'shipped', 'received'];

    function card(o) {
        var s = STATUS[o.status] || { text: o.status, tone: 'ok' };
        var id = Number(o.id);
        return '<div class="sp-order">'
            + '<div class="sp-order-head"><span class="sp-order-title">' + escHtml(o.po_number) + ' · ' + escHtml(o.supplier_name || 'Unknown supplier')
            + '<span class="rp-badge rp-badge-' + s.tone + '">' + escHtml(s.text) + '</span></span>'
            + '<span class="sp-order-total">' + formatCurrency(o.total_amount) + '</span></div>'
            + (ON_THE_ROAD.indexOf(o.status) !== -1 ? poProgressHtml(o.status) : '')
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

        // The badges count what is waiting on the shop, not everything in motion.
        var late = moving.filter(function (o) { return o.promised_date && o.promised_date < todayYmd(); }).length;
        var needs = offers.length + late;
        var badge = document.getElementById('deliveriesBadge');
        // the number says what it counts (see the title for the parts)
        if (badge) {
            badge.textContent = needs + ' to do';
            badge.title = [offers.length && offers.length + ' offer(s) to answer', late && late + ' delivery date(s) passed'].filter(Boolean).join(', ');
            badge.style.display = needs ? '' : 'none';
        }
        var priceBadge = document.getElementById('pricesBadge');
        if (priceBadge) {
            priceBadge.textContent = prices.length + ' to decide';
            priceBadge.title = prices.length + ' price change(s) to accept or decline';
            priceBadge.style.display = prices.length ? '' : 'none';
        }

        document.getElementById('offersCard').hidden = !offers.length;
        document.getElementById('offersList').innerHTML = offers.map(card).join('');

        document.getElementById('pricesBody').innerHTML = prices.length ? prices.map(function (p) {
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
        }).join('') : '<tr><td colspan="5" class="rp-loading">No price changes waiting. When a supplier proposes a new price, it shows here to accept or decline.</td></tr>';

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

        var paidList = board.paid || [];
        document.getElementById('paidBody').innerHTML = paidList.length ? paidList.map(function (p) {
            return '<tr><td class="rp-strong">' + escHtml(p.po_number) + '</td>'
                + '<td>' + escHtml(p.supplier_name || '—') + '</td>'
                + '<td>' + escHtml(new Date(Number(p.paid_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) + '</td>'
                + '<td>' + escHtml(p.method) + '</td>'
                + '<td class="num rp-strong">' + formatCurrency(p.total_amount) + '</td>'
                + '<td class="num"><button class="btn-view" data-receipt="' + Number(p.id) + '"><span class="material-symbols-outlined" style="font-size:15px;">receipt_long</span> Receipt</button></td></tr>';
        }).join('') : '<tr><td colspan="6" class="rp-loading">No payments recorded yet.</td></tr>';

        Object.keys(openNotes).forEach(function (id) { if (openNotes[id] && document.getElementById('board-notes-' + id)) loadNotes(Number(id)); });
    }

    /* ---------- Payments: how it was paid, and its receipt ---------- */

    async function openReceipt(id) {
        try {
            var res = await fetch(API + '/' + id + '/receipt', { headers: getAuthHeaders() });
            var data = await res.json();
            if (!data.success) { showToast(data.message || 'The receipt could not be opened', 'error'); return; }
            showPaymentReceipt(data.data);
        } catch (e) { showToast(couldNot('open the receipt', e), 'error'); }
    }

    // Mark paid asks how it was paid (and the reference number), then shows the receipt
    function markPaid(id) {
        var po = find(id);
        var methods = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['gcash', 'GCash'], ['check', 'Check']];
        var shell = buildDialogShell('confirmDialogOverlay', 'success', 'payments', 'Mark as paid',
            'Record that ' + escHtml(po ? po.po_number : 'this order') + ' (' + formatCurrency(po ? po.total_amount : 0) + ') has been paid to ' + escHtml(po ? po.supplier_name : 'the supplier') + '. A receipt is made for it.');
        var dialog = shell.dialog, overlay = shell.overlay, method = '';
        dialog.querySelector('.dialog-body').innerHTML =
            '<label class="form-label" style="display:block;text-align:left;margin-top:6px;">How was it paid?</label>'
            + '<div class="pay-method">' + methods.map(function (m) { return '<button type="button" data-method="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>'
            + '<label class="form-label" for="payRef" style="display:block;text-align:left;">Reference number <span id="payRefNote" style="font-weight:500;color:var(--text-muted);">(not needed for cash)</span></label>'
            + '<input id="payRef" class="form-input" type="text" maxlength="80" placeholder="e.g. BDO-2026-10441">'
            + '<div id="payError" role="alert" style="display:none;margin-top:8px;font-size:13px;font-weight:600;color:var(--danger);text-align:left;"></div>';
        dialog.querySelector('.dialog-body').insertAdjacentHTML('afterend', dialogActions('Cancel', 'Mark paid', 'btn-primary'));
        var err = dialog.querySelector('#payError');
        var close = function () { overlay.remove(); };
        dialog.querySelector('.pay-method').addEventListener('click', function (e) {
            var b = e.target.closest('button[data-method]');
            if (!b) return;
            method = b.dataset.method;
            dialog.querySelectorAll('.pay-method button').forEach(function (x) { x.classList.toggle('active', x === b); });
            dialog.querySelector('#payRefNote').textContent = method === 'cash' ? '(not needed for cash)' : method === 'check' ? '(the check number)' : '(needed)';
            err.style.display = 'none';
        });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        dialog.querySelector('#confirmCancelBtn').addEventListener('click', close);
        dialog.querySelector('#confirmOkBtn').addEventListener('click', async function () {
            var ref = dialog.querySelector('#payRef').value.trim();
            // the same rule as the server's (utils/supply.js paymentProblem)
            var problem = !method ? 'Choose how it was paid: Cash, Bank transfer, GCash or Check.'
                : method !== 'cash' && !ref ? 'Enter the ' + (method === 'check' ? 'check' : 'reference') + ' number, so it is on the receipt.'
                : ref && !/^[A-Za-z0-9 \-\/#.]+$/.test(ref) ? 'The reference number can have letters, numbers, spaces and - / # . only.' : null;
            if (problem) { err.textContent = problem; err.style.display = 'block'; return; }
            try {
                var res = await fetch(API + '/' + id + '/payment', { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ paid: true, method: method, reference: ref }) });
                var data = await res.json();
                if (!data.success) { err.textContent = data.message || 'Not saved'; err.style.display = 'block'; return; }
                close();
                refresh(false);
                if (data.data) showPaymentReceipt(data.data);
            } catch (e2) { err.textContent = 'That could not be saved. Try again.'; err.style.display = 'block'; }
        });
    }

    /* ---------- Actions ---------- */

    function find(id) { return (board.orders || []).filter(function (o) { return Number(o.id) === Number(id); })[0]; }

    async function setStatus(id, status, extra) {
        var body = Object.assign({ status: status }, extra || {});
        if (await send('PUT', '/' + id + '/status', body)) refresh(false);
    }

    function onAction(e) {
        var receipt = e.target.closest('button[data-receipt]');
        if (receipt) { openReceipt(Number(receipt.dataset.receipt)); return; }
        var paid = e.target.closest('button[data-paid]');
        if (paid) { markPaid(Number(paid.dataset.paid)); return; }
        var price = e.target.closest('button[data-price]');
        if (price) {
            var pp = '/price-proposals/' + Number(price.dataset.price) + '/decide';
            if (price.dataset.approve === '1') {
                showConfirmDialog('Accept this price', 'The product\'s cost in inventory changes to the proposed price.',
                    async function () { if (await send('POST', pp, { approve: true })) refresh(false); }, 'Accept price');
            } else {
                // the supplier reads the reason on their portal (same rule as the server's)
                showPromptDialog('Decline this price', 'The price stays as it is. Say why, so the supplier knows: they will see this.',
                    async function (reason) { if (await send('POST', pp, { approve: false, reason: reason.trim() })) refresh(false); },
                    'Decline', '<span class="material-symbols-outlined" style="color:var(--danger);">cancel</span>', 'text', '', {
                        maxLength: 300,
                        placeholder: 'e.g. Too high compared with other suppliers',
                        validate: function (v) {
                            var t = v.trim();
                            if (!t) return 'Type why you are declining this price. The supplier will see it.';
                            if (t.length < 3 || !/[A-Za-z]/.test(t)) return 'Write the reason in words, like "Too high compared with other suppliers".';
                            return null;
                        }
                    });
            }
            return;
        }
        var btn = e.target.closest('button[data-act]');
        if (!btn) return;
        var id = Number(btn.dataset.id), act = btn.dataset.act, o = find(id);
        if (!o) return;
        var name = escHtml(o.po_number);
        if (act === 'notes') { toggleNotes(id); return; }
        if (act === 'accept') {
            showConfirmDialog('Confirm this order', 'This accepts ' + escHtml(o.supplier_name || 'the supplier') + '\'s offer: ' + name + ' becomes a confirmed order for ' + formatCurrency(o.total_amount) + '.',
                function () { setStatus(id, 'confirmed'); }, 'Confirm order');
        } else if (act === 'cancel') {
            showConfirmDialog(o.status === 'proposed' ? 'Decline this offer' : 'Cancel this order', name + ' will be marked cancelled. This cannot be undone.',
                function () { setStatus(id, 'cancelled'); }, o.status === 'proposed' ? 'Decline' : 'Cancel order',
                '<span class="material-symbols-outlined" style="color:var(--danger);">cancel</span>');
        } else if (act === 'received') {
            var short = (o.items || []).some(function (i) { return i.confirmed_quantity != null && Number(i.confirmed_quantity) < Number(i.quantity); });
            var today = localTodayYmd();
            var expired = (o.items || []).filter(function (i) { return i.expires && i.expires < today; });
            var named = expired.map(function (i) { return '<strong>' + escHtml(i.name) + '</strong> (expired ' + escHtml(i.expires) + ')'; }).join(', ');
            showPromptDialog('Receive ' + name,
                (short ? 'The supplier sent less than ordered on some lines; only what they confirmed is added to stock. ' : 'The items are added to stock. ')
                + (expired.length
                    ? named + (expired.length === 1 ? ' has' : ' have') + ' already expired. The expired stock will be removed and replaced by the new batch. Enter the new batch\'s expiration date:'
                    : 'Enter the new batch\'s expiration date:'),
                function (dateVal) { setStatus(id, 'received', dateVal ? { expiration_date: dateVal } : null); },
                'Receive into stock', null, 'date', '', { min: earliestExpiryYmd(), hint: expired.length ? '' : 'Leave it blank to keep the current one.', validate: function (v) {
                    if (!v && expired.length) return 'Enter the new batch\'s expiration date: the current one has already passed.';
                    return expiryDateProblem(v);
                } });
        } else if (act === 'confirmed' || act === 'shipped') {
            showConfirmDialog('Update order', 'Mark ' + name + ' as ' + act + '? Use this when the supplier told you by phone or message rather than through their own login.',
                function () { setStatus(id, act); }, act === 'shipped' ? 'Mark shipped' : 'Mark confirmed');
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
        var id = Number(form.dataset.noteFor), input = form.querySelector('input'), btn = form.querySelector('button');
        var body = input.value.trim();
        // one press, one note: Send is locked until the note is saved
        if (!body || form.dataset.sending) return;
        form.dataset.sending = '1'; btn.disabled = true; input.readOnly = true; btn.textContent = 'Sending…';
        var ok = await send('POST', '/' + id + '/messages', { body: body });
        delete form.dataset.sending; btn.disabled = false; input.readOnly = false; btn.textContent = 'Send';
        if (ok) {
            var o = find(id);
            if (o) o.message_count = Number(o.message_count || 0) + 1;
            loadNotes(id);
        }
    }

    /* ---------- View toggle: supplier list, orders, price changes ---------- */

    var PANELS = { deliveries: 'deliveriesPanel', prices: 'pricesPanel' };

    function setView(view) {
        var table = document.getElementById('supplierTableWrap');
        var pager = document.getElementById('supplierPagination');
        if (!table) return;
        if (!PANELS[view]) view = 'list';
        Object.keys(PANELS).forEach(function (v) {
            var p = document.getElementById(PANELS[v]);
            if (p) p.style.display = v === view ? '' : 'none';
        });
        var isBoard = view !== 'list';
        table.style.display = isBoard ? 'none' : '';
        if (pager) pager.style.display = isBoard ? 'none' : '';
        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            var on = b.dataset.view === view;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
        visible = isBoard;
        if (isBoard) { refresh(false); startPolling(); } else stopPolling();
    }

    window.refreshDeliveries = refresh;

    window.addEventListener('load', function () {
        if (!document.getElementById('deliveriesPanel')) return;
        Object.keys(PANELS).forEach(function (v) {
            var p = document.getElementById(PANELS[v]);
            if (!p) return;
            p.addEventListener('click', onAction);
            p.addEventListener('submit', onNote);
        });
        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            b.addEventListener('click', function () { setView(b.dataset.view); });
        });
        var saved = 'list';
        try { saved = localStorage.getItem(VIEW_KEY) || 'list'; } catch (e) {}
        var asked = new URLSearchParams(window.location.search).get('view');
        if (asked === 'orders') saved = 'deliveries';
        if (asked === 'prices') saved = 'prices';
        setView(saved);
        // one early fetch so the badge is right even from the list view
        setTimeout(function () { refresh(false); }, 700);
    });
})();
