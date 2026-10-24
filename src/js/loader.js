/* Loading, shown the same way on every page.

   1. A list or panel waiting for data shows paw prints stepping across it,
      with what is loading under them. That is any element holding only
      "Loading…" text, and any group of the grey placeholder bars (.skeleton)
      the pages start with. If it is still waiting after 6 seconds, a line
      says the server may be waking up (the free host sleeps when idle).
   2. A request that takes longer than a moment runs a thin bar across the
      top of the screen, and the button that started it shows a spinner and
      cannot be pressed again until the request is done.

   Nothing here changes what a page does: the page still replaces its own
   placeholder when the data arrives. */
(function () {
    'use strict';
    var WAIT_NOTE_MS = 6000;   // when to mention the sleeping server
    var BAR_DELAY_MS = 300;    // quick requests never show the bar
    var CLICK_WINDOW_MS = 800; // a request this soon after a click belongs to that button

    var LOADING_TEXT = /^Loading\b[^]*?(…|\.\.\.)$/;
    var LABELS = {
        productsTableBody: 'Loading products…', productsGrid: 'Loading products…',
        salesTableBody: 'Loading sales…', usersTableBody: 'Loading users…',
        suppliersTableBody: 'Loading suppliers…', notifList: 'Loading notifications…',
        recentSalesList: 'Loading recent sales…', lowStockList: 'Loading products…',
        recentPOList: 'Loading purchase orders…'
    };

    function paws() {
        var s = document.createElement('span');
        s.className = 'fl-paws';
        s.setAttribute('aria-hidden', 'true');
        s.innerHTML = '<i></i><i></i><i></i><i></i>';
        return s;
    }

    function waitNote(host) {
        setTimeout(function () {
            if (!host.isConnected || !host.classList.contains('fl-host') || host.querySelector('.fl-wait')) return;
            var w = document.createElement('span');
            w.className = 'fl-wait';
            w.textContent = 'Waking up the server. This can take up to a minute.';
            host.appendChild(w);
        }, WAIT_NOTE_MS);
    }

    // An element that holds only "Loading…" text gets the paws above its text.
    function decorateText(el) {
        if (el.classList.contains('fl-host') || el.children.length) return;
        var text = (el.textContent || '').trim();
        if (!LOADING_TEXT.test(text)) return;
        el.classList.add('fl-host');
        el.setAttribute('role', 'status');
        el.textContent = '';
        el.appendChild(paws());
        var t = document.createElement('span');
        t.className = 'fl-text';
        t.textContent = text;
        el.appendChild(t);
        waitNote(el);
    }

    // A group of grey placeholder bars is swapped for one paw loader.
    function decorateSkeletons(root) {
        var bars = root.querySelectorAll ? root.querySelectorAll('.skeleton') : [];
        var done = new Set();
        for (var i = 0; i < bars.length; i++) {
            var bar = bars[i];
            var tbody = bar.closest('tbody');
            var group = tbody || bar.closest('[id]');
            if (!group || done.has(group) || !group.isConnected) continue;
            done.add(group);
            // a lone bar stands for one number on a summary card; paws are for lists
            if (group.querySelectorAll('.skeleton').length < 2) continue;
            var label = LABELS[group.id] || 'Loading…';
            if (tbody) {
                var cols = (tbody.closest('table') && tbody.closest('table').querySelectorAll('thead th').length) || 1;
                tbody.innerHTML = '<tr><td colspan="' + cols + '"></td></tr>';
                var td = tbody.querySelector('td');
                td.textContent = label;
                decorateText(td);
            } else {
                var host = document.createElement('div');
                host.textContent = label;
                group.innerHTML = '';
                group.appendChild(host);
                decorateText(host);
            }
        }
    }

    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        decorateSkeletons(root);
        var list = root.matches && root.matches('td, p, div') ? [root] : [];
        var found = root.querySelectorAll('td, p, div');
        for (var i = 0; i < found.length; i++) list.push(found[i]);
        for (var j = 0; j < list.length; j++) decorateText(list[j]);
    }

    function startWatching() {
        scan(document.body);
        new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (r.type === 'childList') {
                    for (var k = 0; k < r.addedNodes.length; k++) scan(r.addedNodes[k]);
                    if (r.target.nodeType === 1 && r.target.matches('td, p, div')) decorateText(r.target);
                } else if (r.type === 'characterData' && r.target.parentElement) {
                    var p = r.target.parentElement;
                    if (p.matches('td, p, div')) decorateText(p);
                }
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    /* ---- the top bar and the busy button ---- */
    var bar = null, inFlight = 0, barTimer = null;
    function showBar(on) {
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'fl-bar';
            bar.setAttribute('aria-hidden', 'true');
            document.body.appendChild(bar);
        }
        bar.classList.toggle('on', on);
    }
    function requestStarted() {
        inFlight++;
        if (inFlight === 1 && !barTimer) barTimer = setTimeout(function () { barTimer = null; if (inFlight > 0) showBar(true); }, BAR_DELAY_MS);
    }
    function requestEnded() {
        inFlight = Math.max(0, inFlight - 1);
        if (inFlight === 0) {
            if (barTimer) { clearTimeout(barTimer); barTimer = null; }
            if (bar) showBar(false);
        }
    }

    var lastClick = { button: null, at: 0 };
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (b) lastClick = { button: b, at: Date.now() };
    }, true);

    function isApi(url) {
        var u = String(url && url.url ? url.url : url);
        return u.indexOf('/api/') !== -1 && u.indexOf('/api/health') === -1;
    }

    var realFetch = window.fetch;
    if (realFetch) {
        window.fetch = function (input, init) {
            if (!isApi(input)) return realFetch.apply(this, arguments);
            var btn = (lastClick.button && Date.now() - lastClick.at < CLICK_WINDOW_MS && lastClick.button.isConnected) ? lastClick.button : null;
            if (btn) {
                btn.__flCount = (btn.__flCount || 0) + 1;
                btn.classList.add('fl-busy');
                btn.setAttribute('aria-busy', 'true');
            }
            requestStarted();
            var finish = function () {
                requestEnded();
                if (btn && --btn.__flCount <= 0) { btn.classList.remove('fl-busy'); btn.removeAttribute('aria-busy'); }
            };
            var p = realFetch.apply(this, arguments);
            p.then(finish, finish);
            return p;
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWatching);
    else startWatching();
})();
