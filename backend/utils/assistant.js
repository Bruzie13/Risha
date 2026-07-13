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

        return `LIVE SHOP DATA (as of ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC):

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
        conn.release();
    }
}

const CAPABILITIES = `FETCH is an Inventory Management System with Predictive Analytics for Risha Pet Supplies. What it can do and how:
- DASHBOARD: KPIs, today's day brief, Sales Trend chart, Expiry Radar, Supply Chain status.
- INVENTORY: card grid or table view; filter with status chips (Low Stock, Out of Stock, Expiring Soon, Expired, Healthy); sort columns; Add/Edit/Stock/Delete products (admin/manager only); CSV import; Reorder button that creates purchase orders and emails suppliers (with a final confirmation).
- POS: cash-only checkout; scan barcodes or search; quick-cash buttons (Exact/+20/+50/+100); Charge completes the sale, updates stock, prints a 58mm receipt.
- SALES HISTORY: search/filter; View a sale for a printable receipt; Void a sale (admin/manager, reason required — restores stock, keeps a Voided record); End of Day cash reconciliation (expected drawer cash vs counted, over/short).
- SUPPLIERS: contacts, payment terms; Performance modal derived from real purchase orders (fulfillment rate, avg lead time, orders received) plus supplier email confirmation status (Confirmed/Viewed/Awaiting); email read receipts (✓ delivered, ✓✓ opened/clicked). Purchase orders advance Confirm → Shipped → Receive; receiving adds stock and can set the new batch's expiration date (this is how an expired product becomes fresh again).
- REPORTS & ANALYTICS: daily/weekly/monthly sales reports; Analytics tab with 30-day demand forecast, projected revenue, backtested model accuracy, and Fast/Slow/At-risk/Steady product segments. Forecasting uses a Random Forest + Gradient Boosting ensemble blended with a statistical model.
- USERS & ROLES: Admin (everything), Manager (inventory/suppliers/reorders/voids), Staff/Cashier (POS selling + view). Passwords need 6+ chars with uppercase, number, special character. 5 failed logins locks the account briefly.
- BACKUPS: a full database backup is emailed daily; admins can download one from Settings → Preferences.`;

const SYSTEM_INSTRUCTION = `You are FETCH Assistant, the built-in helper for the FETCH inventory management system used by Risha Pet Supplies (a pet supply shop in the Philippines).

RULES:
- Only answer questions about running THIS shop and using THIS system: inventory, stock, expiration, reordering, suppliers, sales, POS, reports/forecasts, end-of-day cash, users/roles, and how to use features.
- Use the LIVE SHOP DATA provided to give specific, current answers (real product names, numbers, dates). When asked "what should I reorder" or "what's expiring", name the actual products from the data.
- If asked something unrelated to this shop or system (general trivia, coding, world events, personal advice), politely decline in one sentence and steer back: "I can only help with your FETCH inventory system — try asking about stock, reorders, or sales."
- Currency is Philippine Peso (₱). Be concise and practical — a shopkeeper is asking, not a developer. Prefer short paragraphs or tight bullet lists. Never invent data that isn't in the snapshot; if you don't have it, say so and suggest where in the system to look.`;

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
