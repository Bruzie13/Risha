# Daily sales simulation

Fills the days the shop has no sales for with realistic POS trading for an urban Metro Manila neighbourhood pet-supply shop, so Reports, Analytics and the forecast always have current data to show.

## When it runs

- **Every time the system starts** (`Start FETCH.command`, `npm start`), right after the start-up migrations, and again every 3 hours while it stays running.
- It fills every day after the last day that has sales, up to **yesterday** (today is left to the live run and the real till, since a filled-in day also counts and closes the drawer). A day that already has real sales is never touched. At most 120 days in one run.
- **The automatic fill-in is off on Render (the live site)**: it only runs where `NODE_ENV` is not `production`. Since the laptop and Render share one database, the laptop's runs show up on the live site too. The **Run simulation** button (live mode) works on both.

## Live mode, for recording (Simulation screen)

A separate **Simulation** account (Users → Add user → role *Simulation — watch the live sales simulation*) signs in straight to `simulation.html` and can do nothing else: the server refuses every other page and API for it. Administrators can open the same screen at `/simulation.html`.

- Press **Run simulation** (2 hours), or choose **Run for** (30 minutes to 2 hours) and press **Start**. A backup is saved first; if it fails, nothing starts.
- **The drawer works like the real till.** Run opens each cashier's drawer with starting cash (₱1,000, ₱1,500 or ₱2,000). **Pause** stops the customers and the clock; **Resume** carries on with the time that was left. **End of day** stops the run, counts the cash (starting cash + cash sales; usually balanced, now and then a little short or over) and closes the drawer. After that the cashier cannot sell again today, on the real POS too, until tomorrow, and Run is refused.
- The automatically filled past days get the same: drawer opened in the morning, counted and closed at closing.
- A simulated customer comes to the counter every **20–60 seconds** (quicker on a busy day), stamped with the real time, so today's Dashboard and Reports fill up while you record. 2 hours makes about 150–250 sales.
- Items that sell out get a rush delivery at once; every 15 minutes a supplier delivery tops up low items.
- The screen shows each customer as they buy (regular or walk-in, items, amount paid in cash), today's totals for the whole shop, customers per hour and what is selling most.
- It stops by itself when the time is up, when **Stop** is pressed, or when the server stops. Live sales are numbered `SIM-YYYYMMDD-L…` and are taken out by `--remove` like the rest.
- Pace (optional): `SIM_LIVE_MIN_SECONDS` (20), `SIM_LIVE_MAX_SECONDS` (60) in `backend/.env`.

## Backup first

Before it writes anything, it saves a full backup of the database to `backups/auto/risha-before-simulation-<date>-<time>.zip` (the newest 14 are kept). **If the backup fails, nothing is written.** Restore with:

```
node scripts/restore-backup.js backups/auto/<file>.zip --confirm
```

## What it writes

Exactly what a real POS sale writes, so every page reads it like real trading:

| Table | What |
|---|---|
| `sales` | one row per customer, `payment_status = 'completed'` |
| `sale_items` | the products bought |
| `products.stock_quantity` | goes down with each sale, up with each delivery |
| `stock_movements` | `out` per sale line, `in` per delivery |

Not written: audit-log rows and notifications (hundreds of "New Sale Completed" notices would bury the real ones). The hourly stock check still raises low-stock alerts on its own.

## How it is marked (and taken out again)

| Where | Mark |
|---|---|
| `sales.sale_number` | `SIM-YYYYMMDD-NNN` |
| `sales.notes` | ends with `[SIM]` |
| `stock_movements.notes` | starts with `[SIM]` |

```
node scripts/simulate.js --remove            # count only
node scripts/simulate.js --remove --confirm  # delete them all and put the stock back
```

`--remove` also puts back the expiry date a product had before its first simulated delivery.

## Commands

```
node scripts/simulate.js            # preview: which days, how many sales (writes nothing)
node scripts/simulate.js --apply    # backup, then fill now without starting the server
```

Turn it off with `SIMULATION=off` in `backend/.env`. Settings (optional): `SIM_SALES_PER_DAY` (an ordinary weekday, default 15), `SIM_MAX_DAYS` (120), `SIM_SEED`.

## How the shop is modelled

| Factor | Value | Basis |
|---|---|---|
| Hours | 06:00–17:00 | the shop's own sales history |
| Busiest hours | 09:00–12:00 and 16:00 (after-work rush) | estimate |
| Day of week | Mon 0.90 · Tue 0.88 · Wed 0.92 · Thu 0.95 · Fri 1.05 · **Sat 1.25** · Sun 1.15 | estimate |
| Pay day (15th and end of month, moved to Friday if on a weekend) | day before 1.05 · **pay day 1.20 · day after 1.25** · +2 1.15 · +3 1.07; 4–2 days before 0.92; more multi-pack buying | Packworks sari-sari payday data, raised for planned pet-food buying (estimate) |
| Month | Jan 0.85 … Dec 1.25; **16–23 Dec 1.35** (13th-month pay); 1–15 Jan 0.80 | "ber" months pattern (estimate) |
| Closed | New Year's Day, Maundy Thursday, Good Friday, Christmas Day | typical small-shop closures |
| Half day (closes 15:00, 0.60) | Black Saturday, Christmas Eve, 31 Dec, All Saints' Day | estimate |
| Other holidays | 0.80 | 2026 dates from Proclamation No. 1006 and No. 1189 |
| Rainy season (Jun–Oct) | about 1 day in 4 heavy rain (0.80); Jul–Oct about 3% typhoon days (0.35) | PAGASA season, estimate |
| Customers a day | Poisson with day-to-day spread (negative binomial, dispersion 25), never below half the expected count | estimate |
| Basket | 1 line 45%, 2 lines 30%, 3 lines 15%, 4 lines 10%; quantity 1 (72%), 2 (20%), 3 (8%) | estimate |
| Products | weighted by what has actually been selling; Dec toys/accessories ×2; Mar–May shampoo/tick & flea ×1.3 | shop history + estimate |
| Regulars | 80 named regulars (Filipino names, PH mobile numbers) make about 40% of visits and keep buying their usual food | estimate |
| Payment | cash only, like the shop's POS (no GCash, Maya or card; decided 7 Nov 2026) | the shop's own POS |
| Discount | 7% of sales get 5% or 10%, never above the POS limit | estimate |
| Deliveries | Tue and Fri at 10:00: every item at or below its reorder level back to its full level; other days, a rush order for items that sold out | estimate |
| Expired stock | never sold; a delivery of an item expiring within 30 days brings a new expiry 9–18 months out | POS rule |

The same day always gives the same sales (seeded random numbers), so a removed day comes back identically.
