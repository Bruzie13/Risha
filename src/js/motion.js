/* Motion helpers. Only feedback for something the user just did survives:
   the cart reacting to an added item, and the tick on a completed action. */
(function () {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    window.fetchMotion = { cartPulse, checkmarkSVG, reduced };

})();
