/* tilt3d — real 3D depth for cards. No dependencies.

   Cards lean toward the cursor on a spring, their contents parallax at
   different depths, a specular highlight tracks the light, and the drop
   shadow swings opposite the tilt so the lighting stays consistent.
   Disabled on touch devices and when reduced motion is requested. */
(function () {
    'use strict';

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var SELECTOR = [
        '.stat-card', '.kpi-card', '.pcard', '.chart-card', '.analytics-chart-card',
        '.settings-card', '.metric-card', '.summary-card', '.mover-card', '.segment-card',
        '.dashboard-card', '.report-card'
    ].join(',');

    // Inner elements that float above the card face. Bigger number = closer
    // to the viewer = more parallax.
    // Kept modest on purpose: past ~25px of Z the text starts to resample and
    // look soft while the card is turning.
    var LAYERS = [
        { sel: '.kpi-icon, .icon-chip, .stat-icon, .metric-icon', z: 22 },
        { sel: '.kpi-value, .stat-value, .metric-value, .radar-num', z: 14 },
        { sel: '.kpi-label, .stat-label, .metric-label, .panel-head h3', z: 8 }
    ];

    var MAX = 6;          // max tilt, degrees
    var EASE = 0.16;      // how fast the card chases the cursor

    function attach(card) {
        if (card.__tilt) return;
        card.__tilt = true;
        card.classList.add('tilt-3d');

        var glare = document.createElement('i');
        glare.className = 'tilt-glare';
        card.appendChild(glare);

        var sheen = document.createElement('i');
        sheen.className = 'tilt-sheen';
        card.appendChild(sheen);

        // Lift the contents onto their own planes once, at attach time.
        LAYERS.forEach(function (layer) {
            card.querySelectorAll(layer.sel).forEach(function (el) {
                if (el.__tiltLayer || el.style.transform) return;
                el.__tiltLayer = true;
                el.classList.add('tilt-layer');
                el.style.setProperty('--tz', layer.z + 'px');
            });
        });

        var rect = null, raf = null;
        var rx = 0, ry = 0, tx = 50, ty = 50;      // current
        var trx = 0, tryy = 0, ttx = 50, tty = 50; // target
        var active = false;

        function frame() {
            rx += (trx - rx) * EASE;
            ry += (tryy - ry) * EASE;
            tx += (ttx - tx) * EASE;
            ty += (tty - ty) * EASE;

            card.style.transform =
                'perspective(1000px) rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg) translateZ(4px)';
            card.style.setProperty('--tx', tx.toFixed(1) + '%');
            card.style.setProperty('--ty', ty.toFixed(1) + '%');
            // shadow falls away from the lean, keeping one light source
            card.style.setProperty('--sx', (-ry * 1.6).toFixed(1) + 'px');
            card.style.setProperty('--sy', (18 + rx * 1.6).toFixed(1) + 'px');
            // the sheen sweeps across as the card turns
            card.style.setProperty('--sheen', (50 + ry * 4.5).toFixed(1) + '%');

            if (active || Math.abs(trx - rx) > 0.01 || Math.abs(tryy - ry) > 0.01) {
                raf = requestAnimationFrame(frame);
            } else {
                raf = null;
                card.style.transform = '';
                card.style.willChange = '';
            }
        }

        function kick() { if (!raf) raf = requestAnimationFrame(frame); }

        card.addEventListener('mouseenter', function () {
            rect = card.getBoundingClientRect();
            active = true;
            card.style.willChange = 'transform';
            card.classList.add('is-tilting');
            kick();
        });

        card.addEventListener('mousemove', function (e) {
            if (!rect) rect = card.getBoundingClientRect();
            var px = (e.clientX - rect.left) / rect.width;
            var py = (e.clientY - rect.top) / rect.height;
            trx = (0.5 - py) * MAX * 2;
            tryy = (px - 0.5) * MAX * 2;
            ttx = px * 100;
            tty = py * 100;
            kick();
        });

        card.addEventListener('mouseleave', function () {
            active = false;
            trx = 0; tryy = 0; ttx = 50; tty = 50;
            card.classList.remove('is-tilting');
            rect = null;
            kick();
        });
    }

    function scan() { document.querySelectorAll(SELECTOR).forEach(attach); }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();

    // Cards on some pages render after data loads — rescan (debounced).
    var t = null;
    var mo = new MutationObserver(function () {
        if (t) return;
        t = setTimeout(function () { t = null; scan(); }, 250);
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
})();
