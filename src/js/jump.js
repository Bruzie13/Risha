/* FETCH Jump — one place to get anywhere in the system.

   Press ⌘J / Ctrl+J (or ⌘K, or the Jump button on the dashboard) and type.
   It searches four things at once:
     • sections of the page you are already on  — scrolls and highlights them
     • every module you are allowed to open     — role-aware
     • quick actions                            — "add a product", "end of day"
     • your live data                           — products and suppliers

   It also builds the section rail on the right of long pages and the
   back-to-top button, so getting around never needs a scroll marathon. */
(function () {
    'use strict';

    var path = window.location.pathname;
    if (path.includes('login.html') || path.includes('reset-password.html')) return;

    var RECENT_KEY = 'jumpRecents';
    var MAX_RECENT = 4;

    // ── Who is allowed where ───────────────────────────────────────────────
    function role() {
        try { return (typeof getUserRole === 'function' && getUserRole()) || 'staff'; }
        catch (e) { return 'staff'; }
    }
    function manages() {
        try { return typeof canManage === 'function' ? canManage() : false; }
        catch (e) { return false; }
    }
    var isAdmin = function () { return role() === 'admin'; };

    // ── Destinations ───────────────────────────────────────────────────────
    // `kw` holds the words a cashier might actually type for this thing.
    var PLACES = [
        { label: 'Dashboard', sub: 'Today at a glance — KPIs, trends, alerts', icon: 'dashboard', tone: 'coral', href: 'dashboard.html', kw: 'home overview start main' },
        { label: 'Point of Sale', sub: 'Ring up a sale, scan barcodes, print a receipt', icon: 'point_of_sale', tone: 'green', href: 'pos.html', kw: 'pos checkout cashier till sell counter' },
        { label: 'Inventory', sub: 'Products, stock levels, expiry, reorders', icon: 'inventory_2', tone: 'blue', href: 'inventory.html', kw: 'products stock items goods catalog' },
        { label: 'Sales History', sub: 'Past sales, receipts, voids, cash count', icon: 'receipt_long', tone: 'purple', href: 'sales.html', kw: 'transactions receipts orders history' },
        { label: 'Suppliers', sub: 'Contacts, purchase orders, delivery performance', icon: 'local_shipping', tone: 'amber', href: 'suppliers.html', kw: 'vendors distributors purchase order po' },
        { label: 'Reports', sub: 'Daily, weekly and monthly sales summaries', icon: 'assessment', tone: 'coral', href: 'reports.html', kw: 'summary print daily weekly monthly' },
        { label: 'Analytics & Forecast', sub: 'Demand forecasting and product segments', icon: 'insights', tone: 'purple', href: 'analytics.html', kw: 'forecast prediction ml trends movers' },
        { label: 'Notifications', sub: 'Low stock, stockouts and expiry alerts', icon: 'notifications', tone: 'amber', href: 'notifications.html', kw: 'alerts bell warnings messages' },
        { label: 'Users', sub: 'Accounts, roles and access', icon: 'group', tone: 'blue', href: 'users.html', kw: 'staff accounts team roles permissions', when: manages },
        { label: 'Audit Logs', sub: 'Who did what, when and from where', icon: 'history', tone: 'red', href: 'audit.html', kw: 'logs activity trail security', when: isAdmin },
        { label: 'Settings', sub: 'Your profile, password, theme and backups', icon: 'settings', tone: 'blue', href: 'settings.html', kw: 'preferences profile account theme backup' }
    ];

    var ACTIONS = [
        { label: 'Start a new sale', sub: 'Opens the POS with an empty cart', icon: 'add_shopping_cart', tone: 'green', href: 'pos.html', kw: 'sell checkout ring up customer new' },
        { label: 'Add a product', sub: 'Create a new inventory item', icon: 'add_box', tone: 'blue', href: 'inventory.html?do=add', kw: 'new product create item stock', when: manages },
        { label: 'Restock list', sub: 'Products at or below their reorder point', icon: 'shopping_cart_checkout', tone: 'amber', href: 'inventory.html?filter=low', kw: 'low stock reorder buy replenish' },
        { label: 'Out of stock', sub: 'Everything that has run out', icon: 'production_quantity_limits', tone: 'red', href: 'inventory.html?filter=out', kw: 'empty zero none sold out' },
        { label: 'Expiring soon', sub: 'Batches close to their expiry date', icon: 'schedule', tone: 'amber', href: 'inventory.html?filter=expiring', kw: 'expiry expiring near date spoil' },
        { label: 'Expired stock', sub: 'Items past their date — pull these off the shelf', icon: 'dangerous', tone: 'red', href: 'inventory.html?filter=expired', kw: 'expired old bad remove' },
        { label: 'Import products from CSV', sub: 'Bulk upload a product list', icon: 'upload_file', tone: 'purple', href: 'inventory.html?do=import', kw: 'csv import bulk upload excel spreadsheet', when: manages },
        { label: 'End of day cash count', sub: 'Record the drawer count for today', icon: 'savings', tone: 'green', href: 'sales.html?do=eod', kw: 'eod drawer cash reconcile close shift count' },
        { label: 'Add a supplier', sub: 'Save a new supplier contact', icon: 'person_add', tone: 'amber', href: 'suppliers.html?do=add', kw: 'new supplier vendor contact', when: manages },
        { label: 'Supplier map', sub: 'See where your suppliers are and how far away', icon: 'pin_drop', tone: 'amber', href: 'suppliers.html?view=map', kw: 'map location where distance near far pin gps track' },
        { label: "Today's sales report", sub: 'Printable summary for the day', icon: 'print', tone: 'coral', href: 'reports.html', kw: 'print daily report summary today' },
        { label: 'Demand forecast', sub: '30-day projection and reorder advice', icon: 'query_stats', tone: 'purple', href: 'analytics.html', kw: 'forecast predict ml demand future' },
        { label: 'Add a user', sub: 'Invite a staff member', icon: 'group_add', tone: 'blue', href: 'users.html?do=add', kw: 'new user staff account invite', when: isAdmin },
        { label: 'Change my password', sub: 'Settings → Password', icon: 'lock_reset', tone: 'red', href: 'settings.html?tab=password', kw: 'password security change reset' },
        { label: 'Switch light / dark mode', sub: 'Flip the theme right now', icon: 'dark_mode', tone: 'purple', run: function () { if (typeof toggleTheme === 'function') toggleTheme(); }, kw: 'theme dark light night mode appearance' },
        { label: 'Ask the assistant', sub: 'Questions about your shop, or how to do something', icon: 'smart_toy', tone: 'coral', run: function () { if (typeof openFetchAssistant === 'function') openFetchAssistant(); }, kw: 'help guide assistant ai how support' }
    ];

    function allowed(item) { return !item.when || item.when(); }

    // ── Deep-link handlers ─────────────────────────────────────────────────
    // A jump can land on a page *and* open something. Only known, already
    // defined page functions are ever called.
    var DO_HANDLERS = {
        add: ['openAddProductModal', 'openAddSupplierModal', 'openAddUserModal'],
        import: ['openCsvImportModal'],
        eod: ['openEodModal']
    };

    function runDeepLink() {
        var params = new URLSearchParams(window.location.search);
        var todo = params.get('do');
        if (todo && DO_HANDLERS[todo]) {
            var names = DO_HANDLERS[todo];
            var tries = 0;
            (function attempt() {
                for (var i = 0; i < names.length; i++) {
                    if (typeof window[names[i]] === 'function') { window[names[i]](); return; }
                }
                // page data may still be loading — retry briefly, then give up
                if (++tries < 20) setTimeout(attempt, 150);
            })();
        }
        // Generic tab deep-link for the settings page (reports handles its own)
        var tab = params.get('tab');
        if (tab) {
            var btn = document.querySelector('.settings-tab[data-tab="' + CSS.escape(tab) + '"]');
            if (btn) setTimeout(function () { btn.click(); }, 60);
        }
        var sec = params.get('section');
        if (sec) setTimeout(function () { scrollToSection(decodeURIComponent(sec)); }, 260);
        // Landing on a page with a search term pre-fills its search box, so
        // picking a product in the palette shows you that product.
        var term = params.get('search');
        if (term) {
            var box = document.getElementById('searchInput');
            if (box) setTimeout(function () {
                box.value = term;
                box.dispatchEvent(new Event('keyup', { bubbles: true }));
                box.dispatchEvent(new Event('input', { bubbles: true }));
            }, 400);
        }
    }

    // ── Sections of the current page ───────────────────────────────────────
    var SECTION_SEL = '[data-jump-section], .panel-card, .settings-card, .analytics-chart-card, .report-card, .kpi-grid, .table-container';

    function sectionTitle(el) {
        if (el.dataset.jumpTitle) return el.dataset.jumpTitle;
        var h = el.querySelector('.panel-head h3, .card-header h3, h3, h2');
        if (h) {
            // Headings carry icon glyphs whose text is the ligature name
            // ("show_chart"), plus live badges — strip both before reading.
            var clone = h.cloneNode(true);
            clone.querySelectorAll('.material-symbols-outlined, .live-dot, .badge, .chip-count').forEach(function (n) { n.remove(); });
            return clone.textContent.replace(/\s+/g, ' ').trim().slice(0, 48);
        }
        if (el.classList.contains('kpi-grid')) return 'Key figures';
        if (el.classList.contains('table-container')) return 'Table';
        return '';
    }

    var TONES = ['coral', 'blue', 'green', 'amber', 'red', 'purple'];

    // Borrow the panel's own icon and colour so a section looks the same in
    // the palette as it does on the page.
    function sectionLook(el) {
        var chip = el.querySelector('.icon-chip, .kpi-icon');
        var look = { icon: 'my_location', tone: 'coral' };
        if (!chip) return look;
        var glyph = chip.querySelector('.material-symbols-outlined');
        if (glyph) look.icon = glyph.textContent.trim();
        for (var i = 0; i < TONES.length; i++) {
            if (chip.classList.contains(TONES[i])) { look.tone = TONES[i]; break; }
        }
        return look;
    }

    function collectSections() {
        var out = [], seen = {};
        document.querySelectorAll(SECTION_SEL).forEach(function (el, i) {
            if (el.closest('.modal, .fa-panel, #jumpOverlay')) return;
            if (!el.offsetParent && el.offsetHeight === 0) return;
            var title = sectionTitle(el);
            if (!title || seen[title.toLowerCase()]) return;
            seen[title.toLowerCase()] = true;
            if (!el.id) el.id = 'jump-sec-' + i;
            var look = sectionLook(el);
            out.push({ id: el.id, label: title, el: el, icon: look.icon, tone: look.tone });
        });
        return out;
    }

    var sections = [];

    function scrollToSection(idOrLabel) {
        var s = sections.filter(function (x) {
            return x.id === idOrLabel || x.label.toLowerCase() === String(idOrLabel).toLowerCase();
        })[0];
        if (!s) return false;
        var top = s.el.getBoundingClientRect().top + window.pageYOffset - 90;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        s.el.classList.remove('jump-flash');
        void s.el.offsetWidth;
        s.el.classList.add('jump-flash');
        setTimeout(function () { s.el.classList.remove('jump-flash'); }, 1600);
        return true;
    }

    // ── Fuzzy matching ─────────────────────────────────────────────────────
    // Straightforward subsequence scoring: exact and word-start matches win,
    // scattered letters still match but rank lower.
    function score(query, text) {
        if (!query) return 0.001;
        var t = text.toLowerCase(), q = query.toLowerCase();
        var idx = t.indexOf(q);
        if (idx === 0) return 1000 - t.length;
        if (idx > 0) return (t[idx - 1] === ' ' ? 800 : 600) - t.length + (10 - Math.min(idx, 10));
        var ti = 0, qi = 0, hits = 0, streak = 0, best = 0;
        while (ti < t.length && qi < q.length) {
            if (t[ti] === q[qi]) { qi++; hits++; streak++; best = Math.max(best, streak); }
            else streak = 0;
            ti++;
        }
        if (qi < q.length) return -1;
        return 200 + hits * 6 + best * 8 - t.length * 0.2;
    }

    function rank(query, item) {
        var s = score(query, item.label);
        var alt = Math.max(score(query, item.sub || ''), score(query, item.kw || ''));
        return Math.max(s, alt * 0.55);
    }

    // ── Recents ────────────────────────────────────────────────────────────
    function getRecents() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; }
    }
    function pushRecent(item) {
        if (!item.href) return;
        var list = getRecents().filter(function (r) { return r.href !== item.href; });
        list.unshift({ label: item.label, sub: item.sub, icon: item.icon, tone: item.tone, href: item.href });
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch (e) {}
    }

    // ── Overlay ────────────────────────────────────────────────────────────
    var overlay = null, input = null, listEl = null, cursor = 0, rows = [], searchTimer = null, searchToken = 0;

    function build() {
        overlay = document.createElement('div');
        overlay.id = 'jumpOverlay';
        overlay.className = 'jump-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Jump to');
        overlay.innerHTML =
            '<div class="jump-modal" role="combobox" aria-expanded="true" aria-haspopup="listbox">' +
                '<div class="jump-input-row">' +
                    '<span class="material-symbols-outlined jump-lead">bolt</span>' +
                    '<input id="jumpInput" type="text" autocomplete="off" spellcheck="false" ' +
                        'placeholder="Jump to a page, a section, an action, or a product…" aria-label="Jump to">' +
                    '<button class="jump-esc" type="button" aria-label="Close">esc</button>' +
                '</div>' +
                '<div class="jump-list" id="jumpList" role="listbox" tabindex="-1"></div>' +
                '<div class="jump-foot">' +
                    '<span><kbd>↑</kbd><kbd>↓</kbd> move</span>' +
                    '<span><kbd>↵</kbd> open</span>' +
                    '<span><kbd>esc</kbd> close</span>' +
                    '<span class="jump-foot-right"><kbd>⌘</kbd><kbd>J</kbd> anywhere</span>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        input = overlay.querySelector('#jumpInput');
        listEl = overlay.querySelector('#jumpList');
        localiseHints();

        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
        overlay.querySelector('.jump-esc').addEventListener('click', close);
        input.addEventListener('input', function () {
            render(input.value);
            clearTimeout(searchTimer);
            var q = input.value.trim();
            if (q.length >= 2) searchTimer = setTimeout(function () { liveSearch(q); }, 220);
        });
        input.addEventListener('keydown', onKey);
        listEl.addEventListener('mousemove', function (e) {
            var row = e.target.closest('.jump-row');
            if (row && +row.dataset.i !== cursor) { cursor = +row.dataset.i; paintCursor(); }
        });
        listEl.addEventListener('click', function (e) {
            var row = e.target.closest('.jump-row');
            if (row) activate(rows[+row.dataset.i]);
        });
    }

    function onKey(e) {
        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault(); move(1);
        } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault(); move(-1);
        } else if (e.key === 'Enter') {
            e.preventDefault(); if (rows[cursor]) activate(rows[cursor]);
        } else if (e.key === 'Escape') {
            e.preventDefault(); close();
        } else if (e.key === 'Home') {
            cursor = 0; paintCursor();
        } else if (e.key === 'End') {
            cursor = rows.length - 1; paintCursor();
        }
    }

    function move(d) {
        if (!rows.length) return;
        cursor = (cursor + d + rows.length) % rows.length;
        paintCursor();
    }

    function paintCursor() {
        listEl.querySelectorAll('.jump-row').forEach(function (r) {
            var on = +r.dataset.i === cursor;
            r.classList.toggle('is-active', on);
            r.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) r.scrollIntoView({ block: 'nearest' });
        });
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Underline the letters that matched, so it is obvious why a row is here.
    function highlight(text, query) {
        if (!query) return esc(text);
        var t = text, q = query.toLowerCase(), lt = t.toLowerCase();
        var i = lt.indexOf(q);
        if (i >= 0) {
            return esc(t.slice(0, i)) + '<b>' + esc(t.slice(i, i + q.length)) + '</b>' + esc(t.slice(i + q.length));
        }
        // Scattered-letter highlighting only makes sense when the whole query
        // is actually in this string — a row matched through its description
        // should not sprout random bold letters in its title.
        var out = '', qi = 0;
        for (var k = 0; k < t.length; k++) {
            if (qi < q.length && lt[k] === q[qi]) { out += '<b>' + esc(t[k]) + '</b>'; qi++; }
            else out += esc(t[k]);
        }
        return qi === q.length ? out : esc(text);
    }

    function rowHtml(item, i, query) {
        return '<div class="jump-row" role="option" data-i="' + i + '" aria-selected="false">' +
            '<span class="jump-ico ' + (item.tone || 'blue') + '"><span class="material-symbols-outlined">' + esc(item.icon || 'arrow_forward') + '</span></span>' +
            '<span class="jump-text">' +
                '<span class="jump-title">' + highlight(item.label, query) + '</span>' +
                (item.sub ? '<span class="jump-sub">' + esc(item.sub) + '</span>' : '') +
            '</span>' +
            (item.badge ? '<span class="jump-badge">' + esc(item.badge) + '</span>' : '') +
            '<span class="material-symbols-outlined jump-go">' + (item.kind === 'section' ? 'south' : 'subdirectory_arrow_left') + '</span>' +
        '</div>';
    }

    var liveResults = [];
    var searchedFor = null;   // the last query we actually got an answer for

    function render(query) {
        query = (query || '').trim();
        rows = [];
        var html = '';
        var groups = [];

        if (!query) {
            var rec = getRecents();
            if (rec.length) groups.push({ title: 'Recent', items: rec.map(function (r) { r.kind = 'place'; return r; }) });
        }

        // sections of the page you're already on
        var secItems = sections.map(function (s) {
            return {
                label: s.label, sub: '', icon: s.icon, tone: s.tone,
                kind: 'section', sectionId: s.id,
                kw: s.label      // match on the heading only — generic words
                                 // like "section" would match almost anything
            };
        });
        var matched = function (arr) {
            if (!query) return arr;
            return arr.map(function (it) { return { it: it, s: rank(query, it) }; })
                .filter(function (x) { return x.s > 0; })
                .sort(function (a, b) { return b.s - a.s; })
                .map(function (x) { return x.it; });
        };

        var secs = matched(secItems);
        if (secs.length) groups.push({ title: 'On this page', items: secs.slice(0, query ? 6 : 8) });

        var places = matched(PLACES.filter(allowed).map(function (p) { var c = Object.create(p); c.kind = 'place'; return c; }));
        if (places.length) groups.push({ title: 'Go to', items: query ? places.slice(0, 7) : places.slice(0, 11) });

        var acts = matched(ACTIONS.filter(allowed).map(function (a) { var c = Object.create(a); c.kind = 'action'; return c; }));
        if (acts.length) groups.push({ title: 'Quick actions', items: query ? acts.slice(0, 6) : acts.slice(0, 5) });

        if (query.length >= 2 && liveResults.length) {
            groups.push({ title: 'From your data', items: liveResults });
        }

        var i = 0;
        groups.forEach(function (g) {
            if (!g.items.length) return;
            html += '<div class="jump-group">' + esc(g.title) + '</div>';
            g.items.forEach(function (it) {
                html += rowHtml(it, i, query);
                rows.push(it);
                i++;
            });
        });

        if (!rows.length) {
            html = '<div class="jump-empty">' +
                '<span class="material-symbols-outlined">travel_explore</span>' +
                '<p>Nothing matches “' + esc(query) + '”.</p>' +
                '<small>Try a page name, a product, or what you want to do — “low stock”, “end of day”, “forecast”.</small>' +
            '</div>';
        } else if (query.length >= 2 && !liveResults.length && searchedFor !== query) {
            html += '<div class="jump-searching" id="jumpSearching">Searching your products and suppliers…</div>';
        }

        listEl.innerHTML = html;
        cursor = 0;
        paintCursor();
    }

    async function liveSearch(query) {
        var token = ++searchToken;
        try {
            var headers = typeof getAuthHeaders === 'function' ? getAuthHeaders() : {};
            var res = await Promise.all([
                fetch(API_BASE + '/products?search=' + encodeURIComponent(query) + '&limit=5&fields=light', { headers: headers }).then(function (r) { return r.json(); }),
                fetch(API_BASE + '/suppliers', { headers: headers }).then(function (r) { return r.json(); })
            ]);
            if (token !== searchToken || !overlay.classList.contains('active')) return;

            var q = query.toLowerCase();
            var out = [];
            (res[0].data || []).forEach(function (p) {
                var stock = p.stock_quantity == null ? 0 : p.stock_quantity;
                out.push({
                    label: p.name,
                    sub: 'SKU ' + (p.sku || '—') + ' · ' + (typeof formatNumber === 'function' ? formatNumber(stock) : stock) + ' in stock' +
                         (p.unit_price != null && typeof formatCurrency === 'function' ? ' · ' + formatCurrency(p.unit_price) : ''),
                    icon: 'inventory_2', tone: 'blue', kind: 'data',
                    badge: stock <= 0 ? 'out of stock' : '',
                    href: 'inventory.html?search=' + encodeURIComponent(p.name)
                });
            });
            (res[1].data || []).filter(function (s) {
                return (s.name || '').toLowerCase().includes(q) || (s.contact_person || '').toLowerCase().includes(q);
            }).slice(0, 4).forEach(function (s) {
                out.push({
                    label: s.name,
                    sub: 'Supplier' + (s.contact_person ? ' · ' + s.contact_person : '') + (s.city ? ' · ' + s.city : ''),
                    icon: 'local_shipping', tone: 'amber', kind: 'data',
                    href: 'suppliers.html'
                });
            });
            liveResults = out;
            searchedFor = query;
            render(input.value);
        } catch (e) {
            if (token !== searchToken) return;
            var el = document.getElementById('jumpSearching');
            if (el) el.textContent = 'Could not reach the server for live results.';
        }
    }

    function activate(item) {
        if (!item) return;
        if (item.kind === 'section') {
            close();
            setTimeout(function () { scrollToSection(item.sectionId); }, 120);
            return;
        }
        if (item.run) { close(); item.run(); return; }
        if (!item.href) return;
        pushRecent(item);
        var here = path.split('/').pop() || 'dashboard.html';
        var target = item.href.split('?')[0];
        close();
        if (target === here && item.href.indexOf('?') === -1) return; // already here
        window.location.href = item.href;
    }

    function open(prefill) {
        dismissTip();
        if (!overlay) build();
        sections = collectSections();
        liveResults = [];
        searchedFor = null;
        overlay.classList.add('active');
        document.body.classList.add('jump-open');
        // the document scrolls on <html>, so lock it there too
        document.documentElement.style.overflow = 'hidden';
        input.value = prefill || '';
        render(input.value);
        setTimeout(function () { input.focus(); input.select(); }, 20);
    }

    function close() {
        if (!overlay) return;
        overlay.classList.remove('active');
        document.body.classList.remove('jump-open');
        document.documentElement.style.overflow = '';
        clearTimeout(searchTimer);
        searchToken++;
    }

    // ── Section rail ───────────────────────────────────────────────────────
    // A quiet spine of dots down the right edge: where you are, and one click
    // to anywhere else on the page.
    var rail = null;

    function buildRail() {
        if (rail) { rail.remove(); rail = null; }
        if (window.innerWidth < 1400) return;
        sections = collectSections();
        if (sections.length < 3) return;

        rail = document.createElement('nav');
        rail.className = 'jump-rail';
        rail.setAttribute('aria-label', 'Sections on this page');
        rail.innerHTML = sections.map(function (s, i) {
            return '<button class="jump-rail-dot" data-i="' + i + '" title="' + esc(s.label) + '" aria-label="' + esc(s.label) + '">' +
                '<span class="jump-rail-label">' + esc(s.label) + '</span></button>';
        }).join('');
        document.body.appendChild(rail);

        rail.addEventListener('click', function (e) {
            var b = e.target.closest('.jump-rail-dot');
            if (b) scrollToSection(sections[+b.dataset.i].id);
        });

        // highlight whichever section is nearest the top of the viewport
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var i = sections.findIndex(function (s) { return s.el === en.target; });
                if (i < 0) return;
                var dot = rail.querySelector('.jump-rail-dot[data-i="' + i + '"]');
                if (dot) dot.classList.toggle('is-visible', en.isIntersecting);
            });
            var first = rail.querySelector('.jump-rail-dot.is-visible');
            rail.querySelectorAll('.jump-rail-dot').forEach(function (d) { d.classList.remove('is-current'); });
            if (first) first.classList.add('is-current');
        }, { rootMargin: '-80px 0px -55% 0px', threshold: 0.01 });
        sections.forEach(function (s) { io.observe(s.el); });
    }

    // ── Back to top ────────────────────────────────────────────────────────
    function buildTopButton() {
        var btn = document.createElement('button');
        btn.className = 'jump-top';
        btn.type = 'button';
        btn.title = 'Back to top';
        btn.setAttribute('aria-label', 'Back to top');
        btn.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_up</span>';
        btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
        document.body.appendChild(btn);

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () {
                btn.classList.toggle('is-on', window.pageYOffset > 360);
                ticking = false;
            });
        }, { passive: true });
    }

    // ── Trigger button in the sidebar (present on every page) ──────────────
    function buildSidebarTrigger() {
        var actions = document.querySelector('.sidebar-actions');
        if (!actions || document.getElementById('jumpSidebarBtn')) return;
        var b = document.createElement('button');
        b.id = 'jumpSidebarBtn';
        b.className = 'sidebar-btn jump-sidebar-btn';
        b.type = 'button';
        b.title = 'Jump to anywhere (Ctrl/⌘ + J)';
        b.innerHTML = '<span class="material-symbols-outlined">bolt</span>';
        b.addEventListener('click', function () { open(); });
        actions.insertBefore(b, actions.firstChild);
    }

    // ── First-run hint ─────────────────────────────────────────────────────
    // A feature nobody finds is a feature nobody has. Point at the button
    // once, then never again.
    var TIP_KEY = 'jumpTipSeen';

    function dismissTip() {
        var tip = document.getElementById('jumpTip');
        if (tip) tip.remove();
        try { localStorage.setItem(TIP_KEY, '1'); } catch (e) {}
    }

    function buildTip() {
        var anchor = document.getElementById('jumpCta');
        if (!anchor) return;
        try { if (localStorage.getItem(TIP_KEY)) return; } catch (e) { return; }

        var tip = document.createElement('div');
        tip.id = 'jumpTip';
        tip.className = 'jump-tip';
        tip.innerHTML =
            '<div class="jump-tip-head"><span class="material-symbols-outlined">bolt</span> New — Jump to…</div>' +
            '<p>One box for everything: any page, any section of the page you are on, ' +
            'quick actions like <em>end of day</em>, and your own products and suppliers.</p>' +
            '<div class="jump-tip-foot"><span>Press <kbd class="jump-tip-key">⌘J</kbd> anywhere</span>' +
            '<button type="button" class="btn-primary" id="jumpTipOk">Got it</button></div>';
        document.body.appendChild(tip);

        var r = anchor.getBoundingClientRect();
        tip.style.top = (r.bottom + window.pageYOffset + 12) + 'px';
        tip.style.left = Math.max(12, r.right - tip.offsetWidth) + 'px';
        if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
            tip.querySelector('.jump-tip-key').textContent = 'Ctrl J';
        }

        tip.querySelector('#jumpTipOk').addEventListener('click', dismissTip);
        setTimeout(function () {
            document.addEventListener('click', function once(e) {
                if (!tip.contains(e.target)) { dismissTip(); document.removeEventListener('click', once); }
            });
        }, 0);
    }

    // ── Public API + shortcuts ─────────────────────────────────────────────
    window.openJump = open;
    window.closeJump = close;
    window.jumpToSection = scrollToSection;
    // ⌘K used to open a search-only dialog; the palette is a superset of it.
    window.openGlobalSearch = function () { open(); };
    window.closeGlobalSearch = close;

    document.addEventListener('keydown', function (e) {
        var k = (e.key || '').toLowerCase();
        if ((e.metaKey || e.ctrlKey) && (k === 'j' || k === 'k')) {
            e.preventDefault();
            e.stopPropagation();
            if (overlay && overlay.classList.contains('active')) close(); else open();
        }
    }, true);

    // Windows and Linux users press Ctrl, not ⌘ — say so.
    function localiseHints() {
        var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        if (mac) return;
        var cta = document.querySelector('#jumpCta kbd');
        if (cta) cta.textContent = 'Ctrl J';
        if (overlay) {
            var right = overlay.querySelector('.jump-foot-right');
            if (right) right.innerHTML = '<kbd>Ctrl</kbd><kbd>J</kbd> anywhere';
        }
    }

    function init() {
        buildSidebarTrigger();
        buildTopButton();
        localiseHints();
        runDeepLink();
        // Pages fill in their cards after the data lands — rebuild once things
        // have settled rather than on every mutation.
        setTimeout(buildRail, 900);
        setTimeout(buildRail, 2600);
        setTimeout(buildTip, 1400);
        var rt;
        window.addEventListener('resize', function () {
            clearTimeout(rt);
            rt = setTimeout(buildRail, 250);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
