/* Daily sales simulation.

   Fills every day the shop has no sales for, up to yesterday (or today once
   the shop has closed), with the POS activity an urban Metro Manila
   neighbourhood pet-supply shop would have: walk-ins through the day, more
   after pay day and in the "ber" months, quieter on rainy and holiday days,
   regulars who come back for the same food, stock going down with each sale
   and supplier deliveries twice a week that bring low items back up.

   It writes what a real POS sale writes (sales, sale_items, the stock
   decrement and a stock_movements row), so Reports, Analytics and the
   forecast read it like real trading. Audit rows and notifications are left
   out on purpose: hundreds of "New Sale Completed" notices would bury the
   real ones.

   EVERY ROW IT WRITES IS MARKED, so it can all be taken out again:
     sales.sale_number      starts with  SIM-
     sales.notes            ends with    [SIM]
     stock_movements.notes  starts with  [SIM]
   `node scripts/simulate.js --remove` deletes them and puts stock back.

   Safety:
     - A full database backup is saved to backups/auto/ BEFORE anything is
       written. If the backup fails, nothing is written.
     - Days that already have real (non-SIM) sales are never touched.
     - Each day is one transaction, and the last finished day is recorded in
       app_settings, so a crash or a second copy of the server cannot write a
       day twice. A database lock stops two copies running at once.
     - Off in production (NODE_ENV=production, i.e. Render) unless
       SIMULATION=on. SIMULATION=off turns it off everywhere. */
const pool = require('../../config/database');
const { saveBackupToDisk } = require('../../utils/backup');
const cal = require('./calendar');
const { maxDiscountFrom } = require('../../utils/till');

const TAG = '[SIM]';
const SALE_PREFIX = 'SIM-';
const LOCK = 'risha_sales_simulation';

const settings = () => ({
    perDay: Number(process.env.SIM_SALES_PER_DAY) || 15, // an ordinary weekday
    maxDays: Number(process.env.SIM_MAX_DAYS) || 120,     // longest catch-up in one run
    seed: Number(process.env.SIM_SEED) || 20261105,
});

function enabled() {
    const v = String(process.env.SIMULATION || '').toLowerCase();
    if (['off', 'false', '0', 'no'].includes(v)) return false;
    if (['on', 'true', '1', 'yes'].includes(v)) return true;
    return process.env.NODE_ENV !== 'production';
}

/* ---------- random numbers, the same every time for the same day ---------- */
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function pickWeighted(rand, items, weightOf) {
    let total = 0;
    for (const it of items) total += weightOf(it);
    let r = rand() * total;
    for (const it of items) { r -= weightOf(it); if (r <= 0) return it; }
    return items[items.length - 1];
}
function gamma(rand, k) { // Marsaglia-Tsang, k >= 1
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
        let x, v;
        do {
            const u1 = rand() || 1e-12, u2 = rand();
            x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = rand();
        if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}
function poisson(rand, lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
}
/** Customers for the day: Poisson around the mean with some extra
    day-to-day spread (negative binomial, dispersion 25), never below half
    of the expected count on a day the shop is open. */
const customerCount = (rand, mean) => Math.max(Math.round(mean / 2), poisson(rand, mean * gamma(rand, 25) / 25));

/* ---------- people ---------- */
const FIRST = ['Maria', 'Jose', 'Juan', 'Ana', 'Mark', 'Angelica', 'John Paul', 'Kristine', 'Rodel', 'Jasmine',
    'Carlo', 'Patricia', 'Miguel', 'Camille', 'Paolo', 'Bea', 'Joshua', 'Nicole', 'Christian', 'Erika',
    'Ramon', 'Liza', 'Jerome', 'Shiela', 'Arnel', 'Rowena', 'Kevin', 'Michelle', 'Dennis', 'Joy',
    'Rafael', 'Grace', 'Noel', 'Princess', 'Gabriel', 'Lovely', 'Vincent', 'Hazel', 'Ronaldo', 'Mae'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Villanueva', 'Ramos',
    'Aquino', 'Castillo', 'Dela Cruz', 'Gonzales', 'Flores', 'Navarro', 'Lim', 'Tan', 'Mercado', 'Domingo',
    'Pascual', 'Soriano', 'De Leon', 'Salazar', 'Fernandez', 'Manalo', 'Aguilar', 'Rivera', 'Valdez', 'Robles'];
const MOBILE_PREFIX = ['0917', '0918', '0919', '0920', '0927', '0928', '0939', '0945', '0947', '0955', '0956', '0961', '0966', '0977', '0995', '0998'];

/** About 80 regulars, the same people every run, each with a few products
    they keep coming back for (their pet's food, litter). */
function makeRegulars(seed, products) {
    const rand = rng(seed ^ 0xC0FFEE);
    const food = products.filter(p => /food|kibble|dry|wet|pouch|can|litter/i.test(`${p.name} ${p.category || ''}`));
    const pool2 = food.length >= 10 ? food : products;
    const out = [];
    const seen = new Set();
    while (out.length < 80) {
        const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
        if (seen.has(name)) continue;
        seen.add(name);
        const phone = MOBILE_PREFIX[Math.floor(rand() * MOBILE_PREFIX.length)] + String(Math.floor(rand() * 1e7)).padStart(7, '0');
        const favourites = [];
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n && pool2.length; i++) favourites.push(pool2[Math.floor(rand() * pool2.length)].id);
        out.push({ name, phone, favourites, weight: 0.5 + rand() * 1.5 });
    }
    return out;
}

