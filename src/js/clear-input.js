/* An × inside a typing box, to empty it in one press.

   It shows in the box being typed in, once there is something in it: the
   searches, names, notes, emails and the like. Pressing it empties the box,
   tells the page it changed (so a search shows everything again) and leaves
   the cursor in the box. Number, date and password boxes are left alone
   (they have their own controls), and so is any box marked data-no-clear.

   One button serves every box: it is laid over the box in use rather than
   added into each, so no page's layout moves. */
(function () {
    'use strict';
    var TYPES = ['text', 'search', 'email', 'tel', 'url', ''];
    var MIN_WIDTH = 90;     // narrower boxes have no room for it

    var btn = null, box = null, padded = null;

    function eligible(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        if (TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) === -1) return false;
        if (el.readOnly || el.disabled || el.hasAttribute('data-no-clear')) return false;
        return el.offsetWidth >= MIN_WIDTH;
    }

    function build() {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fx-clear';
        btn.title = 'Clear';
        btn.setAttribute('aria-label', 'Clear this box');
        btn.tabIndex = -1;
        btn.innerHTML = '<span aria-hidden="true">×</span>';
        // keep the cursor in the box while pressing
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        btn.addEventListener('click', function () {
            if (!box) return;
            box.value = '';
            ['input', 'change', 'keyup', 'search'].forEach(function (t) {
                box.dispatchEvent(new Event(t, { bubbles: true }));
            });
            box.focus();
            place();
        });
        document.body.appendChild(btn);
    }

    function place() {
        if (!btn || !box) return;
        var show = !!box.value && document.activeElement === box;
        btn.classList.toggle('on', show);
        if (!show) return;
        var r = box.getBoundingClientRect();
        var size = 22;
        btn.style.left = (r.right - size - 8) + 'px';
        btn.style.top = (r.top + (r.height - size) / 2) + 'px';
    }

    function attach(el) {
        if (box === el) return place();
        detach();
        box = el;
        // room on the right so the last letters are not under the ×
        var cs = getComputedStyle(el);
        if (parseFloat(cs.paddingRight) < 30) { padded = el.style.paddingRight; el.style.paddingRight = '32px'; }
        else padded = null;
        if (!btn) build();
        place();
    }

    function detach() {
        if (box && padded !== null) box.style.paddingRight = padded;
        box = null; padded = null;
        if (btn) btn.classList.remove('on');
    }

    document.addEventListener('focusin', function (e) { if (eligible(e.target)) attach(e.target); else detach(); });
    document.addEventListener('focusout', function (e) {
        if (e.target === box) setTimeout(function () { if (document.activeElement !== box) detach(); }, 0);
    });
    document.addEventListener('input', function (e) { if (e.target === box) place(); });
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
})();
