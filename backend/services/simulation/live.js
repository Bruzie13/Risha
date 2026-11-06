/* Live (sped-up) sales simulation, for recording the system in use.

   Started from the Simulation screen. After a database backup it rings up
   one simulated customer every 20-60 seconds (faster on a busy day), with
   the time stamped "now", so today's Dashboard, Reports and the monitor fill
   up while you watch. Items that sell out get a rush delivery at once, and
   every 15 minutes a supplier delivery brings low items back up.

   The drawer works like the real till: Start opens each cashier's drawer
   with starting cash (panukli), Pause holds the customers and the clock,
   and End of day counts the cash and closes the drawer, after which that
   cashier cannot sell again until tomorrow (the POS refuses it too).

   Every row is marked like the daily simulation (sale numbers SIM-…-L…,
   [SIM] in the notes), so `node scripts/simulate.js --remove --confirm`
   takes it out too. It stops by itself after the chosen time, when Stop is
   pressed, or when the server stops.

   Settings (optional): SIM_LIVE_MIN_SECONDS (20), SIM_LIVE_MAX_SECONDS (60). */
const pool = require('../../config/database');
const { saveBackupToDisk } = require('../../utils/backup');
const cal = require('./calendar');
const sim = require('./index');
const { _cashierDrawer: cashierDrawer } = require('../../controllers/saleController');
const { discrepancy } = require('../../utils/till');

const EVENT_LIMIT = 200;
const DELIVERY_EVERY_MS = 15 * 60 * 1000;
const CATALOGUE_REFRESH_MS = 10 * 60 * 1000;

const state = {
    phase: 'idle',          // idle | backing-up | running | paused | stopped | closed | failed
    startedAt: null, endsAt: null, nextAt: null,
    remainingMs: null,      // while paused: time left on the clock
    cashiers: [],           // { id, name } of the drawers this run sells from
    startedBy: null,
    sales: 0, revenue: 0, items: 0, deliveries: 0,
    backup: null, error: null,
    events: [], seq: 0,
};
let timer = null, ctx = null, lastDelivery = 0, lastCatalogue = 0, busy = false;

const pace = () => ({
    min: Number(process.env.SIM_LIVE_MIN_SECONDS) || 20,
    max: Number(process.env.SIM_LIVE_MAX_SECONDS) || 60,
});

function push(type, data) {
    state.seq += 1;
    state.events.push({ id: state.seq, type, at: new Date().toISOString(), ...data });
    if (state.events.length > EVENT_LIMIT) state.events.splice(0, state.events.length - EVENT_LIMIT);
}

const nowUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const profileToday = () => {
    const day = sim.shopToday();
    const seed = Number(process.env.SIM_SEED) || 20261105;
    return { day, ...cal.dayProfile(day, sim._test.rng(sim._test.hash(day) ^ seed)) };
};

/** Seconds until the next customer: quicker on a busy day (payday,
    December), slower on a quiet one, never outside the set range. */
function nextDelay() {
    const { min, max } = pace();
    const p = profileToday();
    const factor = p.open ? Math.max(0.5, Math.min(1.6, p.factor)) : 1;
    const mid = min + Math.random() * (max - min);
    return Math.round(Math.max(min, Math.min(max, mid / factor)) * 1000);
}

function schedule() {
    clearTimeout(timer);
    if (state.phase !== 'running') return;
    if (state.endsAt && Date.now() >= Date.parse(state.endsAt)) return stop('time is up');
    const wait = nextDelay();
    state.nextAt = new Date(Date.now() + wait).toISOString();
    timer = setTimeout(tick, wait);
}

