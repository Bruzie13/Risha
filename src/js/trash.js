/* The Trash, in Settings → Trash: a tab for each kind of record, each
   deleted one with when and by whom, and a Restore button that puts it back
   as it was. Deleting a product or a supplier only hides it, and deleting an
   account deactivates it, so nothing here is lost. Sales are not here:
   deleting one erases it.

   Settings draws it with mountTrash(box, kind). Any other page sends people
   there with openTrash(kind); <span data-trash-count="products"> (or "all")
   shows how many are waiting. */
(function () {
    'use strict';

    const KINDS = {
        products: { label: 'Products', one: 'product', restore: id => `${API_BASE}/products/${id}/restore`, method: 'PUT' },
        suppliers: { label: 'Suppliers', one: 'supplier', restore: id => `${API_BASE}/trash/suppliers/${id}/restore`, method: 'PUT' },
        // an account is restored by turning it back on (administrators only)
        accounts: { label: 'Accounts', one: 'account', restore: id => `${API_BASE}/auth/users/${id}/status`, method: 'PUT' }
    };
    let trash = { products: [], suppliers: [], accounts: [] };

    const when = ms => ms ? new Date(Number(ms)).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'some time ago';
    const countWords = n => n ? `${n} deleted` : 'empty';

    async function loadTrash() {
        try {
            const res = await fetch(`${API_BASE}/trash`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success && data.data) trash = Object.assign({ products: [], suppliers: [], accounts: [] }, data.data);
        } catch (e) { /* the window still opens and says what it could not load */ }
        paintCounts();
    }

    function paintCounts() {
        document.querySelectorAll('[data-trash-count]').forEach(el => {
            const kind = el.getAttribute('data-trash-count');
            const n = kind === 'all' ? Object.keys(KINDS).reduce((a, k) => a + (trash[k] || []).length, 0) : (trash[kind] || []).length;
            el.textContent = countWords(n);
        });
    }

    function rowHtml(kind, r) {
        let title, subs = [];
        if (kind === 'products') {
            title = r.name;
            subs.push(`${escHtml(r.sku || '')}${r.category_name ? ' · ' + escHtml(r.category_name) : ''} · ${formatQty(r.stock_quantity)} ${escHtml(r.unit_type || 'piece')} in stock`);
        } else if (kind === 'suppliers') {
            title = r.name;
            subs.push([r.contact_person, r.email, r.city].filter(Boolean).map(escHtml).join(' · ') || 'No contact details');
        } else {
            title = r.full_name || r.username;
            subs.push(`${escHtml(r.username)} · ${escHtml(roleLabel ? roleLabel(r.role) : r.role)}${r.email ? ' · ' + escHtml(r.email) : ''}`);
        }
        subs.push(`${kind === 'accounts' ? 'Deactivated' : 'Deleted'} ${escHtml(when(r.deleted_at))}${r.deleted_by ? ' by ' + escHtml(r.deleted_by) : ''}`);
        return `<div class="trash-row">
            <div class="trash-info">
                <div class="trash-name">${escHtml(title)}</div>
                ${subs.map(s => `<div class="trash-sub">${s}</div>`).join('')}
            </div>
            <button type="button" class="btn-secondary trash-restore" data-kind="${kind}" data-id="${r.id}"><span class="material-symbols-outlined" style="font-size:16px;">restore_from_trash</span> Restore</button>
        </div>`;
    }

    /* The Trash drawn inside `box` (Settings → Trash), opened on `tab`. */
    window.mountTrash = async function (box, tab) {
        if (typeof canManage === 'function' && !canManage()) { box.innerHTML = '<div class="trash-empty">Your role can\'t restore deleted records.</div>'; return; }
        await loadTrash();
        const kinds = Object.keys(KINDS).filter(k => k !== 'accounts' || (typeof getUserRole === 'function' && getUserRole() === 'admin'));
        let current = kinds.includes(tab) ? tab : kinds[0];

        const body = box;
        body.innerHTML = `
            <div class="seg trash-tabs" role="tablist" aria-label="What was deleted">
                ${kinds.map(k => `<button type="button" class="seg-btn" role="tab" data-tab="${k}">${KINDS[k].label} <span class="trash-tab-count">${countWords(trash[k].length)}</span></button>`).join('')}
            </div>
            <input id="trashSearch" class="form-input" type="search" maxlength="100" placeholder="Search the Trash" style="margin:12px 0 0;">
            <div id="trashList" class="trash-list"></div>`;
        const list = body.querySelector('#trashList');
        const search = body.querySelector('#trashSearch');
        const render = () => {
            body.querySelectorAll('.trash-tabs .seg-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === current);
                b.setAttribute('aria-selected', b.dataset.tab === current ? 'true' : 'false');
                b.querySelector('.trash-tab-count').textContent = countWords(trash[b.dataset.tab].length);
            });
            const q = search.value.trim().toLowerCase();
            const items = trash[current].filter(r => !q || [r.name, r.sku, r.full_name, r.username, r.email].some(v => String(v || '').toLowerCase().includes(q)));
            list.innerHTML = items.length ? items.map(r => rowHtml(current, r)).join('')
                : `<div class="trash-empty">${q ? 'Nothing in the Trash matches that search.' : `No deleted ${KINDS[current].label.toLowerCase()}. Anything deleted will wait here.`}</div>`;
        };
        body.querySelector('.trash-tabs').addEventListener('click', e => {
            const b = e.target.closest('.seg-btn');
            if (b) { current = b.dataset.tab; render(); }
        });
        search.addEventListener('input', render);
        list.addEventListener('click', async e => {
            const btn = e.target.closest('.trash-restore');
            if (!btn) return;
            const kind = btn.dataset.kind, id = Number(btn.dataset.id);
            const rec = trash[kind].find(r => r.id === id) || {};
            btn.disabled = true;
            btn.textContent = 'Restoring…';
            try {
                const res = await fetch(KINDS[kind].restore(id), { method: KINDS[kind].method, headers: getAuthHeaders() });
                const data = await res.json();
                if (data.success) {
                    trash[kind] = trash[kind].filter(r => r.id !== id);
                    paintCounts();
                    render();
                    const name = rec.name || rec.full_name || rec.username || 'It';
                    showToast(kind === 'accounts' ? `${name} can sign in again.` : (data.message || `${name} is back.`), 'success');
                    // the page behind shows it again
                    ['loadProducts', 'loadSuppliers', 'loadUsers'].forEach(f => { if (typeof window[f] === 'function') window[f](); });
                } else {
                    showErrorDialog('Could not restore', data.message || 'the server gave no reason');
                    render();
                }
            } catch (err) {
                showToast(couldNot('restore it', err), 'error');
                render();
            }
        });
        render();
    };

    /* From any page: the Trash lives in Settings. */
    window.openTrash = function (tab) {
        window.location.href = 'settings.html?tab=trash' + (tab ? '&kind=' + encodeURIComponent(tab) : '');
    };

    // the count beside the Trash tab, on load and after a delete
    window.updateTrashCount = () => document.querySelector('[data-trash-count]') ? loadTrash() : Promise.resolve();
    document.addEventListener('DOMContentLoaded', () => {
        if (document.querySelector('[data-trash-count]') && (typeof canManage !== 'function' || canManage())) loadTrash();
    });
})();
