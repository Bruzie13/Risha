/* FETCH Assistant — floating chat widget injected on every page.
   Talks to /api/assistant, which answers questions about this shop only. A
   stock change the assistant prepares comes back as a card; it is sent to the
   normal stock API (same checks and history as the Inventory page) only when
   the user presses Confirm. */
(function () {
    if (window.location.pathname.includes('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/')) return;
    // The assistant answers from shop-wide data, which till and supplier
    // accounts are not given (the server refuses them as well).
    if (typeof isFencedRole === 'function' && isFencedRole()) return;

    let open = false;
    let enabled = null; // unknown until /status
    let asking = false;
    let canChange = false;
    const history = []; // earlier turns, sent with each question so follow-ups make sense

    function el(tag, attrs, html) {
        const e = document.createElement(tag);
        if (attrs) Object.assign(e, attrs);
        if (html != null) e.innerHTML = html;
        return e;
    }

    function build() {
        const fab = el('button', { className: 'fa-fab', id: 'faFab', title: 'FETCH Assistant & Help' },
            '<span class="material-symbols-outlined">smart_toy</span>');
        fab.addEventListener('click', toggle);

        const panel = el('div', { className: 'fa-panel', id: 'faPanel' });
        panel.innerHTML = `
            <div class="fa-head">
                <div class="fa-head-title"><span class="material-symbols-outlined">smart_toy</span> FETCH Assistant &amp; Help</div>
                <button class="fa-close" id="faClose" title="Close"><span class="material-symbols-outlined">close</span></button>
            </div>
            <div class="fa-body" id="faBody">
                <div class="fa-msg fa-bot">
                    Hi! I'm your assistant and built-in help guide. Ask about your live shop data or how to use any feature:
                    <div class="fa-suggests">
                        <button class="fa-chip" data-q="What should I reorder today?">What should I reorder?</button>
                        <button class="fa-chip" data-q="Which products are expiring soon?">What's expiring soon?</button>
                        <button class="fa-chip" data-q="How were sales today?">Sales today?</button>
                        <button class="fa-chip" data-q="How do I use the POS to make a sale?">How do I use the POS?</button>
                        <button class="fa-chip" data-q="How do I reorder stock from a supplier?">How do I reorder stock?</button>
                        <button class="fa-chip" data-q="How do I void a sale and do the end-of-day cash count?">Void &amp; end-of-day?</button>
                        <button class="fa-chip" data-q="What can each user role do?">Roles &amp; permissions</button>
                        <button class="fa-chip" data-q="What are the keyboard shortcuts?">Keyboard shortcuts</button>
                        <button class="fa-chip" data-action="guide">📖 Show the full help guide</button>
                    </div>
                </div>
            </div>
            <div class="fa-input-row">
                <input type="text" id="faInput" placeholder="Ask a question or how to do something…" autocomplete="off" maxlength="600">
                <button id="faSend" title="Send"><span class="material-symbols-outlined">send</span></button>
            </div>
            <div class="fa-foot">Live shop data + full help guide · scoped to FETCH</div>`;

        document.body.appendChild(fab);
        document.body.appendChild(panel);

        panel.querySelector('#faClose').addEventListener('click', toggle);
        panel.querySelector('#faSend').addEventListener('click', send);
        const input = panel.querySelector('#faInput');
        input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
        panel.querySelectorAll('.fa-chip').forEach(c =>
            c.addEventListener('click', () => {
                if (c.dataset.action === 'guide') { showGuide(); return; }
                input.value = c.dataset.q; send();
            }));
    }

    // Render the full formatted help guide as a message inside the chat,
    // reusing the existing guide content already on the page (no duplication).
    function showGuide() {
        const src = document.querySelector('#helpGuideModal .help-guide-content');
        const html = src
            ? '<div class="fa-guide">' + src.innerHTML + '</div>'
            : 'The full guide isn\'t available on this page — try asking me a specific "how do I…" question instead.';
        addMsg('bot', html, true);
    }

    // Let the rest of the app open the assistant (it's the unified helper now).
    window.openFetchAssistant = function () {
        if (!document.getElementById('faPanel')) build();
        if (!open) toggle();
    };

    function toggle() {
        open = !open;
        document.getElementById('faPanel').classList.toggle('active', open);
        document.getElementById('faFab').classList.toggle('active', open);
        if (open) {
            setTimeout(() => document.getElementById('faInput')?.focus(), 100);
            if (enabled === null) checkStatus();
        }
    }

    async function checkStatus() {
        try {
            const r = await fetch(`${API_BASE}/assistant/status`, { headers: getAuthHeaders() });
            const d = await r.json();
            enabled = !!d.enabled;
            canChange = !!d.can_change;
            if (!enabled) {
                addMsg('bot', "I'm not switched on yet. An administrator needs to add a Claude API key. Then I can answer questions about your stock, sales and suppliers, and prepare stock changes for you to confirm.");
            }
        } catch { enabled = false; }
    }

    function addMsg(who, text, raw) {
        const body = document.getElementById('faBody');
        const m = el('div', { className: 'fa-msg fa-' + who });
        if (raw) {
            // trusted markup (typing indicator) — insert as-is, no escaping
            m.innerHTML = text;
        } else {
            // untrusted text (AI answer / user question): escape, then apply
            // light markdown — **bold**, bullet lines, newlines
            m.innerHTML = String(text)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>')
                .replace(/(<li>.*<\/li>\n?)+/gs, mm => '<ul>' + mm.replace(/\n/g, '') + '</ul>')
                .replace(/\n/g, '<br>');
        }
        body.appendChild(m);
        body.scrollTop = body.scrollHeight;
        return m;
    }

    async function send() {
        if (asking) return;
        const input = document.getElementById('faInput');
        const q = input.value.trim();
        if (!q) return;
        input.value = '';
        addMsg('user', q);
        asking = true;
        const typing = addMsg('bot', '<span class="fa-typing"><i></i><i></i><i></i></span>', true);
        try {
            const r = await fetch(`${API_BASE}/assistant`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ question: q, history: history.slice(-8) })
            });
            const d = await r.json();
            typing.remove();
            const answer = d.success ? d.answer : (d.message || 'The assistant could not answer: the server gave no reason.');
            addMsg('bot', answer);
            if (d.success) {
                history.push({ role: 'user', text: q }, { role: 'assistant', text: answer });
                (d.proposals || []).forEach(addProposal);
            }
        } catch {
            typing.remove();
            addMsg('bot', "I couldn't reach the server. Please try again.");
        } finally {
            asking = false;
        }
    }

    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const KIND = { in: 'Add stock', out: 'Take out stock', adjustment: 'Count lower', damage: 'Write off as damaged' };

    /* A change the assistant prepared. Only two kinds exist, and each goes to a
       fixed endpoint: the card never sends anything the user cannot see. */
    function addProposal(p) {
        if (!p || !Number.isInteger(Number(p.product_id))) return;
        const body = document.getElementById('faBody');
        const card = el('div', { className: 'fa-msg fa-bot fa-proposal' });
        const lines = p.type === 'stock'
            ? `<div class="fa-prop-title">${esc(KIND[p.kind] || 'Stock change')}: ${esc(p.quantity)}</div>
               <div class="fa-prop-line"><strong>${esc(p.product)}</strong> (${esc(p.sku)})</div>
               <div class="fa-prop-line">Stock ${esc(p.stock_before)} → <strong>${esc(p.stock_after)}</strong>${p.removed_expired ? ` (the ${esc(p.removed_expired)} expired are written off first)` : ''}</div>
               ${p.expiration_date ? `<div class="fa-prop-line">New batch expires ${esc(p.expiration_date)}</div>` : ''}
               <div class="fa-prop-line">Reason: ${esc(p.reason)}</div>`
            : `<div class="fa-prop-title">New reorder level</div>
               <div class="fa-prop-line"><strong>${esc(p.product)}</strong> (${esc(p.sku)})</div>
               <div class="fa-prop-line">Reorder level ${esc(p.from)} → <strong>${esc(p.to)}</strong></div>`;
        card.innerHTML = lines + `<div class="fa-prop-actions"><button type="button" class="btn-secondary fa-prop-cancel">Cancel</button><button type="button" class="btn-primary fa-prop-ok">Confirm</button></div><div class="fa-prop-result" role="status"></div>`;
        body.appendChild(card);
        body.scrollTop = body.scrollHeight;
        const ok = card.querySelector('.fa-prop-ok'), cancel = card.querySelector('.fa-prop-cancel'), result = card.querySelector('.fa-prop-result');
        const done = (text, good) => {
            ok.remove(); cancel.remove();
            result.textContent = text; result.className = 'fa-prop-result ' + (good ? 'ok' : 'err');
            history.push({ role: 'user', text: good ? `[I confirmed: ${p.type === 'stock' ? KIND[p.kind] + ' ' + p.quantity + ' of ' + p.product : 'reorder level of ' + p.product + ' to ' + p.to}. ${text}]` : `[Not done: ${text}]` });
        };
        cancel.addEventListener('click', () => done('Cancelled. Nothing was changed.', false));
        ok.addEventListener('click', async () => {
            ok.disabled = cancel.disabled = true;
            ok.innerHTML = '<span class="fa-spin"></span>Saving…';
            const id = Number(p.product_id);
            const req = p.type === 'stock'
                ? { url: `${API_BASE}/products/${id}/stock`, body: Object.assign({ quantity: Number(p.quantity), movement_type: p.kind, notes: 'FETCH Assistant: ' + p.reason, request_key: 1 + Math.floor(Math.random() * 2147483646) }, p.expiration_date ? { expiration_date: p.expiration_date } : {}) }
                : { url: `${API_BASE}/products/${id}`, body: { reorder_level: Number(p.to) } };
            try {
                const r = await fetch(req.url, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(req.body) });
                const d = await r.json().catch(() => ({}));
                if (r.ok && d.success !== false) done(p.type === 'stock' ? (d.message || 'Stock adjusted.') : 'Reorder level saved.', true);
                else done(d.message || 'The change was refused.', false);
            } catch {
                done("I couldn't reach the server. Nothing was changed.", false);
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
