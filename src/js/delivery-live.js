/* FETCH live delivery view — one delivery, full map, watched in real time.

   The board answers "is it moving?". This answers "where is it, and when
   does it get here?".

   Two honesty rules shape everything below:

     1. A position is only ever as fresh as its last fix. If updates stop the
        marker does not keep drifting — the view says how long ago it was last
        seen and dims the pin. A frozen pin presented as live is a lie.

     2. The ETA is arithmetic on recent GPS speed and straight-line distance,
        not a routing engine. It is labelled an estimate everywhere it appears
        and disappears entirely when the driver is not moving. */
(function () {
    'use strict';

    if (!window.location.pathname.includes('suppliers.html')) return;

    var TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

    var POLL_OPEN_MS = 5000;    // while you are watching
    var STALE_MS = 3 * 60000;   // no fix for this long = not live any more

    var map = null, marker = null, trailLine = null, shopMarker = null, routeLine = null;
    var poll = null, raf = null;
    var poId = null, poNumber = '', supplierName = '';
    var shop = null;
    var follow = true;

    // Where the marker is drawn vs where the GPS says it is. The gap between
    // them is what makes the movement glide instead of teleport.
    var shown = null, target = null, lastFixAt = null, trail = [];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function distanceKm(aLat, aLng, bLat, bLng) {
        var R = 6371;
        var dLat = (bLat - aLat) * Math.PI / 180;
        var dLng = (bLng - aLng) * Math.PI / 180;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }

    function formatKm(km) {
        if (km == null) return '—';
        if (km < 1) return Math.round(km * 1000) + ' m';
        if (km < 10) return km.toFixed(1) + ' km';
        return Math.round(km) + ' km';
    }

    function agoText(ms) {
        var d = Date.now() - ms;
        if (d < 20000) return 'just now';
        if (d < 90000) return Math.round(d / 1000) + ' seconds ago';
        if (d < 3600000) return Math.round(d / 60000) + ' minutes ago';
        return Math.round(d / 3600000) + ' hours ago';
    }

    /* Average speed over the recent trail. GPS jitter makes any single pair
       unreliable, so this spans several fixes and ignores samples too short in
       time to mean anything. Returns km/h, or null when we cannot say. */
    function recentSpeedKmh() {
        if (trail.length < 2) return null;
        var pts = trail.slice(-6);
        var km = 0, ms = 0;
        for (var i = 1; i < pts.length; i++) {
            km += distanceKm(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
            ms += pts[i].recorded_at - pts[i - 1].recorded_at;
        }
        if (ms < 30000) return null;                 // too short a window to trust
        var kmh = km / (ms / 3600000);
        if (!isFinite(kmh) || kmh < 1) return null;  // stopped, or GPS noise
        return kmh;
    }

    function etaText(remainingKm) {
        var kmh = recentSpeedKmh();
        if (kmh == null || remainingKm == null) return null;
        var mins = Math.round((remainingKm / kmh) * 60);
        if (mins < 1) return 'arriving now';
        if (mins < 60) return '~' + mins + ' min away';
        var h = Math.floor(mins / 60);
        return '~' + h + 'h ' + (mins % 60) + 'm away';
    }

    // ── Shell ──────────────────────────────────────────────────────────────
    function build() {
        var el = document.createElement('div');
        el.id = 'liveTrackModal';
        el.className = 'live-modal';
        el.innerHTML =
            '<div class="live-shell">' +
                '<div class="live-head">' +
                    '<div class="live-title">' +
                        '<span class="live-po" id="liveTrackPo"></span>' +
                        '<span class="live-sup" id="liveTrackSupplier"></span>' +
                    '</div>' +
                    '<div class="live-head-right">' +
                        '<button class="live-follow on" id="liveFollowBtn" title="Keep the driver centred">' +
                            '<span class="material-symbols-outlined">my_location</span> Following' +
                        '</button>' +
                        '<button class="live-close" id="liveCloseBtn" aria-label="Close">&times;</button>' +
                    '</div>' +
                '</div>' +
                '<div class="live-map-wrap">' +
                    '<div id="liveTrackMap" role="application" aria-label="Live delivery map"></div>' +
                    '<div class="live-banner" id="liveBanner"></div>' +
                '</div>' +
                '<div class="live-foot">' +
                    '<div class="live-stat"><span class="ls-label">Distance to shop</span><span class="ls-value" id="liveDistance">—</span></div>' +
                    '<div class="live-stat"><span class="ls-label">Estimated arrival</span><span class="ls-value" id="liveEta">—</span></div>' +
                    '<div class="live-stat"><span class="ls-label">Last update</span><span class="ls-value" id="liveLastFix">—</span></div>' +
                    '<div class="live-note" id="liveNote">Estimate from recent GPS speed in a straight line — not a driving route.</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(el);

        el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
        el.querySelector('#liveCloseBtn').addEventListener('click', close);
        el.querySelector('#liveFollowBtn').addEventListener('click', function () {
            follow = !follow;
            this.classList.toggle('on', follow);
            this.innerHTML = follow
                ? '<span class="material-symbols-outlined">my_location</span> Following'
                : '<span class="material-symbols-outlined">location_searching</span> Free';
            if (follow && shown && map) map.panTo(shown, { animate: true });
        });
        return el;
    }

    function pin(html, cls) {
        return L.divIcon({
            className: 'fetch-pin-wrap',
            html: '<div class="fetch-pin ' + cls + '">' + html + '</div>',
            iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -34]
        });
    }

    function initMap() {
        map = L.map('liveTrackMap', { zoomControl: true, attributionControl: true }).setView([12.88, 121.77], 6);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
        // dragging the map means you want to look around, not be yanked back
        map.on('dragstart', function () {
            if (!follow) return;
            follow = false;
            var b = document.getElementById('liveFollowBtn');
            if (b) {
                b.classList.remove('on');
                b.innerHTML = '<span class="material-symbols-outlined">location_searching</span> Free';
            }
        });
    }

    // ── Animation ──────────────────────────────────────────────────────────
    // Ease the drawn position toward the real one. Slow enough to read as
    // travel, fast enough to catch up before the next fix lands.
    function step() {
        raf = requestAnimationFrame(step);
        if (!marker || !target) return;
        if (!shown) { shown = target.slice(); }

        var dLat = target[0] - shown[0], dLng = target[1] - shown[1];
        if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) {
            shown = target.slice();
        } else {
            shown[0] += dLat * 0.08;
            shown[1] += dLng * 0.08;
        }
        marker.setLatLng(shown);
        if (follow) map.panTo(shown, { animate: false });
    }

    function setStale(isStale, lastAt) {
        var el = document.getElementById('liveBanner');
        var mk = marker && marker.getElement() && marker.getElement().querySelector('.fetch-pin');
        if (mk) mk.classList.toggle('is-stale', isStale);
        if (!el) return;
        if (isStale) {
            el.className = 'live-banner show warn';
            el.innerHTML = '<span class="material-symbols-outlined">warning</span> ' +
                'No update since ' + esc(agoText(lastAt)) + ' — the driver may have closed the page. ' +
                'This is their last known position, not where they are now.';
        } else {
            el.className = 'live-banner';
            el.innerHTML = '';
        }
    }

    function noSignal(msg) {
        var el = document.getElementById('liveBanner');
        if (!el) return;
        el.className = 'live-banner show';
        el.innerHTML = '<span class="material-symbols-outlined">info</span> ' + esc(msg);
    }

    // ── Data ───────────────────────────────────────────────────────────────
    async function refresh() {
        try {
            var r = await fetch(API_BASE + '/purchase-orders/' + poId + '/tracking', { headers: getAuthHeaders() });
            var d = await r.json();
            var t = d.data;

            if (!t || t.revoked || t.expired) {
                noSignal(t ? 'This tracking link is no longer active.' : 'No tracking link has been issued for this order yet.');
                return;
            }
            if (!t.trail || !t.trail.length) {
                noSignal('Waiting for the driver to open the link and start sharing. Nothing is being tracked yet.');
                return;
            }

            trail = t.trail;
            var last = trail[trail.length - 1];
            lastFixAt = last.recorded_at;
            target = [last.latitude, last.longitude];
            if (!shown) shown = target.slice();

            if (!marker) {
                marker = L.marker(shown, { icon: pin('<span class="material-symbols-outlined">local_shipping</span>', 'driver'), zIndexOffset: 2000 }).addTo(map);
                map.setView(shown, 14);
            }

            if (trailLine) map.removeLayer(trailLine);
            if (trail.length > 1) {
                trailLine = L.polyline(trail.map(function (p) { return [p.latitude, p.longitude]; }),
                    { color: '#2FA36B', weight: 4, opacity: 0.7 }).addTo(map);
            }

            var stale = (Date.now() - lastFixAt) > STALE_MS;
            setStale(stale, lastFixAt);

            var remaining = shop ? distanceKm(last.latitude, last.longitude, shop.latitude, shop.longitude) : null;
            document.getElementById('liveDistance').textContent = shop ? formatKm(remaining) : 'shop location not set';
            document.getElementById('liveLastFix').textContent = agoText(lastFixAt);

            var etaEl = document.getElementById('liveEta');
            if (stale) etaEl.textContent = 'unknown — no signal';
            else {
                var eta = etaText(remaining);
                etaEl.textContent = eta || 'not moving';
            }
        } catch (e) {
            noSignal('Could not reach the server — retrying.');
        }
    }

    // ── Open / close ───────────────────────────────────────────────────────
    window.openLiveTracking = async function (id, number, supplier) {
        if (typeof L === 'undefined') {
            showToast('The map could not load — check the connection.', 'error');
            return;
        }
        poId = id; poNumber = number || ''; supplierName = supplier || '';
        shown = null; target = null; trail = []; lastFixAt = null; follow = true;

        var el = document.getElementById('liveTrackModal') || build();
        el.classList.add('active');
        document.body.classList.add('jump-open');
        document.getElementById('liveTrackPo').textContent = poNumber;
        document.getElementById('liveTrackSupplier').textContent = supplierName;
        document.getElementById('liveDistance').textContent = '—';
        document.getElementById('liveEta').textContent = '—';
        document.getElementById('liveLastFix').textContent = '—';

        if (!map) { initMap(); } else { setTimeout(function () { map.invalidateSize(); }, 60); }

        // the shop is the destination every number here is measured against
        if (!shop) {
            try {
                var sr = await fetch(API_BASE + '/suppliers/shop-location', { headers: getAuthHeaders() });
                var sd = await sr.json();
                shop = sd.success ? sd.data : null;
            } catch (e) { shop = null; }
        }
        if (shop && !shopMarker) {
            shopMarker = L.marker([shop.latitude, shop.longitude], { icon: pin('🏠', 'shop'), zIndexOffset: 500 })
                .addTo(map).bindPopup('Your shop');
        }

        setTimeout(function () { map.invalidateSize(); }, 120);
        await refresh();
        if (poll) clearInterval(poll);
        poll = setInterval(refresh, POLL_OPEN_MS);
        if (!raf) raf = requestAnimationFrame(step);
    };

    function close() {
        var el = document.getElementById('liveTrackModal');
        if (el) el.classList.remove('active');
        document.body.classList.remove('jump-open');
        if (poll) { clearInterval(poll); poll = null; }
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        // drop the drawn layers so the next open starts clean
        if (marker && map) { map.removeLayer(marker); marker = null; }
        if (trailLine && map) { map.removeLayer(trailLine); trailLine = null; }
    }

    window.closeLiveTracking = close;

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var el = document.getElementById('liveTrackModal');
        if (el && el.classList.contains('active')) close();
    });
})();
