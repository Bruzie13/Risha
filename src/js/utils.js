function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function updatePagination(containerId, items, shownCount, showMoreFn, showLessFn, pageSize) {
    const container = document.getElementById(containerId);
    if (!container) return;
    pageSize = pageSize || 10;
    const showLessBtn = (showLessFn && shownCount > pageSize && items.length > pageSize)
        ? `<button class="show-more-btn" style="margin-left:8px;" onclick="${showLessFn}()">
            <span class="material-symbols-outlined" style="font-size:14px;">expand_less</span>
            Show less
        </button>`
        : '';
    if (items.length <= shownCount) {
        container.innerHTML = items.length > pageSize
            ? `<span style="font-size:12px;color:var(--text-muted);">Showing all ${items.length} results</span>${showLessBtn}`
            : '';
        return;
    }
    const remaining = items.length - shownCount;
    const moreCount = Math.min(pageSize, remaining);
    container.innerHTML = `<button class="show-more-btn" onclick="${showMoreFn}()">
        <span class="material-symbols-outlined" style="font-size:14px;">expand_more</span>
        Show ${moreCount} more (${remaining} remaining)
    </button>${showLessBtn}`;
}

function initSkeletonReveal(delay) {
    const els = document.querySelectorAll('.skel-reveal');
    if (!els.length) return;
    setTimeout(() => {
        els.forEach(el => el.classList.add('loaded'));
    }, delay || 600);
}
