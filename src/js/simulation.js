/* Live shop simulation screen (Option A, "counter feed").

   Everything shown comes from /api/simulation/live, polled every 2 seconds.
   The server does the selling (backend/services/simulation/live.js); this
   page only starts and stops it and shows what happens. */

const SIM_API = `${API_BASE}/simulation/live`;
const POLL_MS = 2000;
const FEED_LIMIT = 40;

let lastEventId = 0;
let latest = null;
let pollTimer = null;
let firstLoad = true;   // cards already there when the page opens do not slide in

const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n, one, many) => `${Number(n).toLocaleString('en-PH')} ${n === 1 ? one : many}`;
const clock = iso => new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Manila' });
const $ = id => document.getElementById(id);

window.addEventListener('load', () => {
    if (!isAuthenticated()) { window.location.href = 'login.html'; return; }
    $('simStart').addEventListener('click', () => start());
    $('simRun').addEventListener('click', () => start(120));
    $('simStop').addEventListener('click', stop);
    $('simPause').addEventListener('click', () => post('pause', 'Could not pause'));
    $('simResume').addEventListener('click', () => post('resume', 'Could not resume'));
    $('simEndDay').addEventListener('click', endDay);
    poll();
    setInterval(tickClock, 1000);
});

async function poll() {
    clearTimeout(pollTimer);
    try {
        const res = await fetch(`${SIM_API}?after=${lastEventId}`, { headers: getAuthHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.message || 'The simulation status could not be read.');
        render(body.data);
        $('simFoot').textContent = '';
    } catch (e) {
        $('simFoot').textContent = e.message + ' Trying again…';
    }
    pollTimer = setTimeout(poll, document.hidden ? POLL_MS * 3 : POLL_MS);
}

async function start(minutes) {
    const btn = $('simStart');
    const big = $('simRun');
    const mins = Number(minutes) || Number($('simMinutes').value);
    btn.disabled = true;
    btn.textContent = 'Saving a backup…';
    big.disabled = true;
    big.querySelector('.sim-run-label').textContent = 'Saving a backup…';
    try {
        const res = await fetch(`${SIM_API}/start`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ minutes: mins })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) showErrorDialog('Could not start the simulation', body.message || 'Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Start';
        big.disabled = false;
        big.querySelector('.sim-run-label').textContent = 'Run simulation';
        poll();
    }
}

function stop() {
    showConfirmDialog('Stop the simulation?',
        'No more simulated customers will come in. The sales already made stay saved (marked SIM).',
        async () => {
            const res = await fetch(`${SIM_API}/stop`, { method: 'POST', headers: getAuthHeaders() });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.success) showErrorDialog('Could not stop the simulation', body.message || 'Please try again.');
            poll();
        }, 'Stop', 'stop_circle');
}