/* ---------- the shop's state ---------- */
const shopNow = () => new Date(Date.now() + 8 * 3600e3);
const shopToday = () => shopNow().toISOString().slice(0, 10);

async function getSetting(conn, key) {
    const [rows] = await conn.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]);
    return rows.length ? rows[0].setting_value : null;
}
async function setSetting(conn, key, value) {
    await conn.query(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        [key, String(value)]);
}

/** The days to fill: after the last day that has any sale (or the last
    simulated day), up to yesterday, plus today once the shop has closed.
    Days with real sales are left out. */
async function daysToFill(conn, maxDays) {
    const [[row]] = await conn.query(
        "SELECT DATE_FORMAT(MAX(CONVERT_TZ(created_at,'+00:00','+08:00')),'%Y-%m-%d') AS last_day FROM sales");
    const lastSim = await getSetting(conn, 'sim_last_day');
    let from = [row.last_day, lastSim].filter(Boolean).sort().pop();
    if (!from) from = cal.addDays(shopToday(), -31);
    const today = shopToday();
    const end = shopNow().getUTCHours() >= 17 ? today : cal.addDays(today, -1);
    const days = [];
    for (let d = cal.addDays(from, 1); d <= end; d = cal.addDays(d, 1)) days.push(d);
    const recent = days.slice(-maxDays);
    if (!recent.length) return [];
    const [real] = await conn.query(
        `SELECT DISTINCT DATE_FORMAT(CONVERT_TZ(created_at,'+00:00','+08:00'),'%Y-%m-%d') AS d FROM sales
          WHERE sale_number NOT LIKE 'SIM-%' AND created_at >= CONVERT_TZ(?, '+08:00', '+00:00')`, [recent[0] + ' 00:00:00']);
    const taken = new Set(real.map(r => r.d));
    return recent.filter(d => !taken.has(d));
}

async function loadCatalogue(conn) {
    const [products] = await conn.query(
        `SELECT p.id, p.name, p.unit_price, p.stock_quantity, p.reorder_level, p.max_stock_level, p.unit_type,
                DATE_FORMAT(p.expiration_date,'%Y-%m-%d') AS expires, DATE_FORMAT(p.created_at,'%Y-%m-%d') AS added,
                c.name AS category, COALESCE(sold.units, 0) AS units_sold
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN (SELECT si.product_id, SUM(si.quantity) AS units FROM sale_items si
                        JOIN sales s ON s.id = si.sale_id WHERE s.payment_status = 'completed'
                       GROUP BY si.product_id) sold ON sold.product_id = p.id
          WHERE p.is_active = 1 AND p.purged_at IS NULL AND p.unit_price > 0`);
    return products.map(p => ({ ...p, added: p.added || '', unit_price: Number(p.unit_price), units_sold: Number(p.units_sold) }));
}

