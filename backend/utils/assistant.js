// FETCH AI Assistant — gathers a live snapshot of the shop, sends it with the
// user's question to Google Gemini (free tier), and returns a grounded answer.
// Scoped by a strict system instruction so it only answers about this system.
const pool = require('../config/database');
const { asDay } = require('./expiry');

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

        const fmtDate = d => asDay(d) || 'none';   // the date as stored, not shifted a day through UTC
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

- INVENTORY: card grid or table view. Filter with the status chips (Low Stock, Out of Stock, Expiring Soon, Expired, Healthy) and sort any column by clicking its header. "Reorder" lets you pick low-stock products; after a final confirmation it creates the purchase orders and emails each supplier its order (if an email fails, resend it from the supplier's Performance panel). Expired items can be reordered — the received batch replaces the old one. "Import" does bulk CSV product uploads; checkboxes enable bulk reorder/adjust/delete. Only admins and managers can add, edit, or delete products.

- SALES HISTORY: search and filter past sales by date; click "View" for item details and a printable receipt. "Void" (admins/managers) cancels a sale with a required reason — items return to stock and the sale stays in history marked Voided, excluded from all totals. "End of Day" records the drawer count: the system shows the expected cash from today's sales, you enter what was actually counted, and any over/short is saved with notes.

- SUPPLIERS: contacts, payment terms, and delivery performance per supplier. The Performance modal is derived from real purchase orders (fulfillment rate, average lead time, orders received) plus email confirmation status (Confirmed/Viewed/Awaiting). Click a supplier's email address or the "Emails" button to see every message sent with read receipts: ✓ delivered, ✓✓ the supplier actually opened or clicked it (automated scanners are filtered out). Purchase orders advance Confirm → Shipped → Receive; receiving adds stock and can set the new batch's expiration date (this is how an expired product becomes fresh again).

- REPORTS & ANALYTICS: Daily/Weekly/Monthly tabs give printable sales summaries with category and payment breakdowns. The Analytics tab is the forecasting hub: 30-day demand and revenue projections, and a Model Accuracy score that is backtested (the system hides recent sales from itself, forecasts them, and grades the result). Click the Fast Movers / Slow Movers / At Risk / Steady cards to list products in each segment with stock, daily rate, and days of cover; pick any product for its forecast chart with confidence range and reorder advice. Forecasting uses a Random Forest + Gradient Boosting ensemble (scikit-learn), fitted once on all products together from the last four months of sales. A product with under six weeks of sales is forecast from a simple trend, and one with under two weeks gets a cautious first estimate. Freak days are capped and days with no usable record are left out before anything is forecast, and the forecast is corrected by half of its own last miss. Audit Logs (admins) show who did what, when, and from which address.

- USERS & ROLES: Admin — everything, including users, audit logs, email settings, and backups. Manager — inventory, suppliers, reorders, voids; no user management. Cashier (shown as Staff) — the Point of Sale only: sell, ask for a void, record cash in and out and the end-of-day count. Supplier — the Supplier Portal only: their own orders, offers, prices and details. Simulation — a watch-only account for recording: it opens only the Live shop simulation screen, where it can start and stop simulated sales (marked SIM), and nothing else. Passwords need at least 6 characters with an uppercase letter, a number, and a special character. Five failed logins locks the account for a few minutes.

- NOTIFICATIONS: alerts for low stock, stockouts, and expiring products, opened from the bell in the sidebar or the Notifications page. Suppliers with low-stock products are emailed automatically at most once per day.

- BACKUPS & SAFETY: a full database backup is emailed automatically once a day; admins can also download one anytime from Settings → Preferences → Data Backup (do this before big changes). Every confirmed action (reorders, voids, deletes) asks first and shows a popup when done.

- KEYBOARD SHORTCUTS: F2 focuses the barcode scanner (POS). ⌘K / Ctrl+K opens global search. Esc closes any open modal or popup. Enter confirms the open popup.`;

const SYSTEM_INSTRUCTION = `You are FETCH Assistant, the built-in helper for the FETCH inventory management system used by Risha Pet Supplies (a pet supply shop in the Philippines).

RULES:
- Only answer questions about running THIS shop and using THIS system: inventory, stock, expiration, reordering, suppliers, sales, POS, reports/forecasts, end-of-day cash, users/roles, and how to use features.
- Use the LIVE SHOP DATA provided to give specific, current answers (real product names, numbers, dates). When asked "what should I reorder" or "what's expiring", name the actual products from the data.
- If asked something unrelated to this shop or system (general trivia, coding, world events, personal advice), politely decline in one sentence and steer back: "I can only help with your FETCH inventory system — try asking about stock, reorders, or sales."
- Currency is Philippine Peso (₱). All dates and times are Philippine time (UTC+8) — never mention UTC. Be concise and practical — a shopkeeper is asking, not a developer. Prefer short paragraphs or tight bullet lists. Never invent data that isn't in the snapshot; if you don't have it, say so and suggest where in the system to look.`;

/* ---------- Tools: what the assistant can look up, and what it can prepare ----------
   (Carlo, 3 Nov: "kaya niya din view and analyze reports and forecast … at
   kaya niya din controlin ung system like adding products")

   Look-ups go through the system's own endpoints with the asking user's own
   sign-in, so the numbers are the ones the pages show and a role sees only
   what it may. Actions are never carried out here: the assistant prepares
   one, the page shows it as a card, and nothing is saved until the person
   presses Confirm, which sends it through the normal endpoint (same checks,
   same role rules, same audit log). */

const PORT = process.env.PORT || 8000;
const MANAGES = ['admin', 'manager'];
const shopDay = (offset = 0) => new Date(Date.now() + 8 * 3600000 + offset * DAY).toISOString().slice(0, 10);

function makeApi(auth) {
    return async (path, opts = {}) => {
        const res = await fetch(`http://127.0.0.1:${PORT}/api${path}`, {
            method: opts.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...(auth.authorization ? { Authorization: auth.authorization } : {}), ...(auth.cookie ? { Cookie: auth.cookie } : {}) },
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        return res.json().catch(() => ({ success: false, message: 'No answer from ' + path }));
    };
}

