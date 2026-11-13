/* A product's suppliers compared in its View window (Carlo, 14 Nov; mock-up
   Option B): one table, the better supplier green with ✓ in each row, a line
   saying who to order from. Also the supplier choice in Reorder and adding or
   removing a second supplier. The server works the figures out
   (GET /api/products/:id/suppliers, backend/utils/supplierCompare.js). */
(function () {
    'use strict';
    const API = () => (typeof API_URL !== 'undefined' ? API_URL : API_BASE);
    const esc = v => escHtml(v == null ? '' : String(v));
    const peso = n => formatCurrency(Number(n) || 0);
    const monthYear = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const isAdmin = () => typeof getUserRole === 'function' && getUserRole() === 'admin';
    const canSee = () => typeof getUserRole === 'function' && ['admin', 'manager'].includes(getUserRole());

    async function fetchSuppliers(productId) {
        const res = await fetch(`${API()}/products/${productId}/suppliers`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        return data.data;
    }

    const ROWS = [
        { key: 'cost', label: 'Price to the shop', show: r => r.cost != null ? peso(r.cost) : 'Not set' },
        { key: 'average_days', label: 'Usual delivery', show: r => r.average_days != null ? `${r.average_days} day${Number(r.average_days) === 1 ? '' : 's'}` : 'No orders received yet' },
        { key: 'on_time_percent', label: 'On time', show: r => r.on_time_percent != null ? `${r.on_time_percent}%` : 'Not measured yet' },
        { key: 'shelf_days', label: 'Last batch expires', show: r => r.last_expiry ? `${monthYear(r.last_expiry)} (${Math.max(0, Math.round(r.shelf_days / 30))} months after delivery)` : 'No batch received yet' },
        { key: 'stars', label: 'Rating', show: r => r.stars != null ? '★★★★★'.slice(0, r.stars) + '☆☆☆☆☆'.slice(0, 5 - r.stars) : 'Not rated yet' },
        { key: 'delivered', label: 'Orders received', show: r => `${formatNumber(r.delivered || 0)} in the last 12 months`, plain: true }
    ];

    function tableHtml(d) {
        const rows = d.rows;
        return `<div class="ps-table-wrap"><table class="ps-table">
            <thead><tr><th></th>${rows.map(r => `<th>${esc(r.name)}<small>${r.is_main ? 'Main supplier' : 'Second supplier'}${!r.is_main && isAdmin() ? ` · <button type="button" class="ps-remove" data-ps-remove="${Number(r.supplier_id)}">Remove</button>` : ''}</small></th>`).join('')}</tr></thead>
            <tbody>${ROWS.map(m => `<tr><th>${m.label}</th>${rows.map(r => `<td class="${!m.plain && r.best.includes(m.key) ? 'ps-top' : ''}">${esc(m.show(r))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        ${d.verdict ? `<div class="ps-verdict"><span class="material-symbols-outlined" aria-hidden="true">recommend</span><div>${esc(d.verdict)}</div></div>` : ''}
        <p class="ps-note">Green with ✓ is the better supplier on that line. Delivery, on time and rating come from each supplier's received orders; the expiry is the date on the last batch of this product each one delivered.</p>`;
    }

    /* The section in the View window. */
    window.loadSupplierCompare = async function (productId) {
        const box = document.getElementById('psCompare');
        if (!box) return;
        if (!canSee()) { box.remove(); return; }
        try {
            const d = await fetchSuppliers(productId);
            if (d.rows.length < 2) {
                box.innerHTML = `<h4 class="ps-h">Who supplies it</h4>
                    <p class="ps-one">${d.rows.length ? `Only <b>${esc(d.rows[0].name)}</b> supplies it.` : 'No supplier is set.'} Add a second supplier to compare who delivers faster and whose batches last longer.</p>
                    ${isAdmin() ? `<button type="button" class="btn-secondary" data-ps-add="${Number(productId)}"><span class="material-symbols-outlined" style="font-size:17px;">add</span> Add a second supplier</button>` : ''}`;
            } else {
                box.innerHTML = `<h4 class="ps-h">Compare its suppliers</h4>${tableHtml(d)}
                    ${isAdmin() ? `<button type="button" class="btn-secondary" data-ps-add="${Number(productId)}"><span class="material-symbols-outlined" style="font-size:17px;">add</span> Add another supplier</button>` : ''}`;
            }
            box.dataset.product = productId;
        } catch (e) {
            box.innerHTML = `<p class="ps-one">${esc(couldNot('load its suppliers', e))}</p>`;
        }
    };

    document.addEventListener('click', async e => {
        const add = e.target.closest('[data-ps-add]');
        if (add) { openAddSupplier(Number(add.dataset.psAdd)); return; }
        const rm = e.target.closest('[data-ps-remove]');
        if (rm) {
            const box = document.getElementById('psCompare');
            const pid = Number(box && box.dataset.product);
            showConfirmDialog('Remove this supplier?', 'It stops supplying this product. Its past orders stay on record.', async () => {
                try {
                    const res = await fetch(`${API()}/products/${pid}/suppliers/${Number(rm.dataset.psRemove)}`, { method: 'DELETE', headers: getAuthHeaders() });
                    const data = await res.json();
                    showToast(data.message || (data.success ? 'Removed' : 'Could not remove it'), data.success ? 'success' : 'error');
                    loadSupplierCompare(pid);
                } catch (err) { showToast(couldNot('remove the supplier', err), 'error'); }
            }, 'Remove', '<span class="material-symbols-outlined" style="font-size:48px;color:var(--danger);">person_remove</span>');
        }
    });

    async function openAddSupplier(productId) {
        let list = [], current = [];
        try {
            const [sup, d] = await Promise.all([
                fetch(`${API()}/suppliers`, { headers: getAuthHeaders() }).then(r => r.json()),
                fetchSuppliers(productId)
            ]);
            current = d.rows.map(r => Number(r.supplier_id));
            list = (sup.data || []).filter(s => !current.includes(Number(s.id)) && s.status !== 'deactivated');
        } catch (err) { showToast(couldNot('load the suppliers', err), 'error'); return; }
        const { overlay, dialog } = buildDialogShell('confirmDialogOverlay', 'primary', 'add_business', 'Add a second supplier',
            'Choose another supplier for this product and the price it charges the shop.');
        const body = dialog.querySelector('.dialog-body');
        body.insertAdjacentHTML('beforeend', list.length ? `
            <label class="form-label" for="psSupplier" style="display:block;margin-top:12px;text-align:left;">Supplier</label>
            <select id="psSupplier" class="form-select"><option value="">Choose a supplier</option>${list.map(s => `<option value="${Number(s.id)}">${esc(s.name)}</option>`).join('')}</select>
            <label class="form-label" for="psPrice" style="display:block;margin-top:12px;text-align:left;">Its price to the shop (₱)</label>
            <input id="psPrice" class="form-input" type="text" inputmode="decimal" maxlength="12" placeholder="For example 560">
            <div id="psError" role="alert" class="void-error"></div>` : '<p style="margin-top:10px;">Every supplier on the list already supplies it, or none is left to add.</p>');
        body.insertAdjacentHTML('afterend', dialogActions('Cancel', 'Add supplier', 'btn-primary'));
        const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
        const onKey = ev => { if (ev.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
        dialog.querySelector('#confirmCancelBtn').addEventListener('click', close);
        const ok = dialog.querySelector('#confirmOkBtn');
        if (!list.length) { ok.remove(); return; }
        ok.addEventListener('click', async () => {
            const err = dialog.querySelector('#psError');
            const supplier_id = dialog.querySelector('#psSupplier').value;
            const cost_price = dialog.querySelector('#psPrice').value.trim();
            if (!supplier_id) { err.textContent = 'Choose a supplier.'; return; }
            if (!/^\d+(\.\d{1,2})?$/.test(cost_price) || Number(cost_price) <= 0) { err.textContent = 'Enter the price this supplier charges, more than ₱0, like 560 or 560.50.'; return; }
            ok.disabled = true;
            try {
                const res = await fetch(`${API()}/products/${productId}/suppliers`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ supplier_id: Number(supplier_id), cost_price }) });
                const data = await res.json();
                if (!data.success) { err.textContent = data.message || 'Could not add the supplier.'; ok.disabled = false; return; }
                close();
                showToast(data.message, 'success');
                loadSupplierCompare(productId);
            } catch (e2) { ok.disabled = false; err.textContent = couldNot('add the supplier', e2); }
        });
    }

    /* The supplier choice in Reorder: only when the product has more than one.
       Returns the chosen supplier and price, or null when there is no choice. */
    window.supplierChoiceHtml = async function (productId) {
        if (!canSee()) return null;
        try {
            const d = await fetchSuppliers(productId);
            if (d.rows.length < 2) return null;
            const html = `<p class="form-label" style="margin:12px 0 6px;text-align:left;">Order from</p><div class="ps-pick">${d.rows.map(r => `
                <label class="ps-opt"><input type="radio" name="psPick" value="${Number(r.supplier_id)}" data-cost="${r.cost != null ? Number(r.cost) : ''}" ${Number(r.supplier_id) === Number(d.pick) ? 'checked' : ''}>
                    <span><b>${esc(r.name)}</b>${Number(r.supplier_id) === Number(d.pick) ? ' <span class="ps-sug">Suggested</span>' : ''}<small>${r.average_days != null ? 'Usually delivers in ' + r.average_days + ' days' : 'No orders received yet'}${r.last_expiry ? ' · last batch expires ' + esc(monthYear(r.last_expiry)) : ''}</small></span>
                    <span class="ps-amt">${r.cost != null ? peso(r.cost) : '—'}<small>each</small></span></label>`).join('')}</div>
                ${d.verdict ? `<p class="ps-note" style="margin-top:6px;">${esc(d.verdict)}</p>` : ''}`;
            return { html, pick: d.pick };
        } catch (e) { return null; }
    };
})();
