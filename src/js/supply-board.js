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
        // the supplier's status, when it is not plain Active (UAT part 4, A6)
        if (o.supplier_status && o.supplier_status !== 'active') {
            line += '<br><span class="sp-late">' + escHtml(o.supplier_name || 'The supplier') + ' is '
                + ({ vacation: 'on vacation', inactive: 'marked inactive', deactivated: 'deactivated' }[o.supplier_status] || o.supplier_status) + '.</span>';
        }
        return line;
    }

    function lines(o) {
        // a heading says what the list is (Carlo, 3 Nov: "walang label na yan pala products")
        var items = o.items || [];
        if (!items.length) return '';
        return '<div class="sp-line sp-line-head"><span>Products (' + items.length + ')</span><span>Quantity</span></div>' + items.map(function (i) {
            var sending = i.confirmed_quantity == null ? Number(i.quantity) : Number(i.confirmed_quantity);
            var short = i.confirmed_quantity != null && sending < Number(i.quantity);
            return '<div class="sp-line"><span>' + escHtml(i.name) + '</span><span class="' + (short ? 'sp-short' : '') + '">'
                + (short ? formatQty(sending) + ' of ' + formatQty(i.quantity) + ' — supplier is short' : formatQty(i.quantity))
                + '</span></div>';
        }).join('');
    }

    function actions(o) {
        var id = Number(o.id);
        // a receipt is for a payment, so it is in Paid, not on an order still open (UAT part 4, A7)
        var notes = '<button class="btn-secondary" data-act="notes" data-id="' + id + '">Notes' + (Number(o.message_count) ? ' (' + Number(o.message_count) + ')' : '') + '</button>';
        // reading an order's notes is for administrators and managers (the server refuses anyone else)
        if (!manages()) return '';
        if (o.status === 'proposed') return '<button class="btn-primary" data-act="accept" data-id="' + id + '">Confirm offer</button>'
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
        var newBadge = document.getElementById('newProductsBadge');
        if (newBadge) {
            var waiting = Number(board.new_products_waiting) || 0;
            newBadge.textContent = waiting + ' to decide';
            newBadge.title = waiting + ' new product(s) offered by suppliers';
            newBadge.style.display = waiting ? '' : 'none';
        }
        var priceBadge = document.getElementById('pricesBadge');
        if (priceBadge) {
            priceBadge.textContent = prices.length + ' to decide';
            priceBadge.title = prices.length + ' price change(s) to accept or decline';
            priceBadge.style.display = prices.length ? '' : 'none';
        }

        document.getElementById('offersCard').hidden = !offers.length;
        document.getElementById('offersList').innerHTML = offers.map(card).join('');

        var cancelled = board.cancelled_offers || [];
        document.getElementById('cancelledCard').hidden = !cancelled.length;
        document.getElementById('cancelledBody').innerHTML = cancelled.map(function (c) {
            return '<tr><td class="rp-strong">' + escHtml(c.po_number) + '<span class="rp-sub">' + formatNumber(c.line_count) + ' product' + (Number(c.line_count) === 1 ? '' : 's') + '</span></td>'
                + '<td>' + escHtml(c.supplier_name || '—') + '</td>'
                + '<td>' + escHtml(niceDay(c.cancelled_day)) + '</td>'
                + '<td>' + (c.cancelled_by_supplier ? '<span class="rp-badge rp-badge-warning">Supplier took it back</span>' : '<span class="rp-badge rp-badge-danger">You declined it</span>')
                + (c.cancel_note ? '<span class="rp-sub">' + escHtml(c.cancel_note) + '</span>' : '') + '</td>'
                + '<td class="num rp-strong">' + formatCurrency(c.total_amount) + '</td></tr>';
        }).join('');

        document.getElementById('pricesBody').innerHTML = prices.length ? prices.map(function (p) {
            var now = p.live_price != null ? Number(p.live_price) : null, next = Number(p.proposed_price);
            var change = now ? Math.round((next - now) / now * 1000) / 10 : null;
            // the product opens to the details behind the change (UAT part 4, A11)
            return '<tr class="is-clickrow" data-price-details="' + Number(p.id) + '" title="See the details"><td><button type="button" class="link-btn rp-strong" data-price-details="' + Number(p.id) + '">' + escHtml(p.product_name) + ' ›</button>'
                + '<span class="rp-sub">' + escHtml(p.sku || '') + (p.note ? ' · ' + escHtml(p.note) : '') + '</span></td>'
                + '<td>' + escHtml(p.supplier_name) + '</td>'
                + '<td class="num">' + (now != null ? formatCurrency(now) : '—') + '</td>'
                + '<td class="num rp-strong">' + formatCurrency(next)
                + (change != null ? '<span class="rp-sub">' + (change > 0 ? '+' : '') + change + '%, you sell it at ' + formatCurrency(p.selling_price) + '</span>' : '') + '</td>'
                + '<td class="num">' + (manages()
                    ? '<button class="btn-view" data-price-details="' + Number(p.id) + '">Details</button> <button class="btn-view" data-price="' + Number(p.id) + '" data-approve="1">Accept</button> <button class="btn-view" data-price="' + Number(p.id) + '" data-approve="0">Decline</button>'
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
        var details = e.target.closest('[data-price-details]');
        if (details && !e.target.closest('button[data-price]')) { openPriceDetails(Number(details.dataset.priceDetails)); return; }
        var np = e.target.closest('button[data-new]');
        if (np) { newProductAction(Number(np.dataset.new), np.dataset.do); return; }
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
        if (act === 'receipt') { openOrderReceipt('/purchase-orders/' + id + '/order-receipt'); return; }
        if (act === 'accept') {
            // Confirm offer names the supplier who made it and what they offered (UAT part 4, A8/A9)
            var standing = { vacation: 'On vacation', inactive: 'Inactive', deactivated: 'Deactivated' }[o.supplier_status] || 'Active';
            showDetailsDialog('Confirm offer ' + o.po_number + '?',
                'Accepting it makes it a confirmed order. ' + (o.supplier_name || 'The supplier') + ' then ships it.', [
                    ['Offered by', o.supplier_name || 'Unknown supplier'],
                    ['Contact person', o.supplier_contact || 'Not given'],
                    ['Phone', o.supplier_phone || 'Not given'],
                    ['Email', o.supplier_email || 'Not given'],
                    ['Supplier status', standing, standing === 'Active' ? null : 'warning'],
                    ['Offered on', niceDay(o.order_date)],
                    ['Could deliver on', o.promised_date ? niceDay(o.promised_date) : 'Not given'],
                    ['Their note', o.proposed_by_supplier && o.notes ? o.notes : null],
                    ['Total', formatCurrency(o.total_amount)]
                ], {
                    icon: 'handshake',
                    items: { title: 'What they offered', list: (o.items || []).map(function (i) { return formatQty(i.quantity) + ' × ' + i.name; }) },
                    actions: [{ label: 'Confirm offer', onClick: function () { setStatus(id, 'confirmed'); } }]
                });
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

    /* ---------- A price change, opened (UAT part 4, A11) ---------- */

    async function openPriceDetails(id) {
        var d;
        try {
            var res = await fetch(API + '/price-proposals/' + id, { headers: getAuthHeaders() });
            var data = await res.json();
            if (!data.success) { showToast(data.message || 'The details could not be opened', 'error'); return; }
            d = data.data;
        } catch (e) { showToast(couldNot('open the details', e), 'error'); return; }
        var now = d.live_price != null ? Number(d.live_price) : null, next = Number(d.proposed_price), sell = Number(d.selling_price);
        var pct = function (a, b) { return b ? Math.round((b - a) / b * 1000) / 10 + '%' : '—'; };
        var change = now ? Math.round((next - now) / now * 1000) / 10 : null;
        var when = function (ms) { return ms ? new Date(Number(ms)).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
        var past = (d.history || []).map(function (h) {
            return when(h.at).replace(/,\s[^,]*$/, '') + ': ' + formatCurrency(h.proposed_price) + ' ' + ({ approved: 'accepted', rejected: 'declined', cancelled: 'taken back by the supplier' }[h.status] || h.status)
                + (h.decline_reason ? ' (' + h.decline_reason + ')' : '');
        });
        var waiting = d.status === 'pending' && manages();
        showDetailsDialog(d.product_name, (d.sku ? d.sku + ' · ' : '') + (d.category || '') + (d.brand ? ' · ' + d.brand : ''), [
            ['Supplier', d.supplier_name],
            ['Contact', [d.contact_person, d.phone, d.email].filter(Boolean).join(' · ')],
            ['Proposed by', d.proposed_by],
            ['Sent', when(d.created_at)],
            ['Pays now', now != null ? formatCurrency(now) : 'Not set'],
            ['Proposed', formatCurrency(next) + (change != null ? ' (' + (change > 0 ? '+' : '') + change + '%)' : ''), change > 0 ? 'danger' : change < 0 ? 'success' : null],
            ['Sells at', formatCurrency(sell)],
            ['Margin now', now != null ? formatCurrency(sell - now) + ' a unit (' + pct(now, sell) + ')' : '—'],
            ['Margin after', formatCurrency(sell - next) + ' a unit (' + pct(next, sell) + ')', sell - next <= 0 ? 'danger' : null],
            ['In stock', formatQty(d.stock_quantity) + ' (reorder level ' + formatQty(d.reorder_level) + ')'],
            ['Sold, last 30 days', formatQty(d.sold_30d) + ' units'],
            ['Their reason', d.note || 'None given'],
            ['Status', { pending: 'Waiting for you', approved: 'Accepted', rejected: 'Declined', cancelled: 'Taken back by the supplier' }[d.status] || d.status]
        ], {
            icon: 'sell',
            items: past.length ? { title: 'Earlier price changes for this product', list: past } : null,
            actions: waiting ? [
                { label: 'Decline', className: 'btn-secondary', onClick: function () { var b = document.querySelector('#pricesBody button[data-price="' + id + '"][data-approve="0"]'); if (b) b.click(); } },
                { label: 'Accept', onClick: function () { var b = document.querySelector('#pricesBody button[data-price="' + id + '"][data-approve="1"]'); if (b) b.click(); } }
            ] : []
        });
    }

    /* ---------- New products offered by suppliers (UAT part 4) ---------- */

    var newProducts = [];
    var NEW_STATUS = {
        pending: ['Waiting for you', 'warning'], added: ['Added to Inventory', 'ok'],
        declined: ['Declined', 'danger'], cancelled: ['Taken back by the supplier', 'muted']
    };

    async function loadNewProducts() {
        var body = document.getElementById('newProductsBody');
        try {
            var res = await fetch(API + '/new-products', { headers: getAuthHeaders() });
            var data = await res.json();
            if (!data.success) throw new Error(data.message || 'failed');
            newProducts = data.data || [];
        } catch (e) {
            body.innerHTML = '<tr><td colspan="6" class="rp-loading">New products could not be loaded. Try again in a moment.</td></tr>';
            return;
        }
        if (!newProducts.length) {
            body.innerHTML = '<tr><td colspan="6" class="rp-loading">No new products offered. When a supplier offers one the shop does not sell yet, it shows here.</td></tr>';
            return;
        }
        body.innerHTML = newProducts.map(function (o) {
            var st = NEW_STATUS[o.status] || [o.status, 'ok'];
            var acts = '<button class="btn-view" data-new="' + Number(o.id) + '" data-do="view">Details</button>';
            if (o.status === 'pending' && manages()) {
                acts += ' <button class="btn-view" data-new="' + Number(o.id) + '" data-do="add">Confirm offer</button>'
                    + ' <button class="btn-view" data-new="' + Number(o.id) + '" data-do="decline">Decline</button>';
            }
            return '<tr><td><span class="rp-strong">' + escHtml(o.name) + '</span><span class="rp-sub">' + escHtml([o.brand, o.category, o.species].filter(Boolean).join(' · ')) + '</span></td>'
                + '<td>' + escHtml(o.supplier_name) + '</td>'
                + '<td>' + escHtml(new Date(Number(o.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) + '</td>'
                + '<td class="num rp-strong">' + formatCurrency(o.cost_price) + '</td>'
                + '<td><span class="rp-badge rp-badge-' + st[1] + '">' + escHtml(st[0]) + '</span>' + (o.decline_reason ? '<span class="rp-sub">' + escHtml(o.decline_reason) + '</span>' : '') + '</td>'
                + '<td class="num"><div class="sp-cell-actions">' + acts + '</div></td></tr>';
        }).join('');
    }

    async function newProductAction(id, what) {
        var o = newProducts.filter(function (x) { return Number(x.id) === id; })[0];
        if (!o) return;
        // Confirm offer asks first (Carlo, 5 Nov: named and asked like accepting an order offer); its own button goes on
        if (what === 'go') { window.location.href = 'inventory.html?offer=' + id; return; }
        if (what === 'decline') {
            showPromptDialog('Decline ' + o.name + '?', 'It is not added to Inventory. Say why, so ' + escHtml(o.supplier_name) + ' knows: they will see this.',
                async function (reason) {
                    if (await send('POST', '/new-products/' + id + '/decline', { reason: reason.trim() })) { loadNewProducts(); refresh(false); }
                }, 'Decline', '<span class="material-symbols-outlined" style="color:var(--danger);">cancel</span>', 'text', '', {
                    maxLength: 300, placeholder: 'e.g. We already carry two brands of this',
                    validate: function (v) {
                        var t = v.trim();
                        if (!t) return 'Type why you are declining this product. The supplier will see it.';
                        if (t.length < 3 || !/[A-Za-z]/.test(t)) return 'Write the reason in words, like "We already carry two brands of this".';
                        return null;
                    }
                });
            return;
        }
        // details, with the picture (sent with one offer only)
        var full = o;
        try {
            var res = await fetch(API + '/new-products/' + id, { headers: getAuthHeaders() });
            var data = await res.json();
            if (data.success) full = data.data;
        } catch (e) { /* the list's copy is enough without the picture */ }
        var when = function (ms) { return ms ? new Date(Number(ms)).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
        var st = NEW_STATUS[full.status] || [full.status];
        var confirming = what === 'add';
        showDetailsDialog(confirming ? 'Confirm the offer of ' + full.name + '?' : full.name,
            confirming ? 'Offered by ' + full.supplier_name + '. Confirming adds it to Inventory: the Add product form opens filled in from this offer; set the selling price, category and stock, then save.' : 'Offered by ' + full.supplier_name, [
            ['Status', st[0], full.status === 'declined' ? 'danger' : null],
            ['Brand', full.brand], ['Product type', full.category], ['Pet type', full.species], ['Sold by', full.unit_type],
            ['Their price', formatCurrency(full.cost_price)], ['About it', full.description],
            ['Contact', [full.contact_person, full.supplier_phone, full.supplier_email].filter(Boolean).join(' · ')],
            ['Offered', when(full.created_at)], ['Offered by', full.proposed_by],
            ['Answered', when(full.decided_at)], ['Answered by', full.decided_by], ['Reason', full.decline_reason, 'danger']
        ], {
            icon: 'add_box',
            html: full.image_url ? '<img src="' + escHtml(full.image_url) + '" alt="" class="sp-new-photo">' : '',
            actions: full.status !== 'pending' || !manages() ? []
                : confirming ? [{ label: 'Confirm offer', onClick: function () { newProductAction(id, 'go'); } }]
                : [
                    { label: 'Decline', className: 'btn-secondary', onClick: function () { newProductAction(id, 'decline'); } },
                    { label: 'Confirm offer', onClick: function () { newProductAction(id, 'go'); } }
                ]
        });
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

    var PANELS = { deliveries: 'deliveriesPanel', prices: 'pricesPanel', newproducts: 'newProductsPanel' };

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
        // the Sort menu orders the supplier list only
        var sort = document.getElementById('supplierSort');
        if (sort) sort.style.display = isBoard ? 'none' : '';
        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            var on = b.dataset.view === view;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
        visible = isBoard;
        if (isBoard) { refresh(false); startPolling(); } else stopPolling();
        if (view === 'newproducts') loadNewProducts();
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
        if (asked === 'newproducts') saved = 'newproducts';
        setView(saved);
        // one early fetch so the badge is right even from the list view
        setTimeout(function () { refresh(false); }, 700);
    });
})();
