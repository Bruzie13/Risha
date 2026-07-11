/* FETCH motion system — animation helpers that make state changes legible:
   cards enter in reading order, numbers count up to their value, the cart
   visibly reacts. Everything no-ops for users who prefer reduced motion. */
(function () {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Staggered entrance: children appear in sequence so the eye follows the layout
    function stagger(selector, step = 45, cap = 420) {
        if (reduced) return;
        document.querySelectorAll(selector).forEach((el, i) => {
            if (el.classList.contains('anim-in')) return;
            el.classList.add('anim-in');
            el.style.animationDelay = Math.min(i * step, cap) + 'ms';
        });
    }

    // Count-up: animates the number inside an element while keeping its
    // prefix/suffix (₱, %, "units", K/M) exactly as rendered
    function countUp(el, duration = 850) {
        if (!el || el.dataset.counted) return;
        const text = el.textContent.trim();
        const m = text.match(/^([^\d\-]*)([\d,]+(?:\.\d+)?)(.*)$/);
        if (!m) return;
        const target = parseFloat(m[2].replace(/,/g, ''));
        if (!isFinite(target) || target === 0) return;
        el.dataset.counted = '1';
        if (reduced) return;
        const decimals = (m[2].split('.')[1] || '').length;
        const grouped = m[2].includes(',');
        const start = performance.now();
        const fmt = v => grouped ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals);
        function tick(now) {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = m[1] + fmt(target * eased) + m[3];
            if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function countUpAll(selector) {
        document.querySelectorAll(selector).forEach(el => countUp(el));
    }

    // Cart feedback: pop the badge and slide in the newest line
    function cartPulse(badgeEl, lastItemEl) {
        if (reduced) return;
        if (badgeEl) {
            badgeEl.classList.remove('badge-pop');
            void badgeEl.offsetWidth; // restart the animation
            badgeEl.classList.add('badge-pop');
        }
        if (lastItemEl) lastItemEl.classList.add('cart-item-in');
    }

    // Animated checkmark (SVG stroke draw) for success dialogs
    function checkmarkSVG(color) {
        if (reduced) {
            return '<span class="material-symbols-outlined" style="font-size:36px;color:' + color + ";font-variation-settings:'wght' 600;\">check</span>";
        }
        return `<svg width="40" height="40" viewBox="0 0 52 52" fill="none">
            <circle class="check-circle" cx="26" cy="26" r="23" stroke="${color}" stroke-width="3"/>
            <path class="check-mark" d="M14 27 L22 35 L38 18" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    window.fetchMotion = { stagger, countUp, countUpAll, cartPulse, checkmarkSVG, reduced };

    // Default entrance choreography on every page
    window.addEventListener('load', () => {
        stagger('.stat-card, .perf-card', 50);
        stagger('.panel-card, .analytics-chart-card, .settings-card', 60);
    });
})();