async function staffIds(conn) {
    const [rows] = await conn.query("SELECT id, role FROM users WHERE is_active = 1 AND role IN ('cashier','admin') ORDER BY id");
    const cashiers = rows.filter(r => r.role === 'cashier').map(r => r.id);
    const admin = rows.find(r => r.role === 'admin');
    if (!admin && !cashiers.length) throw new Error('no active cashier or admin account to record sales under');
    return { cashiers: cashiers.length ? cashiers : [admin.id], admin: admin ? admin.id : cashiers[0] };
}

/* ---------- one day ---------- */
const money = n => Math.round(n * 100) / 100;
const utc = (day, h, m, s) => {
    const t = new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+08:00`);
    return t.toISOString().slice(0, 19).replace('T', ' ');
};

const seasonalWeight = (p, month) => {
    const label = `${p.name} ${p.category || ''}`;
    if (month === 12 && /toy|accessor|collar|leash|bowl|bed|cloth/i.test(label)) return 2;
    if (month >= 3 && month <= 5 && /shampoo|groom|tick|flea|soap/i.test(label)) return 1.3;
    return 1;
};

/** One customer at the counter: what they buy, how they pay. Takes the
    stock it sells out of ctx.stock. Returns the sale, or null if nothing
    they wanted was on the shelf. Writes nothing. */
function planCustomer(ctx, rand, profile, day, saleNumber, createdAt) {
    const { products, regulars, staff, maxDiscount } = ctx;
    const month = Number(day.slice(5, 7));
    const candidates = products.filter(p => p.added <= day && (!p.expires || p.expires >= day) && ctx.stock.get(p.id) >= 1);
    if (!candidates.length) return null;
    const weight = p => (1 + Math.round(p.units_sold / 15)) * seasonalWeight(p, month);
    // About 4 in 10 customers are regulars buying their usual.
    const regular = rand() < 0.4 ? pickWeighted(rand, regulars, r => r.weight) : null;
    const want = rand();
    const lineCount = want < 0.45 ? 1 : want < 0.75 ? 2 : want < 0.90 ? 3 : 4;
    const lines = new Map();
    if (regular) {
        for (const id of regular.favourites) {
            const p = candidates.find(c => c.id === id);
            if (p && rand() < 0.8) lines.set(p.id, p);
        }
    }
    let guard = 0;
    while (lines.size < lineCount && guard++ < 20) {
        const p = pickWeighted(rand, candidates, weight);
        lines.set(p.id, p);
    }
    const items = [];
    for (const p of lines.values()) {
        const q = rand() * (profile.bigBasket > 1 ? 0.8 : 1);
        let qty = q < 0.72 ? 1 : q < 0.92 ? 2 : 3;
        if (profile.bigBasket > 1 && rand() < 0.15) qty += 1; // pay-day stock-up
        qty = Math.min(qty, Math.floor(ctx.stock.get(p.id)));
        if (qty < 1) continue;
        ctx.stock.set(p.id, ctx.stock.get(p.id) - qty);
        items.push({ product_id: p.id, name: p.name, quantity: qty, unit_price: p.unit_price, subtotal: money(qty * p.unit_price) });
    }
    if (!items.length) return null;
    const total = money(items.reduce((a, it) => a + it.subtotal, 0));
    // A few customers get the shop's discount (suki, senior), never more
    // than the POS limit.
    let discount = 0;
    if (rand() < 0.07 && maxDiscount >= 5) discount = maxDiscount >= 10 && rand() < 0.4 ? 10 : 5;
    const final = money(Math.max(0, total - total * discount / 100));
    // Cash still leads at a neighbourhood shop; GCash/Maya are recorded as
    // "online" (the POS has no separate e-wallet value). BSP 2025 and
    // Worldpay 2026 figures, scaled to a small cash-heavy shop (estimate).
    const pr = rand();
    const cashShare = final > 1500 ? 0.45 : 0.60;
    const method = pr < cashShare ? 'cash' : pr < 0.96 ? 'online' : 'card';
    const wallet = method === 'online' ? (rand() < 0.85 ? 'GCash' : 'Maya') : null;
    const named = regular || (rand() < 0.15 ? { name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`, phone: null } : null);
    return {
        sale_number: saleNumber,
        customer_name: named ? named.name : null,
        customer_phone: named ? named.phone : null,
        regular: !!regular,
        total_amount: total, discount, final_amount: final, payment_method: method, wallet,
        notes: `POS sale${wallet ? ' (' + wallet + ')' : ''} ${TAG}`,
        created_by: staff.cashiers[Math.floor(rand() * staff.cashiers.length)],
        created_at: createdAt,
        items,
    };
}

