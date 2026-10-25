/* The paw loader: shown after a click that has to wait for the server
   (deleting, saving, confirming, opening a record), never for a page's own
   first load, which keeps its placeholder bars and "Loading…" text.

   If a request started by a click is still running after a moment, a small
   box in the middle of the screen shows paw prints stepping across, with
   what is happening ("Deleting…", "Saving…", "Loading…"). It holds the
   screen until the request is done, so nothing is pressed twice. After
   6 seconds it adds that the server may be waking up (the free host sleeps
   when idle). */
(function () {
    'use strict';
    var SHOW_AFTER_MS = 300;    // quick actions never show it
    var WAIT_NOTE_MS = 6000;    // when to mention the sleeping server
    var CLICK_WINDOW_MS = 800;  // a request this soon after a click belongs to that click

    var box = null, active = 0, showTimer = null, noteTimer = null, label = 'Loading…';

    function build() {
        box = document.createElement('div');
        box.className = 'fl-overlay';
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');
        box.innerHTML = '<div class="fl-card"><span class="fl-paws" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
            '<span class="fl-text"></span><span class="fl-wait">Waking up the server. This can take up to a minute.</span></div>';
        document.body.appendChild(box);
    }
    function show() {
        if (!box) build();
        box.querySelector('.fl-text').textContent = label;
        box.classList.remove('waiting');
        box.classList.add('on');
        noteTimer = setTimeout(function () { box.classList.add('waiting'); }, WAIT_NOTE_MS - SHOW_AFTER_MS);
    }
    function hide() {
        clearTimeout(showTimer); clearTimeout(noteTimer); showTimer = noteTimer = null;
        if (box) box.classList.remove('on', 'waiting');
    }

    var lastClick = { el: null, at: 0 };
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button, a, [onclick], [role="button"]') : null;
        if (b) lastClick = { el: b, at: Date.now() };
    }, true);

    function urlOf(input) { return String(input && input.url ? input.url : input); }
    function methodOf(input, init) { return String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); }
    function wordFor(method, url) {
        if (method === 'DELETE') return 'Deleting…';
        if (method === 'GET') return 'Loading…';
        if (/\/void-request\/dismiss/.test(url)) return 'Saving…';
        if (/\/void-request\b/.test(url)) return 'Sending…';          // a cashier asking for a void
        if (/\/void\b/.test(url)) return 'Voiding…';
        if (/receive/.test(url)) return 'Receiving…';
        if (/email|send|resend|reorder|auto-reorder/.test(url)) return 'Sending…';
        if (/import|bulk/.test(url)) return 'Importing…';
        if (/export|backup/.test(url)) return 'Preparing…';
        return 'Saving…';
    }

    var realFetch = window.fetch;
    if (realFetch) {
        window.fetch = function (input, init) {
            var url = urlOf(input);
            var clicked = lastClick.el && Date.now() - lastClick.at < CLICK_WINDOW_MS;
            // only the shop's own API, only after a click, and not the chat window (it has its own dots)
            if (url.indexOf('/api/') === -1 || !clicked || url.indexOf('/api/assistant') !== -1
                || (lastClick.el.closest && lastClick.el.closest('.fa-panel, .fa-fab'))) {
                return realFetch.apply(this, arguments);
            }
            var method = methodOf(input, init);
            // a delete or save says so even if a quicker look-up runs beside it
            if (active === 0 || method !== 'GET') label = wordFor(method, url);
            active++;
            if (active === 1) showTimer = setTimeout(function () { showTimer = null; if (active > 0) show(); }, SHOW_AFTER_MS);
            var done = function () { active = Math.max(0, active - 1); if (active === 0) hide(); };
            var p = realFetch.apply(this, arguments);
            p.then(done, done);
            return p;
        };
    }
})();
