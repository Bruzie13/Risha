/* Comparing the suppliers of one product (Carlo, 14 Nov: the same product from
   two suppliers, to see who delivers faster and whose batches last longer;
   mock-up Option B, one table with the better supplier in each row).

   rows: [{ supplier_id, name, is_main, cost, average_days, on_time_percent,
            delivered, stars, shelf_days, last_expiry }]
     average_days, on_time_percent, delivered, stars: from the supplier's
       received orders of the last 12 months (utils/supply.js scorecard)
     shelf_days: days between the last batch of THIS product it delivered and
       that batch's expiration date (how long it could stay on the shelf)

   Returns { rows (each with `best`: the metrics it is best at), pick, verdict }.
   A metric only counts when at least two suppliers have a figure for it. */
const METRICS = [
    { key: 'average_days', better: 'low' },
    { key: 'shelf_days', better: 'high' },
    { key: 'on_time_percent', better: 'high' },
    { key: 'cost', better: 'low' },
    { key: 'stars', better: 'high' }
];
const WEIGHT = { average_days: 3, shelf_days: 3, on_time_percent: 2, cost: 1, stars: 1 };

const has = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

function compareSuppliers(input) {
    const rows = (Array.isArray(input) ? input : []).map(r => ({ ...r, best: [] }));
    if (rows.length < 2) return { rows, pick: rows[0] ? rows[0].supplier_id : null, verdict: null };
    for (const m of METRICS) {
        const withFig = rows.filter(r => has(r[m.key]));
        if (withFig.length < 2) continue;
        const vals = withFig.map(r => Number(r[m.key]));
        const target = m.better === 'low' ? Math.min(...vals) : Math.max(...vals);
        if (vals.every(v => v === target)) continue;            // a tie is nobody's win
        withFig.filter(r => Number(r[m.key]) === target).forEach(r => r.best.push(m.key));
    }
    const score = r => r.best.reduce((a, k) => a + WEIGHT[k], 0);
    const ranked = [...rows].sort((a, b) => score(b) - score(a)
        || (has(a.average_days) && has(b.average_days) ? a.average_days - b.average_days : 0)
        || Number(!!b.is_main) - Number(!!a.is_main));
    const pick = ranked[0], other = ranked[1];
    if (!score(pick)) {
        return { rows, pick: (rows.find(r => r.is_main) || rows[0]).supplier_id,
            verdict: 'Not enough received orders yet to say which supplier is better. Order from the main supplier for now.' };
    }
    const parts = [];
    if (pick.best.includes('average_days')) parts.push(`it delivers in about ${fmtDays(pick.average_days)} instead of ${fmtDays(other.average_days)}`);
    if (pick.best.includes('shelf_days')) {
        const months = Math.round((pick.shelf_days - other.shelf_days) / 30);
        parts.push(months >= 1 ? `its last batch lasted ${months} month${months === 1 ? '' : 's'} longer` : 'its last batch lasted longer');
    }
    if (!parts.length && pick.best.includes('on_time_percent')) parts.push(`it arrived on time ${pick.on_time_percent}% of the time`);
    if (!parts.length && pick.best.includes('cost')) parts.push('it is cheaper');
    let verdict = `Order from ${pick.name}${parts.length ? ': ' + parts.join(', and ') : ''}.`;
    const cheaper = rows.filter(r => r !== pick && r.best.includes('cost'))[0];
    if (cheaper && has(pick.cost) && has(cheaper.cost)) {
        verdict += ` ${cheaper.name} is ₱${(Number(pick.cost) - Number(cheaper.cost)).toFixed(2)} cheaper each.`;
    }
    return { rows, pick: pick.supplier_id, verdict };
}

function fmtDays(d) {
    const n = Math.round(Number(d) * 10) / 10;
    return `${n} day${n === 1 ? '' : 's'}`;
}

module.exports = { compareSuppliers, METRICS };
