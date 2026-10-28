/* An × inside a typing box, to empty it in one press.

   It shows in the box being typed in, once there is something in it: the
   searches, names, notes, emails and the like. Pressing it empties the box,
   tells the page it changed (so a search shows everything again) and leaves
   the cursor in the box. Number, date and password boxes are left alone
   (they have their own controls), and so is any box marked data-no-clear.

   A box with a length limit (maxlength) also says how many characters are
   left once the end is near ("8 left"), and "Limit reached" at the end, so
   typing that stops is never a mystery.

   One button serves every box: it is laid over the box in use rather than
   added into each, so no page's layout moves. */
(function () {
    'use strict';
    var TYPES = ['text', 'search', 'email', 'tel', 'url', ''];
    var MIN_WIDTH = 90;     // narrower boxes have no room for it

    var btn = null, box = null, padded = null, left = null;

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

    // how many characters are left, shown only near the end of a limited box
    function leftText(el) {
        var max = el.maxLength;
        if (!(max > 0 && max < 1000)) return '';
        var n = max - el.value.length;
        if (n > Math.max(5, Math.round(max * 0.15))) return '';
        return n <= 0 ? 'Limit reached (' + max + ' characters)' : n + ' left';
    }

    function place() {
        if (!btn || !box) return;
        var focused = document.activeElement === box;
        var show = !!box.value && focused;
        btn.classList.toggle('on', show);
        var words = focused ? leftText(box) : '';
        if (!left) {
            left = document.createElement('span');
            left.className = 'fx-left';
            left.setAttribute('aria-live', 'polite');
            document.body.appendChild(left);
        }
        left.textContent = words;
        left.classList.toggle('on', !!words);
        left.classList.toggle('full', /^Limit/.test(words));
        if (!show && !words) return;
        var r = box.getBoundingClientRect();
        var size = 22;
        btn.style.left = (r.right - size - 8) + 'px';
        btn.style.top = (r.top + (r.height - size) / 2) + 'px';
        // just under the box's right end, clear of what is typed
        left.style.left = 'auto';
        left.style.right = (window.innerWidth - r.right) + 'px';
        left.style.top = (r.bottom + 3) + 'px';
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
        if (left) left.classList.remove('on');
    }

    document.addEventListener('focusin', function (e) { if (eligible(e.target)) attach(e.target); else detach(); });
    document.addEventListener('focusout', function (e) {
        if (e.target === box) setTimeout(function () { if (document.activeElement !== box) detach(); }, 0);
    });
    document.addEventListener('input', function (e) { if (e.target === box) place(); });
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
})();
