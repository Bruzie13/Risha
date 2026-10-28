/* The paw loader: shown after a click that has to wait for the server
   (deleting, saving, confirming, opening a record), never for a page's own
   first load, which keeps its placeholder bars and "Loading…" text.

   If a request started by a click is still running after a moment, a small
   box in the middle of the screen shows paw prints stepping across, with
   what is happening in words: the button's own words as an action
   ("Confirm order" → "Confirming order…"), or, for a button that is not
   an action, from the WORDS list below. It holds the
   screen until the request is done, so nothing is pressed twice. After
   6 seconds it adds that the server may be waking up (the free host sleeps
   when idle). */
(function () {
    'use strict';
    var SHOW_AFTER_MS = 300;    // quick actions never show it
    var WAIT_NOTE_MS = 6000;    // when to mention the sleeping server
    var CLICK_WINDOW_MS = 800;  // a request this soon after a click belongs to that click

    var box = null, active = 0, showTimer = null, noteTimer = null, label = 'Loading…';
    var held = false;           // shown on purpose by flLoader.hold(): requests finishing do not hide it

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
        if (held) return;
        clearTimeout(showTimer); clearTimeout(noteTimer); showTimer = noteTimer = null;
        if (box) box.classList.remove('on', 'waiting');
    }

    var lastClick = { el: null, at: 0 };
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button, a, [onclick], [role="button"]') : null;
        if (b) lastClick = { el: b, at: Date.now() };
    }, true);
    // pressing Enter in a form (signing in, a search, a count) counts like a click
    document.addEventListener('submit', function (e) { lastClick = { el: e.target, at: Date.now() }; }, true);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target && /^(INPUT|SELECT)$/.test(e.target.tagName)) lastClick = { el: e.target, at: Date.now() };
    }, true);

    function urlOf(input) { return String(input && input.url ? input.url : input); }
    function methodOf(input, init) { return String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); }
    /* What the box says for each request, matched in order: the method (or *
       for any), a pattern for the path after /api, and the words. A body
       pattern picks between words that depend on what was sent (an order
       being received or cancelled, a request approved or rejected). */
    var WORDS = [
        // signing in and accounts
        ['POST', /^\/auth\/login$/, 'Signing in…'],
        ['POST', /^\/auth\/logout$/, 'Signing out…'],
        ['POST', /^\/auth\/register$/, 'Creating the account…'],
        ['POST', /^\/auth\/forgot-password$/, 'Sending the reset link…'],
        ['POST', /^\/auth\/reset-password$/, 'Saving your new password…'],
        ['POST', /^\/auth\/verify-email$/, 'Confirming your email…'],
        ['POST', /resend-verification$/, 'Sending the confirmation link…'],
        ['POST', /^\/auth\/email-code$/, 'Sending the code…'],
        ['POST', /^\/auth\/reset-requests\/\d+\/approve/, 'Approving the reset…'],
        ['POST', /^\/auth\/reset-requests\/\d+\/decline/, 'Turning down the reset…'],
        ['POST', /^\/auth\/reset-requests\//, 'Saving the decision…'],
        ['PUT', /^\/auth\/users\/\d+\/status$/, 'Updating the account…'],
        ['PUT', /^\/auth\/users\/\d+$/, 'Saving the account…'],
        ['DELETE', /^\/auth\/users\/\d+$/, 'Deleting the account…'],
        ['PUT', /^\/auth\/profile$/, 'Saving your profile…'],
        ['PUT', /^\/auth\/change-password$/, 'Changing your password…'],
        ['GET', /^\/auth\/users/, 'Loading accounts…'],
        // products and stock
        ['POST', /^\/products\/bulk$/, 'Importing products…'],
        ['POST', /^\/products$/, 'Adding the product…'],
        ['PUT', /^\/products\/\d+\/stock$/, 'Updating the stock…'],
        ['PUT', /^\/products\/\d+$/, 'Saving the product…'],
        ['DELETE', /^\/products\/\d+$/, 'Deleting the product…'],
        ['GET', /^\/products\/\d+$/, 'Loading the product…'],
        ['GET', /^\/products/, 'Loading products…'],
        // the till, sales and cash
        ['POST', /^\/sales\/till\/open$/, 'Opening the drawer…'],
        ['POST', /^\/sales\/till\/cash$/, 'Recording the cash…'],
        ['PUT', /^\/sales\/pos-settings$/, 'Saving the till settings…'],
        ['POST', /^\/sales\/eod$/, 'Saving the cash count…'],
        ['DELETE', /^\/sales\/eod\/\d+$/, 'Reopening the count…'],
        ['GET', /^\/sales\/eod/, 'Loading the cash count…'],
        ['POST', /^\/sales\/\d+\/void-request\/dismiss$/, 'Turning down the void request…'],
        ['POST', /^\/sales\/\d+\/void-request$/, 'Sending the void request…'],
        ['POST', /^\/sales\/\d+\/void$/, 'Voiding the sale…'],
        ['POST', /^\/sales$/, 'Recording the sale…'],
        ['DELETE', /^\/sales\/\d+$/, 'Deleting the sale…'],
        ['GET', /^\/sales\/report/, 'Loading the report…'],
        ['GET', /^\/sales\/void-requests/, 'Loading void requests…'],
        ['GET', /^\/sales\/\d+$/, 'Loading the sale…'],
        ['GET', /^\/sales/, 'Loading sales…'],
        ['POST', /^\/receipt-printer\/print$/, 'Printing the receipt…'],
        // suppliers and orders
        ['POST', /^\/suppliers$/, 'Adding the supplier…'],
        ['PUT', /^\/suppliers\/\d+$/, 'Saving the supplier…'],
        ['DELETE', /^\/suppliers\/\d+$/, 'Deleting the supplier…'],
        ['GET', /^\/suppliers\/\d+\/performance$/, 'Loading performance…'],
        ['GET', /^\/suppliers/, 'Loading suppliers…'],
        ['GET', /^\/email-logs\//, 'Loading the email history…'],
        ['PUT', /^\/purchase-orders\/\d+\/status$/, 'Receiving the delivery…', /"status"\s*:\s*"received"/],
        ['PUT', /^\/purchase-orders\/\d+\/status$/, 'Cancelling the order…', /"status"\s*:\s*"cancelled"/],
        ['PUT', /^\/purchase-orders\/\d+\/status$/, 'Confirming the order…', /"status"\s*:\s*"confirmed"/],
        ['PUT', /^\/purchase-orders\/\d+\/status$/, 'Marking it as shipped…', /"status"\s*:\s*"shipped"/],
        ['PUT', /^\/purchase-orders\/\d+\/status$/, 'Updating the order…'],
        ['POST', /^\/purchase-orders\/\d+\/send-email$/, 'Emailing the supplier…'],
        ['PUT', /^\/purchase-orders\/\d+\/payment$/, 'Recording the payment…'],
        ['POST', /^\/purchase-orders\/auto-generate$/, 'Creating the orders…'],
        ['POST', /^\/purchase-orders\/price-proposals\/\d+\/decide$/, 'Accepting the price…', /"approve"\s*:\s*true/],
        ['POST', /^\/purchase-orders\/price-proposals\/\d+\/decide$/, 'Turning down the price…', /"approve"\s*:\s*false/],
        ['POST', /^\/purchase-orders\/price-proposals\/\d+\/decide$/, 'Saving the decision…'],
        ['POST', /\/messages$/, 'Sending the note…'],
        ['GET', /\/messages$/, 'Loading notes…'],
        ['GET', /^\/purchase-orders/, 'Loading orders…'],
        // the supplier's own portal
        ['PUT', /^\/supplier-portal\/me$/, 'Saving your details…'],
        ['POST', /^\/supplier-portal\/products\/\d+\/price$/, 'Sending the new price…'],
        ['POST', /^\/supplier-portal\/orders\/\d+\/confirm$/, 'Confirming the order…'],
        ['PUT', /^\/supplier-portal\/orders\/\d+\/promise$/, 'Saving the delivery date…'],
        ['POST', /^\/supplier-portal\/orders\/\d+\/ship$/, 'Marking it as shipped…'],
        ['POST', /^\/supplier-portal\/offers$/, 'Sending the offer…'],
        ['GET', /^\/supplier-portal/, 'Loading…'],
        // notifications, settings and the rest
        ['PUT', /^\/notifications\/read-all$/, 'Marking all as read…'],
        ['PUT', /^\/notifications\/\d+\/read$/, 'Marking it as read…'],
        ['DELETE', /^\/notifications\/read$/, 'Clearing read notifications…'],
        ['POST', /^\/notifications\/check-alerts$/, 'Checking for alerts…'],
        ['GET', /^\/notifications/, 'Loading notifications…'],
        ['POST', /^\/email-settings\/test$/, 'Sending a test email…'],
        ['PUT', /^\/email-settings$/, 'Saving the email settings…'],
        ['GET', /^\/backup/, 'Preparing the backup…'],
        ['GET', /^\/predictions/, 'Loading the forecast…'],
        ['GET', /^\/audit-logs/, 'Loading the activity log…'],
        ['GET', /^\/dashboard/, 'Loading the dashboard…'],
        // anything not listed: the kind of request
        ['DELETE', /./, 'Deleting…'],
        ['GET', /./, 'Loading…'],
        ['*', /./, 'Saving…']
    ];
    function wordFor(method, url, body) {
        var path = url.replace(/^.*?\/api(?=\/)/, '').split('?')[0];
        var sent = typeof body === 'string' ? body : '';
        for (var i = 0; i < WORDS.length; i++) {
            var w = WORDS[i];
            if ((w[0] === '*' || w[0] === method) && w[1].test(path) && (!w[3] || w[3].test(sent))) return w[2];
        }
        return 'Loading…';
    }

    /* For a step that ends by leaving the page (signing out): the box shows
       at once, not after the usual moment, and stays until the next page
       replaces this one. flLoader.release() puts it away if the step stops. */
    window.flLoader = {
        hold: function (text) {
            held = true;
            label = text || 'Loading…';
            clearTimeout(showTimer); showTimer = null;
            if (!box || !box.classList.contains('on')) show();
            else box.querySelector('.fl-text').textContent = label;
        },
        release: function () { held = false; if (active === 0) hide(); }
    };

    /* The words come from the button that was pressed, when it starts with
       an action: "Confirm order" shows "Confirming order…", "Save supplier"
       "Saving supplier…", the trash button titled "Delete sale" "Deleting
       sale…". A button that is not an action word (the star rating, "Emails")
       falls back to the WORDS list above. */
    var ING = {
        accept: 'Accepting', add: 'Adding', apply: 'Applying', approve: 'Approving', ask: 'Asking',
        cancel: 'Cancelling', change: 'Changing', check: 'Checking', clear: 'Clearing', close: 'Closing',
        confirm: 'Confirming', create: 'Creating', decline: 'Declining', delete: 'Deleting', disable: 'Disabling',
        dismiss: 'Dismissing', email: 'Emailing', enable: 'Enabling', export: 'Exporting', generate: 'Generating',
        import: 'Importing', keep: 'Keeping', mark: 'Marking', offer: 'Offering', open: 'Opening', pay: 'Paying',
        print: 'Printing', receive: 'Receiving', record: 'Recording', refresh: 'Refreshing', reject: 'Rejecting',
        remove: 'Removing', reopen: 'Reopening', reorder: 'Reordering', resend: 'Resending', reset: 'Resetting',
        restore: 'Restoring', retry: 'Trying again', save: 'Saving', send: 'Sending', ship: 'Shipping',
        sign: 'Signing', submit: 'Submitting', test: 'Testing', turn: 'Turning', update: 'Updating',
        upload: 'Uploading', verify: 'Checking', view: 'Opening', void: 'Voiding'
    };
    function buttonText(el) {
        if (!el) return '';
        // a form pressed with Enter speaks for its submit button
        if (el.tagName === 'FORM' || el.form) {
            var f = el.tagName === 'FORM' ? el : el.form;
            var sb = f && f.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
            if (sb) el = sb; else return '';
        }
        var copy = el.cloneNode(true);
        // icon names ("check", "delete") are text in the button, not words on it
        copy.querySelectorAll && copy.querySelectorAll('.material-symbols-outlined, .material-icons, [aria-hidden="true"]').forEach(function (n) { n.remove(); });
        var text = (copy.textContent || copy.value || '').replace(/\s+/g, ' ').trim();
        if (!text) text = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        return text;
    }
    function wordFromButton(el) {
        var text = buttonText(el).replace(/^(yes|ok|okay)\s*,\s*/i, '').replace(/[.…!]+$/, '').trim();
        if (!text || text.length > 40) return null;
        var words = text.split(' ');
        var verb = ING[words[0].toLowerCase()];
        if (!verb) return null;
        var rest = words.slice(1).map(function (w) {
            // order numbers and short capitals stay as written; other words in small letters
            return /\d|^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase();
        }).join(' ');
        return (verb + (rest ? ' ' + rest : '')) + '…';
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
            if (!held && (active === 0 || method !== 'GET')) label = wordFromButton(lastClick.el) || wordFor(method, url, init && init.body);
            active++;
            if (active === 1) showTimer = setTimeout(function () { showTimer = null; if (active > 0) show(); }, SHOW_AFTER_MS);
            var done = function () { active = Math.max(0, active - 1); if (active === 0) hide(); };
            var p = realFetch.apply(this, arguments);
            p.then(done, done);
            return p;
        };
    }
})();
