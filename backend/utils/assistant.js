// FETCH AI Assistant — gathers a live snapshot of the shop, sends it with the
// user's question to Google Gemini (free tier), and returns a grounded answer.
// Scoped by a strict system instruction so it only answers about this system.
const pool = require('../config/database');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const DAY = 86400000;

// One tight query bundle describing the current state of the shop.
async function buildContext() {
    const conn = await pool.getConnection();
    try {
        // Risha is a Philippine shop; run this connection in PH time so that
        // "today", expiry windows and CURDATE()/NOW() all reflect UTC+8 rather
        // than the server's UTC. created_at is a TIMESTAMP, so it converts too.
        await conn.query("SET time_zone = '+08:00'");
        const [[stats]] = await conn.query(`
            SELECT
                COUNT(*) AS total,
                SUM(is_active = TRUE) AS active,
                SUM(is_active = TRUE AND stock_quantity <= reorder_level) AS restock,
                SUM(is_active = TRUE AND (stock_quantity = 0 OR stock_quantity IS NULL)) AS out_of_stock,
                SUM(is_active = TRUE AND expiration_date IS NOT NULL AND expiration_date < CURDATE()) AS expired,
                SUM(is_active = TRUE AND expiration_date IS NOT NULL AND expiration_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY) AS expiring,
                ROUND(SUM(is_active = TRUE AND unit_price IS NOT NULL AND stock_quantity IS NOT NULL) * 0) AS _zero
            FROM products`);
        const [[value]] = await conn.query(
            "SELECT ROUND(COALESCE(SUM(unit_price * stock_quantity),0),2) AS v FROM products WHERE is_active = TRUE");
        const [restock] = await conn.query(`
            SELECT name, sku, stock_quantity, reorder_level, expiration_date
            FROM products
            WHERE is_active = TRUE AND stock_quantity <= reorder_level
            ORDER BY stock_quantity ASC LIMIT 12`);
        const [expiring] = await conn.query(`
            SELECT name, sku, stock_quantity, expiration_date,
                   DATEDIFF(expiration_date, CURDATE()) AS days_left
            FROM products
            WHERE is_active = TRUE AND expiration_date IS NOT NULL
              AND expiration_date <= CURDATE() + INTERVAL 30 DAY
            ORDER BY expiration_date ASC LIMIT 12`);
        const [[today]] = await conn.query(`
            SELECT COUNT(*) AS txns, COALESCE(SUM(final_amount),0) AS revenue
            FROM sales WHERE DATE(created_at) = CURDATE() AND payment_status = 'completed'`);
        const [[month]] = await conn.query(`
            SELECT COUNT(*) AS txns, COALESCE(SUM(final_amount),0) AS revenue
            FROM sales WHERE created_at >= CURDATE() - INTERVAL 30 DAY AND payment_status = 'completed'`);
        const [topSellers] = await conn.query(`
            SELECT p.name, SUM(si.quantity) AS sold
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id AND s.payment_status = 'completed'
            JOIN products p ON si.product_id = p.id
            WHERE s.created_at >= CURDATE() - INTERVAL 30 DAY
            GROUP BY p.id ORDER BY sold DESC LIMIT 8`);
        const [suppliers] = await conn.query(
            "SELECT name, email FROM suppliers WHERE is_active = TRUE LIMIT 10");

        const fmtDate = d => d ? new Date(d).toISOString().slice(0, 10) : 'none';
        const peso = n => '₱' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const phNow = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
        return `LIVE SHOP DATA (as of ${phNow} Philippine time, UTC+8):

INVENTORY OVERVIEW
- Active products: ${stats.active}
- Needing restock (at/below reorder level): ${stats.restock}
- Out of stock: ${stats.out_of_stock}
- Expiring within 30 days: ${stats.expiring}
- Already expired: ${stats.expired}
- Total inventory value (retail): ${peso(value.v)}

PRODUCTS NEEDING RESTOCK (lowest stock first):
${restock.length ? restock.map(p => `- ${p.name} (${p.sku}): ${Number(p.stock_quantity)} left, reorder at ${p.reorder_level}`).join('\n') : '- none'}

EXPIRING / EXPIRED SOON:
${expiring.length ? expiring.map(p => `- ${p.name} (${p.sku}): ${Number(p.stock_quantity)} in stock, expires ${fmtDate(p.expiration_date)} (${p.days_left < 0 ? Math.abs(p.days_left) + ' days ago' : 'in ' + p.days_left + ' days'})`).join('\n') : '- none'}

SALES
- Today: ${today.txns} sales, ${peso(today.revenue)}
- Last 30 days: ${month.txns} sales, ${peso(month.revenue)}

TOP SELLERS (last 30 days):
${topSellers.length ? topSellers.map(p => `- ${p.name}: ${Number(p.sold)} units`).join('\n') : '- no recent sales'}

ACTIVE SUPPLIERS:
${suppliers.length ? suppliers.map(s => `- ${s.name} <${s.email}>`).join('\n') : '- none'}`;
    } finally {
        // Restore the shared connection's timezone before returning it to the pool.
        try { await conn.query("SET time_zone = 'SYSTEM'"); } catch { /* ignore */ }
        conn.release();
    }
}