async function tick() {
    if (busy || state.phase !== 'running') return;
    busy = true;
    const conn = await pool.getConnection().catch(e => { push('error', { message: 'Database not reachable: ' + e.message }); return null; });
    try {
        if (!conn) return;
        await conn.query("SET time_zone = '+00:00'");
        if (!ctx || Date.now() - lastCatalogue > CATALOGUE_REFRESH_MS) {
            ctx = await sim.loadContext(conn);
            lastCatalogue = Date.now();
            if (state.cashiers.length) ctx.staff.cashiers = state.cashiers.map(c => c.id);
        }
        const day = sim.shopToday();
        const profile = profileToday();
        const number = `${sim.SALE_PREFIX}${day.replace(/-/g, '')}-L${Date.now().toString(36).toUpperCase()}`;
        const sale = sim.planCustomer(ctx, Math.random, profile, day, number, nowUtc());

        // Rush delivery for anything that just sold out; every 15 minutes a
        // supplier delivery for everything at or below its reorder level.
        const due = Date.now() - lastDelivery >= DELIVERY_EVERY_MS;
        const restocks = sim.planRestocks(ctx, Math.random, day, (p, reorder) => (due ? reorder : 0), nowUtc);
        if (due) lastDelivery = Date.now();

        const ids = await sim.writeBatch(conn, { sales: sale ? [sale] : [], restocks, adminId: ctx.staff.admin });
        if (sale) {
            state.sales += 1;
            state.revenue = sim.money(state.revenue + sale.final_amount);
            state.items += sale.items.reduce((a, it) => a + it.quantity, 0);
            push('sale', {
                sale_id: ids.get(sale.sale_number), sale_number: sale.sale_number,
                customer: sale.customer_name, regular: sale.regular,
                method: sale.payment_method, wallet: sale.wallet,
                total: sale.final_amount, discount: sale.discount,
                items: sale.items.map(it => ({ name: it.name, quantity: it.quantity, subtotal: it.subtotal })),
            });
        } else {
            push('walkout', { message: 'A customer left without buying: what they wanted was out of stock' });
        }
        if (restocks.length) {
            state.deliveries += 1;
            push('delivery', {
                rush: !due,
                items: restocks.map(r => ({ name: r.name, quantity: r.quantity })),
            });
        }
    } catch (e) {
        push('error', { message: 'A simulated sale could not be saved: ' + e.message });
        ctx = null; // re-read stock next time
    } finally {
        if (conn) conn.release();
        busy = false;
        schedule();
    }
}

/** Starts a live run of `minutes` (default 120). Saves a backup first. */
async function start({ minutes = 120, user = null } = {}) {
    if (state.phase === 'running' || state.phase === 'backing-up') return { ok: false, message: 'The simulation is already running.' };
    if (state.phase === 'paused') return { ok: false, message: 'The simulation is paused. Press Resume to carry on.' };
    if (!sim.liveEnabled()) return { ok: false, message: 'The simulation is switched off on this server (SIMULATION=off).' };
    const mins = Math.max(5, Math.min(240, Math.round(Number(minutes) || 120)));
    // Every drawer already counted today: refuse at once, before any backup.
    if (!(await cashiersStillOpenToday()).length) {
        state.phase = 'closed';
        return { ok: false, message: "Today's drawer is already counted and closed, so the cashier cannot sell again until tomorrow." };
    }
    Object.assign(state, {
        phase: 'backing-up', startedAt: null, endsAt: null, nextAt: null, startedBy: user,
        sales: 0, revenue: 0, items: 0, deliveries: 0, backup: null, error: null,
    });
    push('status', { message: 'Saving a backup of the database before the first sale…' });
    try {
        const b = await saveBackupToDisk({ label: 'before-live-simulation' });
        state.backup = { file: b.file.split(/[\\/]/).pop(), rows: b.rows };
        const where = process.env.NODE_ENV === 'production'
            ? ' on the live server (kept until the site restarts; the daily backup email keeps a copy too)'
            : ' to the backups folder';
        push('status', { message: `Backup saved${where} (${b.rows.toLocaleString('en-PH')} rows). The shop is open.` });
    } catch (e) {
        state.phase = 'failed';
        state.error = 'The backup failed, so no sales were made: ' + e.message;
        push('error', { message: state.error });
        return { ok: false, message: state.error };
    }
    // Open the drawers: each cashier starts with change (panukli). A drawer
    // already counted today is closed, and that cashier cannot sell today.
    try {
        state.cashiers = await openDrawers();
    } catch (e) {
        state.phase = 'failed';
        state.error = 'The drawer could not be opened: ' + e.message;
        push('error', { message: state.error });
        return { ok: false, message: state.error };
    }
    if (!state.cashiers.length) {
        state.phase = 'closed';
        const msg = "Today's drawer is already counted and closed, so the cashier cannot sell again until tomorrow.";
        push('status', { message: msg });
        return { ok: false, message: msg };
    }
    ctx = null;
    lastDelivery = Date.now();
    state.phase = 'running';
    state.startedAt = new Date().toISOString();
    state.endsAt = new Date(Date.now() + mins * 60e3).toISOString();
    console.log(`[Simulation] live run started for ${mins} min`);
    // First customer within a few seconds, so the screen comes alive at once.
    clearTimeout(timer);
    state.nextAt = new Date(Date.now() + 3000).toISOString();
    timer = setTimeout(tick, 3000);
    return { ok: true };
}

