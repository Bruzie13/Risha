/* FETCH welcome intro — the 3D curtain-raiser before the sign-in card.

   Deliberate choices, since a splash screen sits between someone and their
   work:
   - The markup is built here rather than in login.html. If this script fails
     to parse or throws, there is simply no overlay — the login form is never
     left underneath something that will not go away.
   - It plays once per browser session. Signing out and back in during a shift
     should not replay it.
   - Any tap, click or key skips it, and a failsafe timer removes it even if an
     animation event never fires.
   - Reduced-motion users get a still frame that leaves almost immediately.

   The medallion's thickness is real: SLICES thin discs stepped along Z, so a
   turn shows its rim instead of a flat image flipping. */
(function () {
    'use strict';

    var KEY = 'rishaIntroSeen';
    var SLICES = 16;          // rim discs; more = smoother edge, more nodes
    var THICKNESS = 22;       // px of total depth, matched by the CSS faces

    // Only on the sign-in page, and only when it is the page being shown.
    var path = window.location.pathname;
    if (!(path === '/' || path === '' || /login\.html$/.test(path))) return;

    // ?intro=1 replays it on demand — handy for showing the thing off without
    // having to open a fresh browser session every time.
    var forced = /[?&]intro=1\b/.test(window.location.search);

    // Already welcomed in this tab — go straight to the form.
    if (!forced) {
        try { if (sessionStorage.getItem(KEY)) return; } catch (e) { /* private mode */ }
    }

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var HOLD = reduced ? 900 : 3400;

    function el(tag, cls, html) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }

    function build() {
        var stage = el('div', 'intro-stage');
        stage.setAttribute('role', 'presentation');
        stage.style.setProperty('--hold', HOLD + 'ms');

        var scene = el('div', 'intro-scene');

        // ── medallion ──────────────────────────────────────────────────────
        var coin = el('div', 'intro-coin');
        // Rim first so the faces sit on top of it at either end.
        for (var i = 0; i < SLICES; i++) {
            var slice = el('div', 'coin-slice');
            var z = -THICKNESS / 2 + (THICKNESS / (SLICES - 1)) * i;
            slice.style.transform = 'translateZ(' + z.toFixed(2) + 'px)';
            coin.appendChild(slice);
        }

        var front = el('div', 'coin-face front');
        var logo = new Image();
        logo.src = 'images/logo.jpeg';
        logo.alt = '';
        // A missing logo must not leave a blank disc.
        logo.onerror = function () {
            front.removeChild(logo);
            front.appendChild(el('span', 'material-symbols-outlined', 'pets'));
        };
        front.appendChild(logo);

        var back = el('div', 'coin-face back',
            '<span class="material-symbols-outlined">pets</span>');

        coin.appendChild(front);
        coin.appendChild(back);
        scene.appendChild(coin);

        // ── wordmark ───────────────────────────────────────────────────────
        var copy = el('div', 'intro-copy');
        copy.appendChild(el('div', 'intro-kicker', 'Welcome to'));

        var word = el('div', 'intro-word');
        'RISHA'.split('').forEach(function (ch, idx) {
            var s = el('span', null, ch);
            s.style.animationDelay = (1.05 + idx * 0.075) + 's';
            word.appendChild(s);
        });
        copy.appendChild(word);
        copy.appendChild(el('div', 'intro-tag', 'Pet Supplies'));
        scene.appendChild(copy);

        stage.appendChild(scene);

        // ── depth particles ────────────────────────────────────────────────
        if (!reduced) {
            for (var p = 0; p < 9; p++) {
                var paw = el('span', 'material-symbols-outlined intro-paw', 'pets');
                var depth = -420 + Math.random() * 560;      // how far back it floats
                var near = (depth + 420) / 980;              // 0 far … 1 near
                paw.style.setProperty('--z', depth.toFixed(0) + 'px');
                paw.style.setProperty('--dx', (Math.random() * 130 - 65).toFixed(0) + 'px');
                paw.style.setProperty('--spin', (Math.random() * 220 - 110).toFixed(0) + 'deg');
                paw.style.setProperty('--peak', (0.10 + near * 0.28).toFixed(2));
                paw.style.left = (6 + Math.random() * 88) + '%';
                paw.style.top = (55 + Math.random() * 40) + '%';
                paw.style.fontSize = (16 + near * 26).toFixed(0) + 'px';
                paw.style.animationDuration = (4.6 + Math.random() * 3.4).toFixed(1) + 's';
                paw.style.animationDelay = (-Math.random() * 5).toFixed(1) + 's';
                stage.appendChild(paw);
            }
        }

        stage.appendChild(el('div', 'intro-skip', reduced ? '' : 'Tap anywhere to skip'));
        stage.appendChild(el('div', 'intro-progress'));
        return { stage: stage, scene: scene };
    }

    function start() {
        var built;
        try {
            built = build();
        } catch (e) {
            // Never let a broken splash block sign-in — but say why, or a
            // silent return looks identical to "already seen this session".
            console.error('[intro] skipped:', e);
            return;
        }
        var stage = built.stage;
        var scene = built.scene;
        document.body.appendChild(stage);
        try { sessionStorage.setItem(KEY, '1'); } catch (e) {}

        var done = false;
        var timers = [];
        /* Don't accept a skip for the first moment. A keystroke queued before
           the page finished loading — or a password manager announcing itself —
           otherwise dismisses the intro on the very first frame, so nobody ever
           sees it. Deliberate skips all happen well after this. */
        var armed = false;
        timers.push(setTimeout(function () { armed = true; }, 700));

        function finish() {
            if (done) return;
            done = true;
            timers.forEach(clearTimeout);
            window.removeEventListener('keydown', onKey);
            stage.classList.add('leaving');
            // Remove on animation end, but never rely on the event arriving.
            stage.addEventListener('animationend', remove);
            timers.push(setTimeout(remove, 900));
            // Hand focus to the form the moment the curtain starts to lift.
            var u = document.getElementById('username');
            if (u) try { u.focus({ preventScroll: true }); } catch (e) { u.focus(); }
        }

        function remove() {
            if (stage.parentNode) stage.parentNode.removeChild(stage);
        }

        // Only a skip the user actually meant.
        function userSkip() { if (armed) finish(); }
        function onKey() { userSkip(); }

        stage.addEventListener('click', userSkip);
        stage.addEventListener('touchstart', userSkip, { passive: true });
        window.addEventListener('keydown', onKey);
        timers.push(setTimeout(finish, HOLD));
        // Backstop: whatever happens, the overlay is gone well before this.
        timers.push(setTimeout(remove, HOLD + 4000));

        // A little head-tracking so the scene reads as a space, not a picture.
        if (!reduced && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            stage.addEventListener('mousemove', function (e) {
                var cx = (e.clientX / window.innerWidth) - 0.5;
                var cy = (e.clientY / window.innerHeight) - 0.5;
                scene.style.transform =
                    'rotateY(' + (cx * 13).toFixed(2) + 'deg) rotateX(' + (cy * -9).toFixed(2) + 'deg)';
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}());