/** Deliveries: every product at or below `threshold(p)` back up to its
    usual full level. A batch expiring within 30 days comes with a new expiry
    date. Changes ctx.stock; writes nothing. */
function planRestocks(ctx, rand, day, threshold, createdAt) {
    const out = [];
    for (const p of ctx.products) {
        const have = ctx.stock.get(p.id);
        const reorder = Number(p.reorder_level) || 10;
        if (p.added > day || have > threshold(p, reorder)) continue;
        const full = Math.max(Number(p.max_stock_level) || 0, reorder * 3);
        const qty = Math.ceil(full - have);
        if (qty <= 0) continue;
        ctx.stock.set(p.id, have + qty);
        let newExpiry = null, oldExpiry = null;
        if (p.expires && p.expires <= cal.addDays(day, 30)) {
            oldExpiry = p.expires;
            newExpiry = cal.addDays(day, 270 + Math.floor(rand() * 270));
            p.expires = newExpiry;
        }
        out.push({ product_id: p.id, name: p.name, quantity: qty, created_at: createdAt(), newExpiry, oldExpiry });
    }
    return out;
}

/** Plans one day's trading against the current stock (`ctx.stock` is
    changed in place). Returns { day, profile, sales, restocks }. Writes nothing. */
function planDay(day, ctx) {
    const { cfg } = ctx;
    const rand = rng(hash(day) ^ cfg.seed);
    const profile = cal.dayProfile(day, rand);
    const plan = { day, profile, sales: [], restocks: [] };
    if (!profile.open) return plan;

    const count = customerCount(rand, cfg.perDay * profile.factor);
    const hours = cal.hourWeights(day, profile.closeHour);
    const times = [];
    for (let i = 0; i < count; i++) {
        const [h] = pickWeighted(rand, hours, x => x[1]);
        times.push([h, Math.floor(rand() * 60), Math.floor(rand() * 60)]);
    }
    times.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));

    for (const [h, m, s] of times) {
        const number = `${SALE_PREFIX}${day.replace(/-/g, '')}-${String(plan.sales.length + 1).padStart(3, '0')}`;
        const sale = planCustomer(ctx, rand, profile, day, number, utc(day, h, m, s));
        if (sale) plan.sales.push(sale);
    }

    // Supplier deliveries on Tuesdays and Fridays: every item at or below its
    // reorder level is brought back up to its usual full level. On other days
    // only items that sold out completely get a rush order, delivered at the
    // end of the day.
    const wd = new Date(day + 'T00:00:00Z').getUTCDay();
    const deliveryDay = wd === 2 || wd === 5;
    plan.restocks = planRestocks(ctx, rand, day, (p, reorder) => (deliveryDay ? reorder : 0),
        () => utc(day, deliveryDay ? 10 : profile.closeHour - 1, Math.floor(rand() * 60), 0));
    return plan;
}

/** Writes planned sales and deliveries in a single transaction. With
    `lastDay`, also records it as the last simulated day. Returns the new
    sale ids by sale number. */