function stop(reason = 'stopped') {
    clearTimeout(timer);
    timer = null;
    if (!['running', 'backing-up', 'paused'].includes(state.phase)) return { ok: false, message: 'The simulation is not running.' };
    state.phase = 'stopped';
    state.nextAt = null;
    state.remainingMs = null;
    push('status', { message: reason === 'time is up' ? 'Time is up. The live simulation has stopped.' : 'The live simulation was stopped.' });
    console.log(`[Simulation] live run ${reason}: ${state.sales} sales, PHP ${state.revenue.toFixed(2)}`);
    return { ok: true };
}

/** Pause: no customers come in and the clock stops until Resume. */
function pause() {
    if (state.phase !== 'running') return { ok: false, message: 'The simulation is not running.' };
    clearTimeout(timer);
    timer = null;
    state.remainingMs = Math.max(0, Date.parse(state.endsAt) - Date.now());
    state.phase = 'paused';
    state.endsAt = null;
    state.nextAt = null;
    push('status', { message: `Paused with ${Math.ceil(state.remainingMs / 60000)} min left. No customers come in until you press Resume.` });
    return { ok: true };
}

function resume() {
    if (state.phase !== 'paused') return { ok: false, message: 'The simulation is not paused.' };
    state.phase = 'running';
    state.endsAt = new Date(Date.now() + (state.remainingMs || 0)).toISOString();
    state.remainingMs = null;
    push('status', { message: 'Resumed. The shop is open again.' });
    clearTimeout(timer);
    state.nextAt = new Date(Date.now() + 3000).toISOString();
    timer = setTimeout(tick, 3000);
    return { ok: true };
}

/** The cashiers who sell, with their names. */
async function activeCashiers(conn) {
    const [rows] = await conn.query("SELECT id, COALESCE(NULLIF(full_name, ''), username) AS name FROM users WHERE is_active = 1 AND role = 'cashier' ORDER BY id");
    return rows.map(r => ({ id: r.id, name: r.name }));
}

