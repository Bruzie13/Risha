/* tilt3d — lightweight 3D tilt/parallax for cards. No dependencies.
   Cards lean toward the cursor in 3D with a soft moving glare and a lift
   shadow. Disabled on touch devices and when reduced motion is requested. */
(function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var SELECTOR = [
        '.stat-card', '.kpi-card', '.pcard', '.chart-card', '.analytics-chart-card',
        '.settings-card', '.metric-card', '.summary-card', '.mover-card', '.segment-card',
        '.dashboard-card', '.report-card'
    ].join(',');
    var MAX = 6; // max tilt in degrees

    function attach(card) {
        if (card.__tilt) return;
        card.__tilt = true;
        card.classList.add('tilt-3d');
        var glare = document.createElement('i');
        glare.className = 'tilt-glare';
        card.appendChild(glare);

        var raf = null, rect = null;

        card.addEventListener('mouseenter', function () {
            rect = card.getBoundingClientRect();
            card.classList.add('is-tilting');
        });
        card.addEventListener('mousemove', function (e) {
            if (!rect) rect = card.getBoundingClientRect();
            var px = (e.clientX - rect.left) / rect.width;
            var py = (e.clientY - rect.top) / rect.height;
            var rx = (0.5 - py) * MAX * 2;
            var ry = (px - 0.5) * MAX * 2;
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(function () {
                card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) +
                    'deg) rotateY(' + ry.toFixed(2) + 'deg) translateZ(6px)';
                card.style.setProperty('--tx', (px * 100).toFixed(1) + '%');
                card.style.setProperty('--ty', (py * 100).toFixed(1) + '%');
            });
        });
        card.addEventListener('mouseleave', function () {
            if (raf) cancelAnimationFrame(raf);
            card.style.transform = '';
            card.classList.remove('is-tilting');
            rect = null;
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