// This doubles as the built-in HELP GUIDE — the standalone guide is merged in
// here so the assistant can walk a user through any feature step by step.
const CAPABILITIES = `FETCH is an Inventory Management System with Predictive Analytics for Risha Pet Supplies. This is also the built-in help guide — when a user asks "how do I…", give clear numbered steps. What each part does and how to use it:

- DASHBOARD: the daily command center — sales KPIs, the live day brief (today's sales and items needing attention), Sales Trend chart, Expiry Radar, and Supply Chain status. The "Live" chip turns red if the connection drops.

- POINT OF SALE (POS): cash-only checkout built for speed. Left panel: search or browse products and click to add to the cart (out-of-stock and expired items can't be sold). Right panel: adjust quantities, set a discount, enter cash received using the quick-cash buttons (Exact / +20 / +50 / +100) and the change is computed automatically. Scan barcodes anytime, or press F2 to focus the scan field. "Charge" completes the sale, updates stock instantly, and shows a printable 58mm receipt.

- INVENTORY: card grid or table view. Filter with the status chips (Low Stock, Out of Stock, Expiring Soon, Expired, Healthy) and sort any column by clicking its header. "Reorder" lets you pick low-stock products; after a final confirmation it creates purchase orders and emails the suppliers. Expired items can be reordered — the received batch replaces the old one. "Import" does bulk CSV product uploads; checkboxes enable bulk reorder/adjust/delete. Staff see inventory read-only; only admins and managers can add, edit, or delete.

- SALES HISTORY: search and filter past sales by date; click "View" for item details and a printable receipt. "Void" (admins/managers) cancels a sale with a required reason — items return to stock and the sale stays in history marked Voided, excluded from all totals. "End of Day" records the drawer count: the system shows the expected cash from today's sales, you enter what was actually counted, and any over/short is saved with notes.

- SUPPLIERS: contacts, payment terms, and delivery performance per supplier. The Performance modal is derived from real purchase orders (fulfillment rate, average lead time, orders received) plus email confirmation status (Confirmed/Viewed/Awaiting). Click a supplier's email address or the "Emails" button to see every message sent with read receipts: ✓ delivered, ✓✓ the supplier actually opened or clicked it (automated scanners are filtered out). Purchase orders advance Confirm → Shipped → Receive; receiving adds stock and can set the new batch's expiration date (this is how an expired product becomes fresh again).

- REPORTS & ANALYTICS: Daily/Weekly/Monthly tabs give printable sales summaries with category and payment breakdowns. The Analytics tab is the forecasting hub: 30-day demand and revenue projections, and a Model Accuracy score that is backtested (the system hides recent sales from itself, forecasts them, and grades the result). Click the Fast Movers / Slow Movers / At Risk / Steady cards to list products in each segment with stock, daily rate, and days of cover; pick any product for its forecast chart with confidence range and reorder advice. Forecasting uses a Random Forest + Gradient Boosting ensemble blended with a statistical model. Audit Logs (admins) show who did what, when, and from which address.

- USERS & ROLES: Admin — everything, including users, audit logs, email settings, and backups. Manager — inventory, suppliers, reorders, voids; no user management. Staff — sell on the POS, record the end-of-day count, and view everything else read-only. Passwords need at least 6 characters with an uppercase letter, a number, and a special character. Five failed logins locks the account for a few minutes.

- NOTIFICATIONS: alerts for low stock, stockouts, and expiring products, opened from the bell in the sidebar or the Notifications page. Suppliers with low-stock products are emailed automatically at most once per day.

- BACKUPS & SAFETY: a full database backup is emailed automatically once a day; admins can also download one anytime from Settings → Preferences → Data Backup (do this before big changes). Every confirmed action (reorders, voids, deletes) asks first and shows a popup when done.

- KEYBOARD SHORTCUTS: F2 focuses the barcode scanner (POS). ⌘K / Ctrl+K opens global search. Esc closes any open modal or popup. Enter confirms the open popup.`;

const SYSTEM_INSTRUCTION = `You are FETCH Assistant, the built-in helper for the FETCH inventory management system used by Risha Pet Supplies (a pet supply shop in the Philippines).

RULES:
- Only answer questions about running THIS shop and using THIS system: inventory, stock, expiration, reordering, suppliers, sales, POS, reports/forecasts, end-of-day cash, users/roles, and how to use features.
- Use the LIVE SHOP DATA provided to give specific, current answers (real product names, numbers, dates). When asked "what should I reorder" or "what's expiring", name the actual products from the data.
- If asked something unrelated to this shop or system (general trivia, coding, world events, personal advice), politely decline in one sentence and steer back: "I can only help with your FETCH inventory system — try asking about stock, reorders, or sales."
- Currency is Philippine Peso (₱). All dates and times are Philippine time (UTC+8) — never mention UTC. Be concise and practical — a shopkeeper is asking, not a developer. Prefer short paragraphs or tight bullet lists. Never invent data that isn't in the snapshot; if you don't have it, say so and suggest where in the system to look.`;

async function askAssistant(question) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        return { ok: false, reason: 'no_key', message: 'The AI assistant is not configured yet. Add a free Google Gemini API key (GEMINI_API_KEY) to enable it.' };
    }
    if (!question || !question.trim()) {
        return { ok: false, reason: 'empty', message: 'Please type a question.' };
    }

    let context;
    try {
        context = await buildContext();
    } catch (e) {
        context = 'LIVE SHOP DATA: (temporarily unavailable)';
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    const body = {
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION + '\n\n' + CAPABILITIES }] },
        contents: [{ role: 'user', parts: [{ text: context + '\n\nQUESTION: ' + question.trim() }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errText = await res.text();
            console.error('[Assistant] Gemini error', res.status, errText.slice(0, 200));
            return { ok: false, reason: 'api_error', message: 'The assistant had trouble reaching the AI service. Please try again in a moment.' };
        }
        const data = await res.json();
        const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        if (!answer) {
            return { ok: false, reason: 'empty_answer', message: "I couldn't come up with an answer for that — try rephrasing." };
        }
        return { ok: true, answer };
    } catch (e) {
        console.error('[Assistant] request failed:', e.message);
        return { ok: false, reason: 'network', message: 'The assistant is unreachable right now. Please try again.' };
    }
}

module.exports = { askAssistant, buildContext };