const num = v => Math.round((Number(v) || 0) * 100) / 100;
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const TOOLS = [{
    function_declarations: [
        {
            name: 'get_sales_report',
            description: 'Sales for a date range: number of sales, revenue, items sold, average sale, revenue by category, best-selling products, payment methods. Use for questions about sales, revenue, best sellers, categories, or comparing periods (call it once per period). Dates are YYYY-MM-DD, Philippine time. Defaults to the last 30 days.',
            parameters: { type: 'OBJECT', properties: {
                date_from: { type: 'STRING', description: 'First day, YYYY-MM-DD' },
                date_to: { type: 'STRING', description: 'Last day, YYYY-MM-DD' }
            } }
        },
        {
            name: 'get_stock_planning',
            description: 'The demand forecast and what it means for stock: items and revenue expected in the next 30 days (total and by category), forecast accuracy, the products to reorder (with suggested amount and the last day to order), products expired or likely to expire before selling, and products with too much stock. Use for any question about the forecast, predictions, what to order, expiry risk or overstock.',
            parameters: { type: 'OBJECT', properties: {} }
        },
        {
            name: 'find_product',
            description: 'One product by name (or part of it, or its SKU): stock, prices, category, supplier, expiry, and its own forecast (expected next 30 days, how long the stock lasts, whether to reorder). Use before preparing a reorder, or when the user asks about a specific product.',
            parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'Product name, part of it, or SKU' } }, required: ['name'] }
        },
        {
            name: 'prepare_add_product',
            description: 'Prepare a NEW product to be added to inventory. It is NOT saved: the user sees a card and presses Confirm. Only call it when the user asked to add a product. Ask the user first for anything required that they did not give (name, category, selling price, stock). Food, health and litter products also need an expiration date.',
            parameters: { type: 'OBJECT', properties: {
                name: { type: 'STRING' },
                category: { type: 'STRING', description: 'One of the shop categories, e.g. Food, Accessories, Health & Wellness, Litter & Waste, Toys, Cages & Habitats, Grooming' },
                sku_type: { type: 'STRING', description: 'DRY (dry food), WET (wet food), SUP (supplements), GRO (grooming), LIT (litter), TOY (toys), CAG (cages), ACC (accessories)' },
                unit_price: { type: 'NUMBER', description: 'Selling price in pesos' },
                cost_price: { type: 'NUMBER', description: 'What the shop pays the supplier, in pesos' },
                stock_quantity: { type: 'NUMBER' },
                reorder_level: { type: 'NUMBER' },
                brand: { type: 'STRING', description: 'Only if the user named the brand; otherwise leave it out' },
                species: { type: 'STRING', description: 'Dog, Cat, Bird or Fish; only if the user said which pet; otherwise leave it out' },
                supplier: { type: 'STRING', description: 'Supplier name' },
                expiration_date: { type: 'STRING', description: 'YYYY-MM-DD' },
                unit_type: { type: 'STRING', description: 'piece, kg, g, liter or ml' }
            }, required: ['name'] }
        },
        {
            name: 'prepare_reorder',
            description: 'Prepare a purchase order for one or more products (it is emailed to each product\'s supplier when confirmed). It is NOT sent: the user sees a card and presses Confirm. Only call it when the user asked to order or reorder. If the user did not say how many, use the suggested amount from get_stock_planning or find_product.',
            parameters: { type: 'OBJECT', properties: {
                items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
                    product: { type: 'STRING', description: 'Product name or SKU' },
                    quantity: { type: 'NUMBER' }
                }, required: ['product', 'quantity'] } }
            }, required: ['items'] }
        }
    ]
}];

