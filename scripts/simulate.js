/**
 * simulate.js: run the daily sales simulation by hand.
 *
 * The same simulation runs on its own each time the server starts (see
 * backend/services/simulation). This script is for looking first, running it
 * without starting the server, or taking all simulated data out again.
 *
 *   node scripts/simulate.js              plan only: lists the days it would fill, writes nothing
 *   node scripts/simulate.js --apply      backup to backups/auto/, then fill the days
 *   node scripts/simulate.js --remove     how many simulated rows there are (writes nothing)
 *   node scripts/simulate.js --remove --confirm
 *                                         delete every simulated sale and stock movement and
 *                                         put the stock back
 *
 * Settings (environment, all optional): SIM_SALES_PER_DAY (15), SIM_MAX_DAYS (120), SIM_SEED.
 */
const path = require('path');
const backend = path.join(__dirname, '..', 'backend');
// Same database the server uses. Without override, values already set in the
// environment win, so a test can point DB_* elsewhere.
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env') });

const sim = require(path.join(backend, 'services', 'simulation'));
const pool = require(path.join(backend, 'config', 'database'));
const args = process.argv.slice(2);
const has = f => args.includes(f);

(async () => {
    console.log(`Database: ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`);
    if (has('--remove')) {
        const r = await sim.removeAll({ dryRun: !has('--confirm') });
        console.log(has('--confirm')
            ? `Removed ${r.sales} simulated sales, ${r.movements} simulated stock movements and ${r.counts} simulated drawer counts; stock put back.`
            : `${r.sales} simulated sales, ${r.movements} simulated stock movements and ${r.counts} simulated drawer counts. Add --confirm to remove them.`);
        return;
    }
    const r = await sim.run({ dryRun: !has('--apply') });
    if (r.skipped) { console.log(r.skipped); return; }
    console.table(r.days);
    console.log(`${r.dryRun ? 'Would write' : 'Wrote'} ${r.sales} sales, PHP ${r.revenue.toFixed(2)}, ${r.restocks} restock(s) over ${r.days.length} day(s).`);
    if (r.backup) console.log(`Backup: ${r.backup}`);
    if (r.dryRun) console.log('Nothing was written. Add --apply to write it.');
})().catch(e => { console.error('Failed:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