/** Active cashiers whose drawer is not counted yet today. */
async function cashiersStillOpenToday() {
    const conn = await pool.getConnection();
    try {
        const day = sim.shopToday();
        const out = [];
        for (const c of await activeCashiers(conn)) {
            const [counted] = await conn.query('SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [day, c.id]);
            if (!counted.length) out.push(c);
        }
        return out;
    } finally { conn.release(); }
}

/** Opens today's drawer for every cashier that has not counted theirs yet.
    Returns the cashiers whose drawer is open. */
async function openDrawers() {
    const conn = await pool.getConnection();
    try {
        const day = sim.shopToday();
        const open = [];
        for (const c of await activeCashiers(conn)) {
            const [counted] = await conn.query('SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [day, c.id]);
            if (counted.length) { push('status', { message: `${c.name}'s drawer is already counted and closed for today.` }); continue; }
            const amount = sim.openingCash(Math.random);
            const [r] = await conn.query('INSERT IGNORE INTO till_openings (business_date, cashier_id, opening_cash) VALUES (?, ?, ?)', [day, c.id, amount]);
            if (r.affectedRows) {
                await rememberOpening(conn, day, c.id);
                push('drawer', { cashier: c.name, opening: amount, message: `${c.name} opened the drawer with ₱${amount.toLocaleString('en-PH')} starting cash.` });
            } else {
                const [[o]] = await conn.query('SELECT opening_cash FROM till_openings WHERE business_date = ? AND cashier_id = ?', [day, c.id]);
                push('drawer', { cashier: c.name, opening: Number(o.opening_cash), message: `${c.name}'s drawer is already open with ₱${Number(o.opening_cash).toLocaleString('en-PH')} starting cash.` });
            }
            open.push(c);
        }
        return open;
    } finally { conn.release(); }
}

/** till_openings has no notes column, so the drawers this simulation opened
    are listed in app_settings for --remove to find. */
async function rememberOpening(conn, day, cashierId) {
    const [rows] = await conn.query("SELECT setting_value FROM app_settings WHERE setting_key = 'sim_live_openings'");
    let list = [];
    try { list = JSON.parse(rows.length ? rows[0].setting_value : '[]') || []; } catch (e) { list = []; }
    list.push({ day, cashier: cashierId });
    await conn.query(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES ('sim_live_openings', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [JSON.stringify(list.slice(-400))]);
}

/** End of day: the run stops, each open drawer is counted and closed. */
async function endDay() {
    if (state.phase === 'backing-up') return { ok: false, message: 'Wait for the backup to finish.' };
    clearTimeout(timer);
    timer = null;
    const conn = await pool.getConnection();
    try {
        const day = sim.shopToday();
        const results = [];
        for (const c of await activeCashiers(conn)) {
            const [counted] = await conn.query('SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [day, c.id]);
            if (counted.length) continue;
            const [opened] = await conn.query('SELECT 1 FROM till_openings WHERE business_date = ? AND cashier_id = ?', [day, c.id]);
            if (!opened.length) continue;   // this cashier did not open a drawer today
            const d = await cashierDrawer(conn, c.id, day);
            const countedCash = sim.countedCash(Math.random, d.expected);
            const diff = discrepancy(countedCash, d.expected);
            await conn.query(
                `INSERT IGNORE INTO cash_reconciliations (business_date, expected_cash, counted_cash, discrepancy, notes, counted_by, opening_cash, cash_in, cash_out)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [day, d.expected, countedCash, diff, sim.countNote(diff), c.id, d.opening_cash, d.cash_in, d.cash_out]);
            const r = { cashier: c.name, opening: d.opening_cash, cash_sales: sim.money(d.expected - d.opening_cash - d.cash_in + d.cash_out),
                cash_in: d.cash_in, cash_out: d.cash_out, expected: d.expected, counted: countedCash, discrepancy: diff, transactions: d.transactions };
            results.push(r);
            push('eod', r);
        }
        if (!results.length) return { ok: false, message: 'No open drawer to count: press Run first, or today is already counted.' };
        state.phase = 'closed';
        state.nextAt = null;
        state.endsAt = null;
        state.remainingMs = null;
        todayCache.at = 0;
        push('status', { message: 'End of day: the drawer is counted and closed. The cashier can sell again tomorrow.' });
        console.log(`[Simulation] end of day: ${results.length} drawer(s) counted`);
        return { ok: true, results };
    } finally { conn.release(); }
}

/* Today's figures for the whole shop (real and simulated), read at most
   every 4 seconds however many screens are watching. */
let todayCache = { at: 0, data: null };
async function todaySummary() {
    if (Date.now() - todayCache.at < 4000 && todayCache.data) return todayCache.data;
    const day = sim.shopToday();
    const from = `${day} 00:00:00`;
    const range = "s.created_at >= CONVERT_TZ(?, '+08:00', '+00:00') AND s.created_at < CONVERT_TZ(?, '+08:00', '+00:00') + INTERVAL 1 DAY AND s.payment_status <> 'voided'";
    const [[totals]] = await pool.query(
        `SELECT COUNT(*) AS sales, COALESCE(SUM(s.final_amount),0) AS revenue,
                SUM(s.sale_number LIKE 'SIM-%') AS simulated,
                SUM(s.payment_method = 'cash') AS cash, SUM(s.payment_method = 'online') AS online, SUM(s.payment_method = 'card') AS card
           FROM sales s WHERE ${range}`, [from, from]);
    const [[units]] = await pool.query(
        `SELECT COALESCE(SUM(si.quantity),0) AS units FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${range}`, [from, from]);
    const [hours] = await pool.query(
        `SELECT HOUR(CONVERT_TZ(s.created_at,'+00:00','+08:00')) AS h, COUNT(*) AS n, SUM(s.final_amount) AS amount
           FROM sales s WHERE ${range} GROUP BY h ORDER BY h`, [from, from]);
    const [top] = await pool.query(
        `SELECT p.name, SUM(si.quantity) AS units, SUM(si.subtotal) AS amount
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
          WHERE ${range} GROUP BY p.id, p.name ORDER BY units DESC LIMIT 5`, [from, from]);
    const [[stock]] = await pool.query(
        `SELECT SUM(stock_quantity <= 0) AS out_of_stock, SUM(stock_quantity > 0 AND stock_quantity <= reorder_level) AS low
           FROM products WHERE is_active = 1 AND purged_at IS NULL`);
    const n = v => Number(v) || 0;
    const data = {
        day,
        sales: n(totals.sales), revenue: n(totals.revenue), simulated: n(totals.simulated), units: n(units.units),
        payment: { cash: n(totals.cash), online: n(totals.online), card: n(totals.card) },
        byHour: hours.map(r => ({ hour: n(r.h), sales: n(r.n), amount: n(r.amount) })),
        top: top.map(r => ({ name: r.name, units: n(r.units), amount: n(r.amount) })),
        stock: { out: n(stock.out_of_stock), low: n(stock.low) },
        drawers: await drawersToday(day),
    };
    todayCache = { at: Date.now(), data };
    return data;
}

/** Each cashier's drawer today: starting cash, cash sales, what it should
    hold, and the count once it is closed. */
async function drawersToday(day) {
    const conn = await pool.getConnection();
    try {
        const out = [];
        for (const c of await activeCashiers(conn)) {
            const d = await cashierDrawer(conn, c.id, day);
            const [rec] = await conn.query('SELECT counted_cash, discrepancy FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [day, c.id]);
            if (!d.opening_set && !rec.length && !d.transactions) continue;
            out.push({
                cashier: c.name, opened: d.opening_set, opening: d.opening_cash, expected: d.expected,
                cash_sales: sim.money(d.expected - d.opening_cash - d.cash_in + d.cash_out),
                closed: rec.length > 0, counted: rec.length ? Number(rec[0].counted_cash) : null,
                discrepancy: rec.length ? Number(rec[0].discrepancy) : null,
            });
        }
        return out;
    } finally { conn.release(); }
}

/** What the monitor shows. `after` = the last event id the screen has. */
async function snapshot(after = 0) {
    const p = profileToday();
    return {
        phase: state.phase, startedAt: state.startedAt, endsAt: state.endsAt, nextAt: state.nextAt, remainingMs: state.remainingMs,
        now: new Date().toISOString(),
        run: { sales: state.sales, revenue: state.revenue, items: state.items, deliveries: state.deliveries },
        backup: state.backup, error: state.error, enabled: sim.liveEnabled(), pace: pace(),
        dayProfile: { day: p.day, open: p.open, factor: Math.round(p.factor * 100) / 100, reasons: p.reasons },
        events: state.events.filter(e => e.id > after),
        lastEventId: state.seq,
        today: await todaySummary(),
    };
}

module.exports = { start, stop, pause, resume, endDay, snapshot, state };