async function writeBatch(conn, { sales = [], restocks = [], adminId, lastDay = null }) {
    await conn.beginTransaction();
    try {
        let idOf = new Map();
        if (sales.length) {
            await conn.query(
                `INSERT INTO sales (sale_number, customer_name, customer_phone, total_amount, discount, final_amount,
                                    payment_method, payment_status, notes, created_by, created_at) VALUES ?`,
                [sales.map(s => [s.sale_number, s.customer_name, s.customer_phone, s.total_amount, s.discount,
                    s.final_amount, s.payment_method, 'completed', s.notes, s.created_by, s.created_at])]);
            const [ids] = await conn.query('SELECT id, sale_number FROM sales WHERE sale_number IN (?)', [sales.map(s => s.sale_number)]);
            idOf = new Map(ids.map(r => [r.sale_number, r.id]));
            const items = [], moves = [];
            for (const s of sales) {
                const id = idOf.get(s.sale_number);
                for (const it of s.items) {
                    items.push([id, it.product_id, it.quantity, it.unit_price, it.subtotal]);
                    moves.push([it.product_id, 'out', -it.quantity, 'sale', id, `${TAG} Sale #${s.sale_number}`, s.created_by, s.created_at]);
                }
            }
            await conn.query('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ?', [items]);
            await conn.query('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at) VALUES ?', [moves]);
        }
        if (restocks.length) {
            await conn.query('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at) VALUES ?',
                [restocks.map(r => [r.product_id, 'in', r.quantity, 'manual', null,
                    `${TAG} Supplier delivery (simulated restock)${r.oldExpiry ? `; expiry was ${r.oldExpiry}, now ${r.newExpiry}` : ''}`, adminId, r.created_at])]);
        }
        // Net stock change per product, applied in one statement.
        const net = new Map();
        for (const s of sales) for (const it of s.items) net.set(it.product_id, (net.get(it.product_id) || 0) - it.quantity);
        for (const r of restocks) net.set(r.product_id, (net.get(r.product_id) || 0) + r.quantity);
        const changes = [...net].filter(([, q]) => q !== 0);
        if (changes.length) {
            await conn.query(
                `UPDATE products SET stock_quantity = GREATEST(0, stock_quantity + CASE id ${changes.map(() => 'WHEN ? THEN ?').join(' ')} END)
                  WHERE id IN (?)`, [...changes.flat(), changes.map(c => c[0])]);
        }
        for (const r of restocks) {
            if (r.newExpiry) await conn.query('UPDATE products SET expiration_date = ? WHERE id = ?', [r.newExpiry, r.product_id]);
        }
        if (lastDay) await setSetting(conn, 'sim_last_day', lastDay);
        await conn.commit();
        return idOf;
    } catch (e) {
        await conn.rollback();
        throw e;
    }
}

/** Everything a run needs to know about the shop, read once. */
async function loadContext(conn) {
    const cfg = settings();
    const products = await loadCatalogue(conn);
    const staff = await staffIds(conn);
    const maxDiscount = maxDiscountFrom(await getSetting(conn, 'pos_max_discount_percent'));
    return {
        products, staff, maxDiscount, cfg,
        regulars: makeRegulars(cfg.seed, products),
        stock: new Map(products.map(p => [p.id, Number(p.stock_quantity) || 0])),
    };
}

/**
 * Runs the simulation.
 * options: { dryRun, backup (default true), log }
 * Returns a summary.
 */
async function run({ dryRun = false, backup = true, log = console.log } = {}) {
    const cfg = settings();
    const conn = await pool.getConnection();
    let locked = false;
    try {
        await conn.query("SET time_zone = '+00:00'");
        const [[l]] = await conn.query('SELECT GET_LOCK(?, 0) AS ok', [LOCK]);
        if (!l.ok) return { skipped: 'another copy of the simulation is running' };
        locked = true;

        const days = await daysToFill(conn, cfg.maxDays);
        if (!days.length) return { skipped: 'nothing to fill: every day up to now already has sales' };

        const ctx = await loadContext(conn);
        if (!ctx.products.length) return { skipped: 'no active products to sell' };
        const staff = ctx.staff;

        let backupInfo = null;
        if (!dryRun && backup) {
            log(`[Simulation] ${days.length} day(s) to fill (${days[0]} to ${days[days.length - 1]}); saving a backup first...`);
            backupInfo = await saveBackupToDisk({ label: 'before-simulation' }); // throws → nothing written
            log(`[Simulation] backup saved: ${backupInfo.file} (${backupInfo.rows} rows)`);
        }

        const summary = { days: [], sales: 0, revenue: 0, restocks: 0, backup: backupInfo && backupInfo.file, dryRun };
        for (const day of days) {
            const plan = planDay(day, ctx);
            if (!dryRun) await writeBatch(conn, { sales: plan.sales, restocks: plan.restocks, adminId: staff.admin, lastDay: day });
            const revenue = money(plan.sales.reduce((a, s) => a + s.final_amount, 0));
            summary.days.push({ day, sales: plan.sales.length, revenue, restocks: plan.restocks.length, notes: plan.profile.reasons.join(', ') });
            summary.sales += plan.sales.length;
            summary.revenue = money(summary.revenue + revenue);
            summary.restocks += plan.restocks.length;
        }
        if (!dryRun) {
            await setSetting(conn, 'sim_last_run_at', new Date().toISOString());
            await setSetting(conn, 'sim_last_result', `${summary.days.length} days, ${summary.sales} sales, PHP ${summary.revenue.toFixed(2)}`);
        }
        return summary;
    } finally {
        if (locked) { try { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]); } catch (e) { /* connection gone */ } }
        conn.release();
    }
}