async function post(action, failTitle) {
    const res = await fetch(`${SIM_API}/${action}`, { method: 'POST', headers: getAuthHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) showErrorDialog(failTitle, body.message || 'Please try again.');
    poll();
    return body;
}

function endDay() {
    const names = (latest && latest.today.drawers || []).filter(x => x.opened && !x.closed).map(x => x.cashier);
    showConfirmDialog('End of day: count and close the drawer?',
        `The simulation stops, the cash in the drawer is counted and the drawer is closed${names.length ? ' for ' + names.join(', ') : ''}. ` +
        'After this the cashier cannot sell again today, on the real POS too, until tomorrow.',
        () => post('end-day', 'Could not count the drawer'), 'Count and close', 'point_of_sale');
}

function render(d) {
    latest = d;
    const running = d.phase === 'running' || d.phase === 'backing-up';
    const paused = d.phase === 'paused';
    const drawers = d.today.drawers || [];
    const openDrawer = drawers.some(x => x.opened && !x.closed);
    const allClosed = drawers.length > 0 && drawers.every(x => x.closed);
    $('simLive').hidden = !running && !paused;
    $('simLive').classList.toggle('is-paused', paused);
    $('simStop').hidden = !running && !paused;
    $('simPause').hidden = d.phase !== 'running';
    $('simResume').hidden = !paused;
    $('simEndDay').hidden = !openDrawer || d.phase === 'backing-up';
    $('simStartControls').hidden = running || paused || !d.enabled || allClosed;
    $('simRunPanel').hidden = running || paused || !d.enabled || allClosed;
    renderDrawer(drawers);

    const day = new Date(d.dayProfile.day + 'T00:00:00+08:00');
    const dateText = day.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
    $('simDate').textContent = `${dateText} · a customer every ${d.pace.min}–${d.pace.max} seconds while it runs`;
    const reasons = d.dayProfile.reasons.length ? d.dayProfile.reasons.join(' · ') : 'Ordinary ' + day.toLocaleDateString('en-PH', { weekday: 'long', timeZone: 'Asia/Manila' });
    $('simDay').hidden = false;
    $('simDay').textContent = reasons.charAt(0).toUpperCase() + reasons.slice(1);
    $('simDay').title = 'What kind of day the simulation thinks it is: paydays, weekends, holidays, rain and the season make the shop busier or quieter.';

    for (const e of d.events) addEvent(e);
    firstLoad = false;
    if (d.events.length) lastEventId = d.lastEventId;
    if (!$('simFeed').children.length) emptyFeed(d);

    const t = d.today;
    $('kRevenue').textContent = peso(t.revenue);
    $('kRevenueSub').textContent = `from ${plural(t.sales, 'customer', 'customers')} · ${plural(t.units, 'item', 'items')} sold`;
    $('kCash').textContent = plural(t.payment.cash, 'sale', 'sales');
    $('kOnline').textContent = plural(t.payment.online, 'sale', 'sales');
    $('kLow').textContent = `${t.stock.low} low`;
    $('kOut').textContent = t.stock.out ? `${t.stock.out} out of stock` : 'none out of stock';
    $('kDeliveries').textContent = plural(d.run.deliveries, 'delivery', 'deliveries');
    $('simTodayNote').textContent = `${plural(t.simulated, 'simulated sale', 'simulated sales')} of ${plural(t.sales, 'sale', 'sales')} today`;
    renderBars(t.byHour);
    renderTop(t.top);
    if (!d.enabled) $('simFoot').textContent = 'The simulation is switched off on this server.';
    tickClock();
}

function tickClock() {
    if (!latest) return;
    const running = latest.phase === 'running';
    if (latest.phase === 'backing-up') {
        $('simLiveText').textContent = 'SAVING A BACKUP';
        $('simNext').textContent = 'The first customer comes in after the backup';
        return;
    }
    if (latest.phase === 'paused') {
        const mins = Math.ceil((latest.remainingMs || 0) / 60000);
        $('simLiveText').textContent = `PAUSED · ${mins} min left`;
        $('simNext').textContent = 'No customers until you press Resume';
        return;
    }
    if (!running) {
        $('simNext').textContent = latest.phase === 'stopped' ? `Stopped · ${plural(latest.run.sales, 'sale', 'sales')} this run`
            : latest.phase === 'closed' ? 'Drawer counted and closed for today' : '';
        return;
    }
    const left = Math.max(0, Date.parse(latest.endsAt) - Date.now());
    const mins = Math.ceil(left / 60000);
    $('simLiveText').textContent = `LIVE · ${mins} min left`;
    const next = latest.nextAt ? Math.max(0, Math.round((Date.parse(latest.nextAt) - Date.now()) / 1000)) : null;
    $('simNext').textContent = next == null ? '' : next > 0 ? `Next customer in ${next} s` : 'A customer is at the counter…';
}

function emptyFeed(d) {
    const box = $('simFeed');
    box.innerHTML = `<div class="sim-empty">
        <span class="material-symbols-outlined">storefront</span>
        <strong>${d.enabled ? 'The shop is quiet' : 'The simulation is off on this server'}</strong>
        <p>${d.enabled ? 'A backup of the database is saved first, then a simulated customer comes to the counter every ' + d.pace.min + '–' + d.pace.max + ' seconds. Each sale is saved as today’s sale, marked SIM, and shows on the Dashboard and Reports too.' : 'It was switched off with SIMULATION=off on this server.'}</p>
    </div>`;
}

function addEvent(e) {
    const box = $('simFeed');
    const empty = box.querySelector('.sim-empty');
    if (empty) empty.remove();
    const el = document.createElement('div');
    el.className = firstLoad ? 'sim-card' : 'sim-card sim-card-new';
    const time = `<div class="sim-time">${clock(e.at)}</div>`;
    if (e.type === 'sale') {
        const who = e.customer ? escHtml(e.customer) : 'Walk-in customer';
        const tag = e.regular ? '<span class="sim-tag">regular</span>' : '';
        const items = e.items.map(i => `${i.quantity} × ${escHtml(i.name)}`).join(' · ');
        const pay = e.method === 'cash' ? 'Cash' : e.method === 'card' ? 'Card' : (e.wallet || 'GCash');
        const disc = e.discount ? `<span class="sim-disc">${e.discount}% discount</span>` : '';
        el.innerHTML = `${time}<div><div class="sim-who">${who} ${tag}</div><div class="sim-items">${items}</div>
            <span class="sim-pay sim-pay-${e.method}">${pay}</span>${disc}</div><div class="sim-amt" title="Amount paid">${peso(e.total)}</div>`;
    } else if (e.type === 'drawer') {
        el.classList.add('sim-card-drawer');
        el.innerHTML = `${time}<div><div class="sim-who"><span class="material-symbols-outlined">point_of_sale</span> Drawer opened</div>
            <div class="sim-items">${escHtml(e.message || '')}</div></div><div class="sim-amt sim-amt-in" title="Starting cash">${peso(e.opening)} starting cash</div>`;
    } else if (e.type === 'eod') {
        el.classList.add('sim-card-eod');
        const diff = Number(e.discrepancy) || 0;
        const verdict = diff === 0 ? 'Balanced' : diff < 0 ? `Short ${peso(-diff)}` : `Over ${peso(diff)}`;
        el.innerHTML = `${time}<div><div class="sim-who"><span class="material-symbols-outlined">lock</span> End of day: ${escHtml(e.cashier)} counted and closed the drawer</div>
            <div class="sim-items">Starting cash ${peso(e.opening)} + cash sales ${peso(e.cash_sales)}${e.cash_in ? ' + cash put in ' + peso(e.cash_in) : ''}${e.cash_out ? ' − cash taken out ' + peso(e.cash_out) : ''} = should hold ${peso(e.expected)} · counted ${peso(e.counted)}</div>
            <span class="sim-pay ${diff === 0 ? 'sim-pay-cash' : 'sim-pay-card'}">${verdict}</span></div><div class="sim-amt" title="Cash counted">${peso(e.counted)} counted</div>`;
    } else if (e.type === 'delivery') {
        el.classList.add('sim-card-delivery');
        const list = e.items.map(i => `${escHtml(i.name)} +${i.quantity}`).join(' · ');
        const pieces = e.items.reduce((a, i) => a + i.quantity, 0);
        el.innerHTML = `${time}<div><div class="sim-who"><span class="material-symbols-outlined">local_shipping</span> ${e.rush ? 'Rush delivery arrived' : 'Supplier delivery arrived'}</div>
            <div class="sim-items">${e.rush ? 'Sold out, back on the shelf: ' : 'Low items topped up: '}${list}</div></div><div class="sim-amt sim-amt-in">+${plural(pieces, 'piece', 'pieces')} in stock</div>`;
    } else {
        el.classList.add(e.type === 'error' ? 'sim-card-error' : 'sim-card-note');
        el.innerHTML = `${time}<div class="sim-note">${escHtml(e.message || '')}</div>`;
    }
    box.prepend(el);
    while (box.children.length > FEED_LIMIT) box.lastElementChild.remove();
}

function renderBars(byHour) {
    const hours = byHour.map(h => h.hour);
    const from = Math.min(6, ...hours), to = Math.max(16, ...hours);
    const nowHour = Number(new Date().toLocaleString('en-PH', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' })) % 24;
    const by = new Map(byHour.map(h => [h.hour, h.sales]));
    const max = Math.max(1, ...byHour.map(h => h.sales));
    const bars = [];
    for (let h = from; h <= to; h++) {
        const n = by.get(h) || 0;
        bars.push(`<div class="sim-bar${h === nowHour ? ' sim-bar-now' : ''}" style="height:${Math.round(n / max * 100)}%" title="${hourName(h)}: ${plural(n, 'customer', 'customers')}"></div>`);
    }
    $('simBars').innerHTML = bars.join('');
    $('simHours').innerHTML = `<span>${hourName(from)}</span><span>${hourName(Math.round((from + to) / 2))}</span><span>${hourName(to)}</span>`;
    // Numbers in words under the chart, not bare on the bars.
    const busiest = byHour.reduce((a, b) => (b.sales > (a ? a.sales : 0) ? b : a), null);
    const thisHour = by.get(nowHour) || 0;
    $('simHourNote').textContent = busiest
        ? `Busiest hour: ${hourName(busiest.hour)}, ${plural(busiest.sales, 'customer', 'customers')} · this hour (red): ${plural(thisHour, 'customer', 'customers')}`
        : 'No customers yet today';
}

/** The drawer card: starting cash, cash sales, what it should hold, and the count once closed. */
function renderDrawer(drawers) {
    const box = $('kDrawer');
    if (!drawers.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = drawers.map(x => {
        const status = x.closed ? 'Counted and closed' : x.opened ? 'Open' : 'Not opened yet';
        const diff = Number(x.discrepancy) || 0;
        const count = x.closed ? ` · counted ${peso(x.counted)}${diff === 0 ? ', balanced' : diff < 0 ? ', short ' + peso(-diff) : ', over ' + peso(diff)}` : '';
        return `<div class="sim-drawer-row"><div class="sim-lbl">Cash drawer · ${escHtml(x.cashier)} · <b>${status}</b></div>
            <div class="sim-num">${peso(x.expected)} <span class="sim-drawer-sub">should be in the drawer</span></div>
            <div class="sim-lbl">${peso(x.opening)} starting cash + ${peso(x.cash_sales)} cash sales${count}</div></div>`;
    }).join('');
}

const hourName = h => (h === 0 ? '12 MN' : h === 12 ? '12 NN' : h < 12 ? `${h} AM` : `${h - 12} PM`);

function renderTop(top) {
    $('simTop').innerHTML = top.length
        ? top.map(t => `<div><span>${escHtml(t.name)}</span><b>${Number(t.units).toLocaleString('en-PH')} sold</b></div>`).join('')
        : '<div class="sim-muted-row">Nothing sold yet today</div>';
}