const SKU_FOR_CATEGORY = [[/litter/i, 'LIT'], [/toy/i, 'TOY'], [/cage|habitat/i, 'CAG'], [/groom/i, 'GRO'], [/health|supplement|vitamin|medic/i, 'SUP'], [/wet|can/i, 'WET'], [/food|treat/i, 'DRY']];

async function runTool(name, args, ctx) {
    const api = ctx.api;
    args = args || {};
    if (name === 'get_sales_report') {
        const to = isDay(args.date_to) ? args.date_to : shopDay();
        const from = isDay(args.date_from) ? args.date_from : shopDay(-29);
        const r = await api(`/sales/report?period=daily&date_from=${from}&date_to=${to}`);
        if (!r.success) return { error: r.message || 'The sales report could not be read.' };
        const s = r.data.summary || {};
        return {
            from, to,
            sales: Number(s.total_transactions) || 0, revenue: num(s.total_revenue), items_sold: Number(s.total_items_sold) || 0,
            average_sale: num(s.avg_transaction_value), discounts_given: num(s.discounts_given),
            by_category: (s.category_breakdown || []).map(c => ({ category: c.category_name, sold_for: num(c.total_revenue), units: Number(c.total_quantity) || 0 })),
            best_sellers: (r.data.top_products || []).map(p => ({ product: p.name, units: Number(p.quantity) || 0, sold_for: num(p.revenue) })),
            payments: (s.payment_breakdown || []).map(p => ({ method: p.payment_method, sales: Number(p.count) || 0, total: num(p.total) })),
            days_with_sales: (r.data.rows || []).length
        };
    }
    if (name === 'get_stock_planning') {
        const plan = await ctx.plan();
        if (!plan) return { error: 'The forecast is not available right now.' };
        const t = plan.totals || {};
        const ps = plan.products || [];
        const pick = (list, n, map) => list.slice(0, n).map(map);
        return {
            forecast_days: plan.forecast_days, based_on_days_of_sales: plan.history_days, last_sale: plan.last_sale_date,
            expected_items_next_30_days: t.expected_units, expected_revenue_next_30_days: num(t.expected_revenue),
            accuracy_percent_in_last_test: t.accuracy, accuracy_test: t.accuracy_test || null,
            expected_by_category: (plan.by_category || []).slice(0, 8).map(g => ({ category: g.name, expected_items: g.expected_30d, sold_last_30_days: g.sold_30d })),
            to_reorder: pick(ps.filter(p => p.stock_status !== 'ok').sort((a, b) => (a.order_by || '9').localeCompare(b.order_by || '9')), 15, p => ({
                product: p.name, in_stock: p.stock, expected_next_30_days: p.expected_30d, status: p.stock_status,
                suggested_order: p.suggested_order, order_by: p.order_by, supplier: p.supplier_name || null })),
            expiry: pick(ps.filter(p => p.expired_units > 0 || p.expiry_risk_units > 0).sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on))), 12, p => ({
                product: p.name, expires_on: p.expires_on, in_stock: p.stock, already_expired_units: p.expired_units, likely_unsold_at_expiry: p.expiry_risk_units })),
            too_much_stock: pick(ps.filter(p => p.excess_units > 0).sort((a, b) => b.excess_value - a.excess_value), 10, p => ({
                product: p.name, in_stock: p.stock, more_than_needed: p.excess_units, money_tied_up: num(p.excess_value) })),
            selling_fast: pick(ps.filter(p => p.demand === 'fast').sort((a, b) => b.expected_30d - a.expected_30d), 8, p => ({ product: p.name, expected_next_30_days: p.expected_30d }))
        };
    }
    if (name === 'find_product') {
        const q = String(args.name || '').trim().slice(0, 100);
        if (!q) return { error: 'Say which product.' };
        const r = await api(`/products?search=${encodeURIComponent(q)}&limit=5&fields=light`);
        const list = r.success ? (r.data || []) : [];
        if (!list.length) return { found: 0, message: `No product matches "${q}".` };
        const plan = await ctx.plan();
        const byId = new Map(((plan && plan.products) || []).map(p => [Number(p.id), p]));
        return { found: list.length, products: list.map(p => {
            const f = byId.get(Number(p.id)) || {};
            return {
                product: p.name, sku: p.sku, category: p.category_name, brand: p.brand || null, supplier: p.supplier_name || null,
                in_stock: Number(p.stock_quantity), reorder_level: p.reorder_level, selling_price: num(p.unit_price), cost_price: num(p.cost_price),
                expires: p.expiration_date ? String(p.expiration_date).slice(0, 10) : null,
                sold_last_30_days: f.sold_30d, expected_next_30_days: f.expected_30d, stock_lasts_days: f.days_left,
                stock_status: f.stock_status, suggested_order: f.suggested_order, order_by: f.order_by
            };
        }) };
    }
    if (name === 'prepare_add_product' || name === 'prepare_reorder') {
        if (!MANAGES.includes(ctx.user.role)) return { error: 'Only an administrator or a manager can do this. Tell the user to ask one.' };
    }
    if (name === 'prepare_add_product') {
        const missing = [];
        const pname = String(args.name || '').trim();
        if (!pname) missing.push('product name');
        if (!args.category) missing.push('category');
        if (!(Number(args.unit_price) > 0)) missing.push('selling price');
        if (args.stock_quantity == null || !(Number(args.stock_quantity) >= 0)) missing.push('how many are in stock');
        const cats = (await api('/products/categories')).data || [];
        const cat = args.category && (cats.find(c => c.name.toLowerCase() === String(args.category).toLowerCase())
            || cats.find(c => c.name.toLowerCase().includes(String(args.category).toLowerCase()) || String(args.category).toLowerCase().includes(c.name.toLowerCase())));
        if (args.category && !cat) missing.push(`a category from the list (${cats.map(c => c.name).join(', ')})`);
        let supplier = null;
        if (args.supplier) {
            const sups = (await api('/suppliers')).data || [];
            supplier = sups.find(x => x.name.toLowerCase() === String(args.supplier).toLowerCase())
                || sups.find(x => x.name.toLowerCase().includes(String(args.supplier).toLowerCase()));
            if (!supplier) missing.push(`a supplier from the list (${sups.map(x => x.name).join(', ')})`);
        }
        if (missing.length) return { saved: false, ask_the_user_for: missing };
        const sku = /^(DRY|WET|SUP|GRO|LIT|TOY|CAG|ACC)$/.test(String(args.sku_type || '').toUpperCase()) ? String(args.sku_type).toUpperCase()
            : (SKU_FOR_CATEGORY.find(([re]) => re.test(cat.name + ' ' + pname)) || [null, 'ACC'])[1];
        const payload = {
            name: pname, sku_type: sku, category_id: cat.id, unit_price: num(args.unit_price),
            cost_price: args.cost_price != null ? num(args.cost_price) : 0, stock_quantity: Number(args.stock_quantity) || 0,
            reorder_level: args.reorder_level != null ? Math.max(0, Math.round(Number(args.reorder_level))) : 10,
            brand: args.brand || null, species: ['Dog', 'Cat', 'Bird', 'Fish'].includes(args.species) ? args.species : null,
            supplier_id: supplier ? supplier.id : null, expiration_date: isDay(args.expiration_date) ? args.expiration_date : null,
            unit_type: ['piece', 'kg', 'g', 'liter', 'ml'].includes(args.unit_type) ? args.unit_type : 'piece'
        };
        ctx.actions.push({
            type: 'add_product', title: 'Add product: ' + pname,
            rows: [['Name', pname], ['Category', cat.name], ['Selling price', '₱' + payload.unit_price.toFixed(2)], ['Cost', payload.cost_price ? '₱' + payload.cost_price.toFixed(2) : 'Not set'],
                ['Stock', String(payload.stock_quantity)], ['Reorder level', String(payload.reorder_level)], ['Brand', payload.brand || '—'], ['Pet', payload.species || 'Any'],
                ['Supplier', supplier ? supplier.name : 'None'], ['Expires', payload.expiration_date || 'Not set']],
            payload
        });
        return { prepared: true, saved: false, note: 'The user now sees this as a card with a Confirm button. Tell them to check it and press Confirm to add it. Nothing is saved yet.' };
    }
    if (name === 'prepare_reorder') {
        const lines = [], problems = [];
        for (const it of (Array.isArray(args.items) ? args.items : []).slice(0, 20)) {
            const q = String(it.product || '').trim();
            const qty = Math.round(Number(it.quantity));
            if (!q) continue;
            if (!(qty > 0) || qty > 10000) { problems.push(`${q}: the quantity must be 1 to 10,000`); continue; }
            const r = await api(`/products?search=${encodeURIComponent(q)}&limit=5&fields=light`);
            const list = r.success ? (r.data || []) : [];
            const p = list.find(x => x.name.toLowerCase() === q.toLowerCase() || String(x.sku).toLowerCase() === q.toLowerCase()) || (list.length === 1 ? list[0] : null);
            if (!p) { problems.push(list.length ? `${q}: more than one product matches (${list.map(x => x.name).join(', ')}); ask which` : `${q}: no such product`); continue; }
            if (!p.supplier_id) { problems.push(`${p.name}: has no supplier, so it cannot be ordered; assign one in Inventory first`); continue; }
            lines.push({ product_id: p.id, quantity: qty, name: p.name, supplier: p.supplier_name || 'its supplier', cost: num(p.cost_price) });
        }
        if (!lines.length) return { prepared: false, problems };
        const total = lines.reduce((a, l) => a + l.cost * l.quantity, 0);
        ctx.actions.push({
            type: 'reorder', title: 'Order from supplier' + (new Set(lines.map(l => l.supplier)).size === 1 ? ': ' + lines[0].supplier : 's'),
            rows: lines.map(l => [l.name, `${l.quantity} × ₱${l.cost.toFixed(2)} · ${l.supplier}`]).concat([['Total at cost', '₱' + total.toFixed(2)]]),
            payload: { items: lines.map(l => ({ product_id: l.product_id, quantity: l.quantity })) }
        });
        return { prepared: true, sent: false, problems, note: 'The user now sees the order as a card with a Confirm button; on Confirm it is created and emailed to the supplier. Nothing is sent yet.' };
    }
    return { error: 'Unknown tool' };
}

