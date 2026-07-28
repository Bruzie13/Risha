/* FETCH supplier map — where your suppliers actually are.

   Two maps live here:
     • the big one on the Suppliers page, showing every pinned supplier and
       how far each is from the shop
     • the small one inside the add/edit form, where you drop a supplier's pin
       (auto-found from their address, then dragged until it's right)

   Tiles are OpenStreetMap via Leaflet, both loaded from a CDN. If either is
   unreachable the page degrades to the plain list — nothing here is required
   to manage suppliers. */
(function () {
    'use strict';

    var PH_CENTRE = [12.8797, 121.7740];   // the shop is in the Philippines
    var PH_ZOOM = 5;
    var TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

    var mainMap = null, pickMap = null, pickMarker = null;
    var markers = {};            // supplier id -> Leaflet marker
    var shop = null;             // { latitude, longitude, label }
    var shopMarker = null;
    var pickingShop = false;
    var mapReady = false;

    function hasLeaflet() { return typeof L !== 'undefined' && L && L.map; }

    // ── Geometry ───────────────────────────────────────────────────────────
    // Haversine: straight-line distance, not driving distance. Said plainly
    // in the UI so nobody plans a delivery route with it.
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
        if (km == null) return '';
        if (km < 1) return Math.round(km * 1000) + ' m';
        if (km < 10) return km.toFixed(1) + ' km';
        return Math.round(km) + ' km';
    }

    function coordsOf(s) {
        var lat = s.latitude == null ? null : Number(s.latitude);
        var lng = s.longitude == null ? null : Number(s.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
    }

    function initials(name) {
        return (name || '?').split(' ').map(function (w) { return w[0]; })
            .filter(Boolean).slice(0, 2).join('').toUpperCase();
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pinIcon(label, extraClass) {
        return L.divIcon({
            className: 'fetch-pin-wrap',
            html: '<div class="fetch-pin ' + (extraClass || '') + '"><span>' + esc(label) + '</span></div>',
            iconSize: [34, 34],
            iconAnchor: [17, 34],
            popupAnchor: [0, -32]
        });
    }

    // ── Shop location ──────────────────────────────────────────────────────
    async function loadShop() {
        try {
            var r = await fetch(API_BASE + '/suppliers/shop-location', { headers: getAuthHeaders() });
            var d = await r.json();
            shop = d.success ? d.data : null;
        } catch (e) { shop = null; }
    }

    function drawShop() {
        if (!mainMap || !shop) return;
        if (shopMarker) mainMap.removeLayer(shopMarker);
        shopMarker = L.marker([shop.latitude, shop.longitude], {
            icon: pinIcon('🏠', 'shop'),
            zIndexOffset: 1000,
            title: shop.label || 'The shop'
        }).addTo(mainMap);
        shopMarker.bindPopup('<div class="map-pop-name">' + esc(shop.label || 'Risha Pet Supplies') + '</div>' +
            '<div class="map-pop-row"><span class="material-symbols-outlined">storefront</span> This is your shop</div>');
    }

    window.startShopLocationPick = function () {
        if (!mapReady) { showToast('The map is still loading.', 'info'); return; }
        if (typeof getUserRole === 'function' && getUserRole() !== 'admin') {
            showToast('Only an admin can set the shop location.', 'error');
            return;
        }
        pickingShop = true;
        document.getElementById('mapPickBanner').style.display = '';
        document.getElementById('supplierMap').style.cursor = 'crosshair';
    };

    window.cancelShopLocationPick = function () {
        pickingShop = false;
        var b = document.getElementById('mapPickBanner');
        if (b) b.style.display = 'none';
        var m = document.getElementById('supplierMap');
        if (m) m.style.cursor = '';
    };

    async function saveShopLocation(lat, lng) {
        try {
            var r = await fetch(API_BASE + '/suppliers/shop-location', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ latitude: lat, longitude: lng, label: 'Risha Pet Supplies' })
            });
            var d = await r.json();
            if (!d.success) { showToast(d.message || 'Could not save the shop location', 'error'); return; }
            shop = d.data;
            drawShop();
            renderList();
            showToast('Shop location saved — distances are measured from here.', 'success');
        } catch (e) {
            showToast('Could not save the shop location', 'error');
        }
    }

    // ── Main map ───────────────────────────────────────────────────────────
    function initMainMap() {
        if (mainMap || !hasLeaflet()) return;
        var el = document.getElementById('supplierMap');
        if (!el) return;

        mainMap = L.map(el, { zoomControl: true, attributionControl: true })
            .setView(PH_CENTRE, PH_ZOOM);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(mainMap);

        mainMap.on('click', function (e) {
            if (!pickingShop) return;
            cancelShopLocationPick();
            saveShopLocation(+e.latlng.lat.toFixed(7), +e.latlng.lng.toFixed(7));
        });

        mapReady = true;
    }

    function popupHtml(s, km) {
        var canEdit = typeof canManage === 'function' && canManage();
        var rows = '';
        if (s.contact_person) rows += '<div class="map-pop-row"><span class="material-symbols-outlined">person</span> ' + esc(s.contact_person) + '</div>';
        if (s.phone) rows += '<div class="map-pop-row"><span class="material-symbols-outlined">call</span> ' + esc(s.phone) + '</div>';
        var where = [s.address, s.city].filter(Boolean).join(', ');
        if (where) rows += '<div class="map-pop-row"><span class="material-symbols-outlined">location_on</span> ' + esc(where) + '</div>';

        return '<div class="map-pop-name">' + esc(s.name) + '</div>' + rows +
            (km != null ? '<div class="map-pop-dist">' + formatKm(km) + ' from the shop (straight line)</div>' : '') +
            '<div class="map-pop-actions">' +
                '<button class="btn-view" onclick="showPerformance(' + s.id + ')">Performance</button>' +
                (canEdit ? '<button class="btn-edit" onclick="openEditSupplierModal(' + s.id + ')">Edit</button>' : '') +
            '</div>';
    }

    function drawMarkers(suppliers) {
        if (!mainMap) return;
        Object.keys(markers).forEach(function (id) { mainMap.removeLayer(markers[id]); });
        markers = {};

        var bounds = [];
        suppliers.forEach(function (s) {
            var c = coordsOf(s);
            if (!c) return;
            var km = shop ? distanceKm(shop.latitude, shop.longitude, c[0], c[1]) : null;
            var m = L.marker(c, { icon: pinIcon(initials(s.name)), title: s.name }).addTo(mainMap);
            m.bindPopup(popupHtml(s, km));
            m.on('popupopen', function () { highlightListItem(s.id); });
            markers[s.id] = m;
            bounds.push(c);
        });

        if (shop) bounds.push([shop.latitude, shop.longitude]);
        if (bounds.length > 1) mainMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
        else if (bounds.length === 1) mainMap.setView(bounds[0], 13);
    }

    function highlightListItem(id) {
        document.querySelectorAll('.map-list-item').forEach(function (el) {
            el.classList.toggle('is-active', +el.dataset.id === +id);
        });
        Object.keys(markers).forEach(function (mid) {
            var pin = markers[mid].getElement() && markers[mid].getElement().querySelector('.fetch-pin');
            if (pin) pin.classList.toggle('is-active', +mid === +id);
        });
    }

    var currentSuppliers = [];

    function renderList() {
        var wrap = document.getElementById('supplierMapList');
        if (!wrap) return;

        var pinned = [], unpinned = [];
        currentSuppliers.forEach(function (s) {
            var c = coordsOf(s);
            if (c) pinned.push({ s: s, km: shop ? distanceKm(shop.latitude, shop.longitude, c[0], c[1]) : null });
            else unpinned.push(s);
        });
        // nearest first when we know where the shop is, alphabetical otherwise
        pinned.sort(function (a, b) {
            if (a.km == null || b.km == null) return (a.s.name || '').localeCompare(b.s.name || '');
            return a.km - b.km;
        });

        var html = '';
        if (!currentSuppliers.length) {
            html = '<div class="map-list-empty">No suppliers yet.</div>';
        } else {
            if (pinned.length) {
                html += '<div class="map-list-group">' + (shop ? 'Nearest first' : 'On the map') + '</div>';
                html += pinned.map(function (p) {
                    return '<div class="map-list-item" data-id="' + p.s.id + '">' +
                        '<span class="map-list-avatar">' + esc(initials(p.s.name)) + '</span>' +
                        '<span class="map-list-info">' +
                            '<span class="map-list-name">' + esc(p.s.name) + '</span>' +
                            '<span class="map-list-sub">' + esc(p.s.city || p.s.contact_person || '—') + '</span>' +
                        '</span>' +
                        (p.km != null ? '<span class="map-list-dist">' + formatKm(p.km) + '</span>' : '') +
                    '</div>';
                }).join('');
            }
            if (unpinned.length) {
                html += '<div class="map-list-group">Not located yet (' + unpinned.length + ')</div>';
                html += unpinned.map(function (s) {
                    return '<div class="map-list-item unpinned" data-id="' + s.id + '" data-unpinned="1">' +
                        '<span class="map-list-avatar">' + esc(initials(s.name)) + '</span>' +
                        '<span class="map-list-info">' +
                            '<span class="map-list-name">' + esc(s.name) + '</span>' +
                            '<span class="map-list-sub">' + (typeof canManage === 'function' && canManage() ? 'Click to add a pin' : 'No location saved') + '</span>' +
                        '</span>' +
                    '</div>';
                }).join('');
            }
        }
        wrap.innerHTML = html;

        var count = document.getElementById('mapPinnedCount');
        if (count) {
            count.textContent = pinned.length + ' of ' + currentSuppliers.length + ' located' +
                (shop ? '' : ' · shop location not set');
        }
    }

    // clicking a row flies to its pin (or opens the editor to create one)
    document.addEventListener('click', function (e) {
        var row = e.target.closest && e.target.closest('.map-list-item');
        if (!row) return;
        var id = +row.dataset.id;
        if (row.dataset.unpinned) {
            if (typeof canManage === 'function' && canManage()) openEditSupplierModal(id);
            return;
        }
        var m = markers[id];
        if (m && mainMap) {
            mainMap.flyTo(m.getLatLng(), Math.max(mainMap.getZoom(), 13), { duration: 0.6 });
            m.openPopup();
        }
        highlightListItem(id);
    });

    // ── Public: refresh from the supplier list ─────────────────────────────
    window.renderSupplierMap = function (suppliers) {
        currentSuppliers = Array.isArray(suppliers) ? suppliers : [];
        renderList();
        if (mapReady) drawMarkers(currentSuppliers);
    };

    // ── Delivery overlays ──────────────────────────────────────────────────
    // Two things get drawn per in-flight order: a dashed line from the supplier
    // to the shop (the route it *should* travel — straight line, not roads),
    // and, when a driver is actually sharing, a live marker plus the trail of
    // where they have been.
    var routeLines = [], liveMarkers = [], trailLines = [];
    var lastDeliveries = [];

    function clearOverlays() {
        [routeLines, liveMarkers, trailLines].forEach(function (group) {
            group.forEach(function (layer) { if (mainMap) mainMap.removeLayer(layer); });
            group.length = 0;
        });
    }

    window.drawDeliveryOverlays = function (views) {
        lastDeliveries = Array.isArray(views) ? views : [];
        if (!mainMap || !mapReady) return;
        clearOverlays();
        if (!shop) return;

        lastDeliveries.forEach(function (v) {
            var d = v.raw || {};
            // coordsOf() guards against null — Number(null) is 0, which would
            // silently draw the route from [0, 0] in the Gulf of Guinea.
            var sc = coordsOf({ latitude: d.supplier_lat, longitude: d.supplier_lng });
            var sLat = sc && sc[0], sLng = sc && sc[1];
            var hasSupplierPin = !!sc;

            // route line only for orders actually in transit
            if (hasSupplierPin && d.status === 'shipped') {
                routeLines.push(L.polyline([[sLat, sLng], [shop.latitude, shop.longitude]], {
                    className: 'dt-route' + (v.moving ? ' is-live' : ''),
                    color: v.moving ? '#2FA36B' : '#EE6A5F',
                    weight: 3,
                    opacity: v.moving ? 0.9 : 0.5,
                    dashArray: '9 9'
                }).addTo(mainMap));
            }

            if (!v.moving || v.lat == null || v.lng == null) return;

            var marker = L.marker([v.lat, v.lng], {
                icon: L.divIcon({
                    className: 'fetch-pin-wrap',
                    html: '<div class="fetch-pin driver"><span class="material-symbols-outlined">local_shipping</span></div>',
                    iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -32]
                }),
                zIndexOffset: 2000,
                title: (d.po_number || '') + ' — driver'
            }).addTo(mainMap);

            var km = distanceKm(v.lat, v.lng, shop.latitude, shop.longitude);
            marker.bindPopup(
                '<div class="map-pop-name">' + esc(d.po_number || 'Delivery') + '</div>' +
                '<div class="map-pop-row"><span class="material-symbols-outlined">local_shipping</span> ' +
                    esc(d.supplier_name || 'Supplier') + '</div>' +
                '<div class="map-pop-row"><span class="material-symbols-outlined">schedule</span> Position from ' +
                    esc(new Date(v.liveAt).toLocaleTimeString()) + '</div>' +
                '<div class="map-pop-dist">' + formatKm(km) + ' from the shop (straight line)</div>'
            );
            liveMarkers.push(marker);

            // trail, if the tracker handed us one
            if (Array.isArray(v.trail) && v.trail.length > 1) {
                trailLines.push(L.polyline(v.trail.map(function (p) { return [p.latitude, p.longitude]; }), {
                    color: '#2FA36B', weight: 3, opacity: 0.65
                }).addTo(mainMap));
            }
        });
    };

    // ── View toggle ────────────────────────────────────────────────────────
    var VIEW_KEY = 'supplierView';

    function setView(view) {
        var mapPanel = document.getElementById('supplierMapPanel');
        var tableWrap = document.getElementById('supplierTableWrap');
        var pager = document.getElementById('supplierPagination');
        var delPanel = document.getElementById('deliveriesPanel');
        if (!mapPanel || !tableWrap) return;

        var isMap = view === 'map';
        var isDeliveries = view === 'deliveries';
        mapPanel.style.display = isMap ? '' : 'none';
        if (delPanel) delPanel.style.display = isDeliveries ? '' : 'none';
        tableWrap.style.display = (isMap || isDeliveries) ? 'none' : '';
        if (pager) pager.style.display = (isMap || isDeliveries) ? 'none' : '';

        // let the tracker poll only while its panel (or the map) is on screen
        if (typeof window.onDeliveriesVisible === 'function') {
            window.onDeliveriesVisible(isDeliveries || isMap);
        }

        document.querySelectorAll('#supplierViewToggle .inv-view-btn').forEach(function (b) {
            var on = b.dataset.view === view;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}

        if (!isMap) return;

        if (!hasLeaflet()) {
            document.getElementById('supplierMapOffline').style.display = '';
            return;
        }
        initMainMap();
        // Leaflet measures the container on creation; it was display:none until
        // now, so tell it to look again.
        setTimeout(function () {
            if (!mainMap) return;
            mainMap.invalidateSize();
            drawShop();
            drawMarkers(currentSuppliers);
            window.drawDeliveryOverlays(lastDeliveries);
        }, 60);
    }

    window.setSupplierView = setView;

    // ── Location picker (inside the add/edit modal) ────────────────────────
    function setPinFields(lat, lng) {
        var latEl = document.getElementById('latitude');
        var lngEl = document.getElementById('longitude');
        var read = document.getElementById('locReadout');
        var clear = document.getElementById('locClearBtn');
        if (!latEl || !lngEl) return;

        if (lat == null || lng == null) {
            latEl.value = '';
            lngEl.value = '';
            if (read) { read.textContent = 'No pin yet — drag the marker or use “Find from address”.'; read.classList.remove('has-pin'); }
            if (clear) clear.style.display = 'none';
            return;
        }
        latEl.value = lat;
        lngEl.value = lng;
        if (read) {
            read.textContent = 'Pinned at ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
            read.classList.add('has-pin');
        }
        if (clear) clear.style.display = '';
    }

    function placePickMarker(lat, lng, fly) {
        if (!pickMap) return;
        if (!pickMarker) {
            pickMarker = L.marker([lat, lng], { draggable: true, icon: pinIcon('📍') }).addTo(pickMap);
            pickMarker.on('dragend', function () {
                var p = pickMarker.getLatLng();
                setPinFields(+p.lat.toFixed(7), +p.lng.toFixed(7));
            });
        } else {
            pickMarker.setLatLng([lat, lng]);
        }
        setPinFields(+Number(lat).toFixed(7), +Number(lng).toFixed(7));
        if (fly) pickMap.setView([lat, lng], Math.max(pickMap.getZoom(), 15));
    }

    // Called by suppliers.js whenever the supplier modal opens.
    window.openSupplierPicker = function (lat, lng) {
        var offline = document.getElementById('pickMapOffline');
        setPinFields(lat == null ? null : lat, lng == null ? null : lng);
        hideSuggestions();

        if (!hasLeaflet()) { if (offline) offline.style.display = ''; return; }
        if (offline) offline.style.display = 'none';

        var el = document.getElementById('supplierPickMap');
        if (!el) return;

        if (!pickMap) {
            pickMap = L.map(el, { zoomControl: true, attributionControl: false }).setView(PH_CENTRE, PH_ZOOM);
            L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(pickMap);
            pickMap.on('click', function (e) {
                placePickMarker(+e.latlng.lat.toFixed(7), +e.latlng.lng.toFixed(7), false);
            });
        }

        if (pickMarker) { pickMap.removeLayer(pickMarker); pickMarker = null; }

        setTimeout(function () {
            pickMap.invalidateSize();
            if (lat != null && lng != null) {
                placePickMarker(lat, lng, true);
            } else if (shop) {
                pickMap.setView([shop.latitude, shop.longitude], 12);   // start near the shop
            } else {
                pickMap.setView(PH_CENTRE, PH_ZOOM);
            }
        }, 120);
    };

    window.clearSupplierPin = function () {
        if (pickMarker && pickMap) { pickMap.removeLayer(pickMarker); pickMarker = null; }
        setPinFields(null, null);
    };

    // ── Geocoding ("Find from address") ────────────────────────────────────
    function hideSuggestions() {
        var box = document.getElementById('locSuggestions');
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    }

    window.locateFromAddress = async function () {
        var parts = [
            document.getElementById('address') ? document.getElementById('address').value.trim() : '',
            document.getElementById('city') ? document.getElementById('city').value.trim() : ''
        ].filter(Boolean);

        if (!parts.length) {
            showToast('Type an address or city first, then search.', 'info');
            var a = document.getElementById('address');
            if (a) a.focus();
            return;
        }
        // Philippine addresses are often written without the country
        var query = parts.join(', ') + ', Philippines';

        var btn = document.getElementById('locateBtn');
        var original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">hourglass_top</span> Searching…'; }

        try {
            var r = await fetch(API_BASE + '/suppliers/geocode?q=' + encodeURIComponent(query), { headers: getAuthHeaders() });
            var d = await r.json();
            if (!d.success) { showToast(d.message || 'Location search failed', 'error'); return; }
            if (!d.data.length) {
                showToast('No match for that address. Drop the pin on the map instead.', 'info');
                return;
            }
            // best guess straight away, alternatives listed underneath
            placePickMarker(d.data[0].latitude, d.data[0].longitude, true);
            showSuggestions(d.data);
            // the suggestion list just grew the form — keep the pin on screen
            var wrap = document.querySelector('.loc-map-wrap');
            if (wrap) setTimeout(function () { wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 80);
        } catch (e) {
            showToast('Could not reach the map service. Drop the pin manually.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = original; }
        }
    };

    function showSuggestions(list) {
        var box = document.getElementById('locSuggestions');
        if (!box) return;
        if (list.length < 2) { hideSuggestions(); return; }
        box.innerHTML = '<div class="loc-suggestion" style="font-weight:700;color:var(--text-primary);cursor:default;">' +
            'Not the right spot? Pick another, or drag the pin:</div>' +
            list.slice(0, 5).map(function (r, i) {
                return '<div class="loc-suggestion" data-lat="' + r.latitude + '" data-lng="' + r.longitude + '">' +
                    '<span class="material-symbols-outlined">location_on</span>' + esc(r.label) + '</div>';
            }).join('');
        box.style.display = '';
        box.querySelectorAll('.loc-suggestion[data-lat]').forEach(function (el) {
            el.addEventListener('click', function () {
                placePickMarker(+el.dataset.lat, +el.dataset.lng, true);
            });
        });
    }

    // ── Boot ───────────────────────────────────────────────────────────────
    window.addEventListener('load', function () {
        var toggle = document.getElementById('supplierViewToggle');
        if (!toggle) return;

        toggle.querySelectorAll('.inv-view-btn').forEach(function (b) {
            b.addEventListener('click', function () { setView(b.dataset.view); });
        });

        // Admin-only control; hide it from everyone else.
        if (typeof getUserRole === 'function' && getUserRole() !== 'admin') {
            var btn = document.getElementById('setShopLocationBtn');
            if (btn) btn.remove();
        }

        loadShop().then(function () {
            // ?view=map deep-links straight to the map (used by the Jump palette)
            var wanted = new URLSearchParams(window.location.search).get('view');
            var saved = 'list';
            try { saved = localStorage.getItem(VIEW_KEY) || 'list'; } catch (e) {}
            setView((wanted || saved) === 'map' ? 'map' : 'list');
            renderList();
        });
    });
})();
