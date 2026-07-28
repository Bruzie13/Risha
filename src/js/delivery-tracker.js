/* FETCH delivery tracker — is this order moving, or is it stuck?

   Two layers of truth, and the UI never confuses them:

     1. Stage progress, from your own records. Ordered → Confirmed → Shipped →
        Received, with how long the order has sat where it is. This always
        works; it needs nothing from the supplier.

     2. Live position, only when the supplier's driver opens the tracking link
        and taps Allow on their phone. When they haven't, the card says so
        plainly instead of pretending.

   Everything shown here is derived from real timestamps. Nothing is estimated
   or interpolated — if we don't know, it says we don't know. */
(function () {
    'use strict';

    if (!window.location.pathname.includes('suppliers.html')) return;

    var STAGES = [
        { key: 'ordered',   label: 'Ordered',   icon: 'edit_note' },
        { key: 'confirmed', label: 'Confirmed', icon: 'verified' },
        { key: 'shipped',   label: 'Shipped',   icon: 'local_shipping' },
        { key: 'received',  label: 'Received',  icon: 'inventory' }
    ];

    var DAY = 86400000;
    // How long an order may sit in one stage before we call it stalled.
    var STALL_DAYS = { pending: 3, confirmed: 5, shipped: 4 };

    var deliveries = [];
    var pollTimer = null;
    var visible = false;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Number(null) is 0 and Number('') is 0, and 0 is a valid-looking timestamp
    // (1 Jan 1970) — so missing values have to be rejected before conversion,
    // or an order with no shipped_at reports itself as decades in transit.
    function num(v) {
        if (v == null || v === '') return null;
        var n = Number(v);
        return Number.isFinite(n) && n !== 0 ? n : null;
    }

    // MySQL DATE columns arrive as UTC ISO strings; compare calendar days in
    // local time or an order due today reads as due yesterday.
    function startOfLocalDay(value) {
        if (!value) return null;
        var d = new Date(value);
        if (isNaN(d)) return null;
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function ago(ms) {
        if (!ms) return null;
        var diff = Date.now() - ms;
        if (diff < 60000) return 'just now';
        if (diff < 3600000) return Math.round(diff / 60000) + ' min ago';
        if (diff < DAY) return Math.round(diff / 3600000) + 'h ago';
        var days = Math.floor(diff / DAY);
        return days === 1 ? 'yesterday' : days + ' days ago';
    }

    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

    // ── Reading one order ──────────────────────────────────────────────────
    function stageIndex(status) {
        if (status === 'pending') return 0;
        if (status === 'confirmed') return 1;
        if (status === 'shipped') return 2;
        if (status === 'received') return 3;
        return 0;
    }

    // When did the order enter the stage it is in now?
    // Orders that moved before the stage columns existed have no stamp — that
    // is genuinely unknown, so it returns null and the UI drops the duration
    // rather than inventing one from whatever date it can find.
    function stageEnteredAt(d) {
        if (d.status === 'received') return num(d.received_at);
        if (d.status === 'shipped') return num(d.shipped_at);
        if (d.status === 'confirmed') return num(d.confirmed_at);
        // 'pending' is the exception: creating the order *is* entering the stage.
        return num(d.created_at) || startOfLocalDay(d.order_date);
    }

    function readDelivery(d) {
        var idx = stageIndex(d.status);
        var since = stageEnteredAt(d);
        var daysInStage = since == null ? null : Math.floor((Date.now() - since) / DAY);

        var due = startOfLocalDay(d.expected_delivery_date);
        var today = startOfLocalDay(new Date());
        var daysLate = due == null ? null : Math.round((today - due) / DAY);

        var limit = STALL_DAYS[d.status];
        var stalled = daysInStage != null && limit != null && daysInStage >= limit;

        // Live position only counts as live if the link is usable AND a fix
        // arrived recently. An hour-old point is a last known position, not a
        // moving vehicle.
        var liveAt = num(d.live_at);
        var linkUsable = d.tracking_id && !Number(d.tracking_revoked) && !Number(d.tracking_expired);
        var moving = !!(linkUsable && liveAt && (Date.now() - liveAt) < 10 * 60000);

        return {
            raw: d,
            idx: idx,
            since: since,
            daysInStage: daysInStage,
            due: due,
            daysLate: daysLate,
            stalled: stalled,
            linkUsable: !!linkUsable,
            hasLink: !!d.tracking_id,
            liveAt: liveAt,
            moving: moving,
            lat: num(d.live_lat),
            lng: num(d.live_lng)
        };
    }

    // The one-line answer to "is it moving?"
    // `since` is only appended when we actually know how long it has been —
    // never guessed.
    function verdict(v) {
        var howLong = v.daysInStage == null ? '' : ' · ' + plural(v.daysInStage, 'day');

        if (v.moving) return { text: 'Moving now', tone: 'live', icon: 'my_location' };
        if (v.raw.status === 'shipped') {
            return v.stalled
                ? { text: 'In transit · no update for' + howLong.replace(' ·', ''), tone: 'warn', icon: 'help' }
                : { text: 'In transit', tone: 'ok', icon: 'local_shipping' };
        }
        if (v.raw.status === 'confirmed') {
            return v.stalled
                ? { text: 'Not shipped yet' + howLong + ' waiting', tone: 'warn', icon: 'hourglass_top' }
                : { text: 'Supplier is preparing it', tone: 'info', icon: 'inventory_2' };
        }
        return v.stalled
            ? { text: 'Supplier has not confirmed' + howLong, tone: 'bad', icon: 'priority_high' }
            : { text: 'Waiting for the supplier to confirm', tone: 'info', icon: 'schedule' };
    }

    function etaLine(v) {
        if (v.due == null) return '<span class="dt-eta none">No expected date set</span>';
        var when = new Date(v.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        if (v.daysLate > 0) return '<span class="dt-eta late">' + plural(v.daysLate, 'day') + ' late · was due ' + when + '</span>';
        if (v.daysLate === 0) return '<span class="dt-eta today">Due today</span>';
        return '<span class="dt-eta ok">Due ' + when + ' · in ' + plural(-v.daysLate, 'day') + '</span>';
    }

    function railHtml(v) {
        return '<div class="dt-rail">' + STAGES.map(function (s, i) {
            var state = i < v.idx ? 'done' : i === v.idx ? 'now' : 'todo';
            var stamp = '';
            if (i === 0) stamp = num(v.raw.created_at);
            if (i === 1) stamp = num(v.raw.confirmed_at);
            if (i === 2) stamp = num(v.raw.shipped_at);
            if (i === 3) stamp = num(v.raw.received_at);
            var when = stamp ? new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
            return '<div class="dt-step ' + state + '">' +
                '<span class="dt-dot"><span class="material-symbols-outlined">' + s.icon + '</span></span>' +
                '<span class="dt-step-label">' + s.label + '</span>' +
                '<span class="dt-step-when">' + esc(when) + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    function linkControlsHtml(v) {
        var canEdit = typeof canManage === 'function' && canManage();
        if (!canEdit) {
            return v.moving
                ? '<span class="dt-live-note"><span class="material-symbols-outlined">podcasts</span> Driver is sharing their location</span>'
                : '';
        }
        var id = v.raw.id;
        if (v.moving) {
            return '<div class="dt-live-box">' +
                '<span class="dt-live-note live"><span class="dt-live-dot"></span> Driver sharing · last fix ' + esc(ago(v.liveAt)) + '</span>' +
                '<button class="btn-primary dt-btn dt-btn-live" onclick="openLiveTracking(' + id + ', \'' +
                    esc(v.raw.po_number || '').replace(/'/g, "\\'") + '\', \'' +
                    esc(v.raw.supplier_name || '').replace(/'/g, "\\'") + '\')">' +
                    '<span class="material-symbols-outlined" style="font-size:15px;">travel_explore</span> Track live' +
                '</button>' +
                '<button class="btn-secondary dt-btn" onclick="stopDeliveryTracking(' + id + ')">Stop tracking</button>' +
            '</div>';
        }
        if (v.linkUsable) {
            return '<div class="dt-live-box">' +
                '<span class="dt-live-note pending"><span class="material-symbols-outlined">link</span> Link active — waiting for the driver to open it' +
                (v.liveAt ? ' · last seen ' + esc(ago(v.liveAt)) : '') + '</span>' +
                '<button class="btn-secondary dt-btn" onclick="emailDeliveryLink(' + id + ')" title="Email this link to the supplier again">' +
                    '<span class="material-symbols-outlined" style="font-size:15px;">mail</span> Email again' +
                '</button>' +
                '<button class="btn-secondary dt-btn" onclick="copyDeliveryLink(' + id + ')">Copy link</button>' +
                '<button class="btn-secondary dt-btn" onclick="stopDeliveryTracking(' + id + ')">Cancel</button>' +
            '</div>';
        }
        // Emailing is the primary action — a link nobody receives does nothing.
        return '<div class="dt-live-box">' +
            '<button class="btn-secondary dt-btn" onclick="emailDeliveryLink(' + id + ')" title="Creates a private link and emails it to the supplier. Their driver chooses whether to share their location.">' +
                '<span class="material-symbols-outlined" style="font-size:15px;">share_location</span> Ask supplier to share location' +
            '</button>' +
            '<button class="btn-secondary dt-btn" onclick="createDeliveryLink(' + id + ')" title="Just create the link and copy it — send it yourself by message">' +
                '<span class="material-symbols-outlined" style="font-size:15px;">link</span> Copy link instead' +
            '</button>' +
        '</div>';
    }

    function cardHtml(v) {
        var d = v.raw;
        var vd = verdict(v);
        return '<div class="dt-card ' + (v.moving ? 'is-live' : '') + '" data-po="' + d.id + '">' +
            '<div class="dt-top">' +
                '<div class="dt-id">' +
                    '<span class="dt-po">' + esc(d.po_number || ('PO #' + d.id)) + '</span>' +
                    '<span class="dt-supplier">' + esc(d.supplier_name || 'Unknown supplier') + '</span>' +
                '</div>' +
                '<div class="dt-verdict ' + vd.tone + '">' +
                    '<span class="material-symbols-outlined">' + vd.icon + '</span>' + esc(vd.text) +
                '</div>' +
            '</div>' +
            railHtml(v) +
            '<div class="dt-bottom">' +
                '<span class="dt-meta">' + (d.item_count || 0) + ' item' + (Number(d.item_count) === 1 ? '' : 's') +
                    (d.total_amount ? ' · ' + (typeof formatCurrency === 'function' ? formatCurrency(d.total_amount) : d.total_amount) : '') +
                '</span>' +
                etaLine(v) +
            '</div>' +
            linkControlsHtml(v) +
        '</div>';
    }

    function render() {
        var wrap = document.getElementById('deliveriesList');
        if (!wrap) return;

        var views = deliveries.map(readDelivery);

        var badge = document.getElementById('deliveriesBadge');
        if (badge) {
            badge.textContent = views.length;
            badge.style.display = views.length ? '' : 'none';
            badge.classList.toggle('has-live', views.some(function (v) { return v.moving; }));
        }

        var hint = document.getElementById('deliveriesHint');
        if (hint) {
            var live = views.filter(function (v) { return v.moving; }).length;
            var late = views.filter(function (v) { return v.daysLate > 0; }).length;
            var bits = [views.length + ' on the way'];
            if (live) bits.push(live + ' moving now');
            if (late) bits.push(late + ' late');
            hint.textContent = bits.join(' · ');
        }

        if (!views.length) {
            wrap.innerHTML = '<div class="dt-empty">' +
                '<span class="material-symbols-outlined">inventory_2</span>' +
                '<p>Nothing on the way right now</p>' +
                '<small>Orders appear here as soon as you create them from <strong>Inventory → Reorder</strong>, ' +
                'and drop off once you mark them received.</small>' +
            '</div>';
        } else {
            // most urgent first: moving, then late, then longest stuck
            views.sort(function (a, b) {
                if (a.moving !== b.moving) return a.moving ? -1 : 1;
                var al = a.daysLate == null ? -999 : a.daysLate;
                var bl = b.daysLate == null ? -999 : b.daysLate;
                if (al !== bl) return bl - al;
                return (b.daysInStage || 0) - (a.daysInStage || 0);
            });
            wrap.innerHTML = views.map(cardHtml).join('');
        }

    }

    // ── Data ───────────────────────────────────────────────────────────────
    async function refresh(loud) {
        try {
            var r = await fetch(API_BASE + '/purchase-orders/deliveries', { headers: getAuthHeaders() });
            var d = await r.json();
            if (!d.success) throw new Error(d.message || 'failed');
            deliveries = Array.isArray(d.data) ? d.data : [];
            render();
            if (loud) showToast('Deliveries updated', 'success');
        } catch (e) {
            var wrap = document.getElementById('deliveriesList');
            if (wrap && !deliveries.length) {
                wrap.innerHTML = '<div class="dt-empty"><span class="material-symbols-outlined">cloud_off</span>' +
                    '<p>Could not load deliveries</p><small>Check the connection and try Refresh.</small></div>';
            }
            if (loud) showToast('Could not refresh deliveries', 'error');
        }
    }

    window.refreshDeliveries = refresh;

    // A driver's position moves; a stage does not. Poll often enough to feel
    // live, rarely enough to stay cheap — and only while someone is looking.
    function startPolling() {
        stopPolling();
        pollTimer = setInterval(function () {
            if (!document.hidden && visible) refresh(false);
        }, 20000);
    }
    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    window.onDeliveriesVisible = function (isVisible) {
        visible = !!isVisible;
        if (visible) { refresh(false); startPolling(); }
        else stopPolling();
    };

    // ── Link controls ──────────────────────────────────────────────────────
    window.createDeliveryLink = function (poId) {
        showConfirmDialog(
            'Create a live tracking link',
            'This makes a private link you can send to the supplier. Their driver decides whether to open it and share their location — ' +
            'you will see the delivery move only if they agree. The link stops working after 3 days.',
            async function () {
                try {
                    var r = await fetch(API_BASE + '/purchase-orders/' + poId + '/tracking-link', {
                        method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ hours: 72 })
                    });
                    var d = await r.json();
                    if (!d.success) { showErrorDialog('Could not create the link', d.message || 'Unknown error'); return; }
                    await copyToClipboard(d.data.url);
                    showSuccessDialog('Tracking link ready',
                        'The link is copied to your clipboard — send it to the supplier by message or email. ' +
                        'Nothing is tracked until their driver opens it and allows location sharing.',
                        { icon: 'share_location' });
                    refresh(false);
                } catch (e) {
                    showToast('Could not create the tracking link', 'error');
                }
            },
            'Create link',
            '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">share_location</span>'
        );
    };

    window.emailDeliveryLink = function (poId) {
        var d = deliveries.filter(function (x) { return x.id === poId; })[0] || {};
        showConfirmDialog(
            'Email the tracking link',
            'This sends ' + (d.supplier_name || 'the supplier') + ' a private link for ' + (d.po_number || 'this order') +
            '. Their driver decides whether to open it and share their location — you will see the delivery move only if they agree. ' +
            'The link stops working after 3 days.',
            async function () {
                try {
                    var r = await fetch(API_BASE + '/purchase-orders/' + poId + '/tracking-link/email', {
                        method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ hours: 72 })
                    });
                    var res = await r.json();
                    if (!res.success) {
                        showErrorDialog('The email did not go out', res.message || 'Unknown error');
                        refresh(false);
                        return;
                    }
                    showSuccessDialog('Link emailed', res.message, { icon: 'mark_email_read' });
                    refresh(false);
                } catch (e) {
                    showToast('Could not email the tracking link', 'error');
                }
            },
            'Send email',
            '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">share_location</span>'
        );
    };

    window.copyDeliveryLink = async function (poId) {
        try {
            var r = await fetch(API_BASE + '/purchase-orders/' + poId + '/tracking', { headers: getAuthHeaders() });
            var d = await r.json();
            if (!d.success || !d.data || !d.data.token) { showToast('No active link for this order', 'error'); return; }
            await copyToClipboard(window.location.origin + '/track/delivery/' + d.data.token);
            showToast('Tracking link copied', 'success');
        } catch (e) {
            showToast('Could not copy the link', 'error');
        }
    };

    window.stopDeliveryTracking = function (poId) {
        showConfirmDialog(
            'Stop tracking this delivery',
            'The link stops working immediately and the driver\'s phone stops sharing. Positions already recorded are kept with the order.',
            async function () {
                try {
                    var r = await fetch(API_BASE + '/purchase-orders/' + poId + '/tracking-link', {
                        method: 'DELETE', headers: getAuthHeaders()
                    });
                    var d = await r.json();
                    showToast(d.message || 'Tracking stopped', d.success ? 'success' : 'error');
                    refresh(false);
                } catch (e) {
                    showToast('Could not stop tracking', 'error');
                }
            },
            'Stop tracking',
            '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">location_off</span>'
        );
    };

    // Clipboard API needs a secure context; fall back rather than fail silently.
    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return;
            }
        } catch (e) { /* fall through */ }
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
    }

    /* ── Shop location ─────────────────────────────────────────────────────
       Every distance and arrival estimate is measured from here, so a wrong
       pin quietly corrupts all of them. Capturing it from the device standing
       in the shop beats dragging a marker on a map, and it is one tap. */
    window.setShopLocationHere = function () {
        if (typeof getUserRole === 'function' && getUserRole() !== 'admin') {
            showToast('Only an admin can set the shop location.', 'error');
            return;
        }
        if (!navigator.geolocation) {
            showToast('This browser cannot read a location.', 'error');
            return;
        }
        showConfirmDialog(
            'Set the shop location',
            'This saves <strong>where this device is right now</strong> as the shop\'s position. ' +
            'Do it on a phone or laptop inside the shop for an accurate result. ' +
            'Every delivery distance and arrival estimate is measured from this point.',
            function () {
                showToast('Reading this device\'s position…', 'info');
                navigator.geolocation.getCurrentPosition(
                    async function (pos) {
                        try {
                            var r = await fetch(API_BASE + '/suppliers/shop-location', {
                                method: 'PUT', headers: getAuthHeaders(),
                                body: JSON.stringify({
                                    latitude: +pos.coords.latitude.toFixed(7),
                                    longitude: +pos.coords.longitude.toFixed(7),
                                    label: 'Risha Pet Supplies'
                                })
                            });
                            var d = await r.json();
                            if (!d.success) { showErrorDialog('Could not save', d.message || 'Unknown error'); return; }
                            showSuccessDialog('Shop location saved',
                                'Accurate to about ' + Math.round(pos.coords.accuracy) + ' m. ' +
                                'Delivery distances and arrival times now measure from here.',
                                { icon: 'storefront' });
                        } catch (e) {
                            showToast('Could not save the shop location', 'error');
                        }
                    },
                    function (err) {
                        showErrorDialog('Could not read a position',
                            err.code === 1
                                ? 'Location permission was declined. Allow it in your browser settings and try again.'
                                : 'Your position is not available right now. Try again with a clearer signal.');
                    },
                    { enableHighAccuracy: true, timeout: 20000 }
                );
            },
            'Use this location',
            '<span class="material-symbols-outlined" style="font-size:48px;color:var(--primary);">storefront</span>'
        );
    };

    // ── View toggle ────────────────────────────────────────────────────────
    // List vs Deliveries. (This used to live in supplier-map.js, which went
    // when the supplier map was removed.)
    var VIEW_KEY = 'supplierView';

    function setView(view) {
        var panel = document.getElementById('deliveriesPanel');
        var table = document.getElementById('supplierTableWrap');
        var pager = document.getElementById('supplierPagination');
        if (!panel || !table) return;

        var isDeliveries = view === 'deliveries';
        panel.style.display = isDeliveries ? '' : 'none';
        table.style.display = isDeliveries ? 'none' : '';
        if (pager) pager.style.display = isDeliveries ? 'none' : '';

        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            var on = b.dataset.view === view;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}

        visible = isDeliveries;
        if (isDeliveries) { refresh(false); startPolling(); }
        else stopPolling();
    }

    window.addEventListener('load', function () {
        var toggle = document.getElementById('supplierViewToggle');
        if (toggle) {
            toggle.querySelectorAll('.inv-view-btn').forEach(function (b) {
                b.addEventListener('click', function () { setView(b.dataset.view); });
            });
        }
        var saved = 'list';
        try { saved = localStorage.getItem(VIEW_KEY) || 'list'; } catch (e) {}
        // the map view no longer exists — anyone who left it selected lands on the list
        if (saved !== 'deliveries') saved = 'list';
        setView(saved);

        // one early fetch so the badge count is right even from the list view
        setTimeout(function () { refresh(false); }, 700);
    });
})();
