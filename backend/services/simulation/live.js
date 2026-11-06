/* Live (sped-up) sales simulation, for recording the system in use.

   Started from the Simulation screen. After a database backup it rings up
   one simulated customer every 20-60 seconds (faster on a busy day), with
   the time stamped "now", so today's Dashboard, Reports and the monitor fill
   up while you watch. Items that sell out get a rush delivery at once, and
   every 15 minutes a supplier delivery brings low items back up.

   Every row is marked like the daily simulation (sale numbers SIM-…-L…,
   [SIM] in the notes), so `node scripts/simulate.js --remove --confirm`
   takes it out too. It stops by itself after the chosen time, when Stop is
   pressed, or when the server stops.

   Settings (optional): SIM_LIVE_MIN_SECONDS (20), SIM_LIVE_MAX_SECONDS (60). */
const pool = require('../../config/database');
const { saveBackupToDisk } = require('../../utils/backup');
const cal = require('./calendar');
const sim = require('./index');

const EVENT_LIMIT = 200;
const DELIVERY_EVERY_MS = 15 * 60 * 1000;
const CATALOGUE_REFRESH_MS = 10 * 60 * 1000;

const state = {
    phase: 'idle',          // idle | backing-up | running | stopped | failed
    startedAt: null, endsAt: null, nextAt: null,
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
    if (!sim.liveEnabled()) return { ok: false, message: 'The simulation is switched off on this server (SIMULATION=off).' };
    const mins = Math.max(5, Math.min(240, Math.round(Number(minutes) || 120)));
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
    if (state.phase !== 'running' && state.phase !== 'backing-up') return { ok: false, message: 'The simulation is not running.' };
    state.phase = 'stopped';
    state.nextAt = null;
    push('status', { message: reason === 'time is up' ? 'Time is up. The live simulation has stopped.' : 'The live simulation was stopped.' });
    console.log(`[Simulation] live run ${reason}: ${state.sales} sales, PHP ${state.revenue.toFixed(2)}`);
    return { ok: true };
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
    };
    todayCache = { at: Date.now(), data };
    return data;
}

/** What the monitor shows. `after` = the last event id the screen has. */
async function snapshot(after = 0) {
    const p = profileToday();
    return {
        phase: state.phase, startedAt: state.startedAt, endsAt: state.endsAt, nextAt: state.nextAt,
        now: new Date().toISOString(),
        run: { sales: state.sales, revenue: state.revenue, items: state.items, deliveries: state.deliveries },
        backup: state.backup, error: state.error, enabled: sim.liveEnabled(), pace: pace(),
        dayProfile: { day: p.day, open: p.open, factor: Math.round(p.factor * 100) / 100, reasons: p.reasons },
        events: state.events.filter(e => e.id > after),
        lastEventId: state.seq,
        today: await todaySummary(),
    };
}

module.exports = { start, stop, snapshot, state };