const TOOL_RULES = `
TOOLS:
- You can look things up with get_sales_report, get_stock_planning and find_product. Use them whenever a question needs numbers beyond the LIVE SHOP DATA (any date range, the forecast, a specific product). Never guess a number you could look up.
- You can PREPARE actions with prepare_add_product and prepare_reorder. They are not saved: the user sees a card and must press Confirm. Say so in one short sentence ("Check the card and press Confirm to add it."). Never say something was added or ordered.
- Only say there is a card when the tool answered prepared: true. If it answered ask_the_user_for or error, there is no card: ask for those things, or say what went wrong.
- Ask for what is missing before preparing an action, in one short question.
- Put on a card only what the user said or what you looked up. Never make up a field (a brand, a pet, a supplier, a date): leave an optional one out, and ask for a required one.
- Explain numbers simply, for a shopkeeper who is not technical: say what it means and what to do, not how it was computed, unless asked.`;

async function askAssistant(question, opts = {}) {
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

    // the forecast is read at most once per question, and only if a tool needs it
    const api = makeApi(opts.auth || {});
    let planPromise = null;
    const ctx = {
        api, user: opts.user || {}, actions: [],
        plan: () => planPromise || (planPromise = api('/predictions/overview').then(r => r && r.success ? r.data : null).catch(() => null))
    };

    // the last few turns, so "add it" or "and last month?" make sense
    const history = (Array.isArray(opts.history) ? opts.history : []).slice(-8)
        .filter(h => h && typeof h.text === 'string' && h.text.trim())
        .map(h => ({ role: h.role === 'bot' ? 'model' : 'user', parts: [{ text: h.text.slice(0, 1500) }] }));
    const contents = [...history, { role: 'user', parts: [{ text: context + '\n\nToday is ' + shopDay() + '.\n\nQUESTION: ' + question.trim() }] }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    try {
        for (let round = 0; round < 5; round++) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION + '\n' + TOOL_RULES + '\n\n' + CAPABILITIES }] },
                    contents,
                    tools: TOOLS,
                    generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
                })
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error('[Assistant] Gemini error', res.status, errText.slice(0, 200));
                return { ok: false, reason: 'api_error', message: 'The assistant had trouble reaching the AI service. Please try again in a moment.' };
            }
            const data = await res.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];
            const calls = parts.filter(p => p.functionCall);
            if (!calls.length) {
                const answer = parts.map(p => p.text || '').join('').trim();
                if (!answer && !ctx.actions.length) return { ok: false, reason: 'empty_answer', message: "I couldn't come up with an answer for that — try rephrasing." };
                return { ok: true, answer: answer || 'Check the card below and press Confirm.', actions: ctx.actions };
            }
            contents.push({ role: 'model', parts });
            const replies = [];
            for (const c of calls) {
                let out;
                try { out = await runTool(c.functionCall.name, c.functionCall.args, ctx); }
                catch (e) { console.error('[Assistant] tool failed:', c.functionCall.name, e.message); out = { error: 'That could not be looked up right now.' }; }
                replies.push({ functionResponse: { name: c.functionCall.name, response: { result: out } } });
            }
            contents.push({ role: 'user', parts: replies });
        }
        return { ok: true, answer: 'That needed more steps than I can take at once. Try asking one thing at a time.', actions: ctx.actions };
    } catch (e) {
        console.error('[Assistant] request failed:', e.message);
        return { ok: false, reason: 'network', message: 'The assistant is unreachable right now. Please try again.' };
    }
}

module.exports = { askAssistant, buildContext, runTool };