/** Takes every simulated row out again and puts the stock back. */
async function removeAll({ dryRun = false } = {}) {
    const conn = await pool.getConnection();
    try {
        const [[c]] = await conn.query(
            `SELECT (SELECT COUNT(*) FROM sales WHERE sale_number LIKE 'SIM-%') AS sales,
                    (SELECT COUNT(*) FROM stock_movements WHERE notes LIKE '[SIM]%') AS movements`);
        if (dryRun) return { sales: Number(c.sales), movements: Number(c.movements), dryRun };
        await conn.beginTransaction();
        try {
            const [net] = await conn.query(
                "SELECT product_id, SUM(quantity) AS q FROM stock_movements WHERE notes LIKE '[SIM]%' GROUP BY product_id");
            for (const r of net) {
                await conn.query('UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - ?) WHERE id = ?', [Number(r.q), r.product_id]);
            }
            // Put back the expiry a product had before its first simulated delivery.
            const [renewed] = await conn.query(
                "SELECT product_id, notes FROM stock_movements WHERE notes LIKE '[SIM]%expiry was %' ORDER BY created_at, id");
            const restored = new Set();
            for (const r of renewed) {
                const m = /expiry was (\d{4}-\d{2}-\d{2})/.exec(r.notes);
                if (!m || restored.has(r.product_id)) continue;
                restored.add(r.product_id);
                await conn.query('UPDATE products SET expiration_date = ? WHERE id = ?', [m[1], r.product_id]);
            }
            await conn.query("DELETE FROM stock_movements WHERE notes LIKE '[SIM]%'");
            await conn.query("DELETE si FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.sale_number LIKE 'SIM-%'");
            await conn.query("DELETE FROM sales WHERE sale_number LIKE 'SIM-%'");
            await conn.query("DELETE FROM app_settings WHERE setting_key IN ('sim_last_day','sim_last_run_at','sim_last_result')");
            await conn.commit();
        } catch (e) { await conn.rollback(); throw e; }
        return { sales: Number(c.sales), movements: Number(c.movements) };
    } finally {
        conn.release();
    }
}

/** Called from server.js after the start-up migrations. */
async function runOnStartup() {
    if (!enabled()) { console.log('[Simulation] off (set SIMULATION=on to turn it on)'); return; }
    const r = await run();
    if (r.skipped) { console.log(`[Simulation] ${r.skipped}`); return; }
    console.log(`[Simulation] filled ${r.days.length} day(s): ${r.sales} sales, PHP ${r.revenue.toFixed(2)}, ${r.restocks} restock(s)`);
    // The forecast is cached; rebuild it so Analytics shows the new days.
    try { require('../../routes/predictions').warmAllPredictions(); } catch (e) { /* not loaded */ }
}

module.exports = {
    run, removeAll, runOnStartup, enabled, planDay,
    // used by live.js
    loadContext, planCustomer, planRestocks, writeBatch, money, shopToday, TAG, SALE_PREFIX,
    _test: { rng, hash, customerCount },
};
