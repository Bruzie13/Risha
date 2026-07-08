function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function updatePagination(containerId, items, shownCount, showMoreFn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (items.length <= shownCount) {
        container.innerHTML = items.length > 10
            ? `<span style="font-size:12px;color:var(--text-muted);">Showing all ${items.length} results</span>`
            : '';
        return;
    }
    const remaining = items.length - shownCount;
    const moreCount = Math.min(10, remaining);
    container.innerHTML = `<button class="show-more-btn" onclick="${showMoreFn}()">
        <span class="material-symbols-outlined" style="font-size:14px;">expand_more</span>
        Show ${moreCount} more (${remaining} remaining)
    </button>`;
}

function initSkeletonReveal(delay) {
    const els = document.querySelectorAll('.skel-reveal');
    if (!els.length) return;
    setTimeout(() => {
        els.forEach(el => el.classList.add('loaded'));
    }, delay || 600);
}
