/* FETCH Assistant — floating chat widget injected on every page.
   Talks to /api/assistant, which answers questions about this shop only. */
(function () {
    if (window.location.pathname.includes('login.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/')) return;

    let open = false;
    let enabled = null; // unknown until /status
    let asking = false;

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
            if (!enabled) {
                addMsg('bot', "I'm not switched on yet — an admin needs to add a free AI key. Once that's done, I can answer questions about your stock, sales, and suppliers.");
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
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ question: q })
            });
            const d = await r.json();
            typing.remove();
            addMsg('bot', d.success ? d.answer : (d.message || 'Something went wrong.'));
        } catch {
            typing.remove();
            addMsg('bot', "I couldn't reach the server. Please try again.");
        } finally {
            asking = false;
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
