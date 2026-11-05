/* The shop's calendar for the sales simulation: how busy a given day is in an
   urban Metro Manila neighbourhood pet-supply shop.

   Every figure here is a multiplier on an ordinary day (1.0). Where a number
   comes from a published source it says so; the rest are estimates (there is
   no published hour-by-hour data for Philippine pet shops). See
   QA/SIMULATION.md for the sources.

   Everything is decided from the date alone (plus a per-day random number),
   so running the same day twice gives the same answer. */

/* Regular and special non-working holidays. 2026 from Proclamation No. 1006
   (s. 2025) and No. 1189 (Eid'l Fitr). Holy Week days are worked out from
   Easter, so they are not listed. Eid'l Adha 2026 is an estimate. */
const HOLIDAYS = {
    // 2025
    '2025-01-01': 'New Year', '2025-01-29': 'Chinese New Year', '2025-04-01': "Eid'l Fitr",
    '2025-04-09': 'Araw ng Kagitingan', '2025-05-01': 'Labor Day', '2025-05-12': 'Election Day',
    '2025-06-06': "Eid'l Adha", '2025-06-12': 'Independence Day', '2025-08-21': 'Ninoy Aquino Day',
    '2025-08-25': 'National Heroes Day', '2025-10-31': 'Special day', '2025-11-01': "All Saints' Day",
    '2025-11-30': 'Bonifacio Day', '2025-12-08': 'Immaculate Conception', '2025-12-24': 'Christmas Eve',
    '2025-12-25': 'Christmas Day', '2025-12-30': 'Rizal Day', '2025-12-31': 'Last Day of the Year',
    // 2026
    '2026-01-01': 'New Year', '2026-02-17': 'Chinese New Year', '2026-03-20': "Eid'l Fitr",
    '2026-04-09': 'Araw ng Kagitingan', '2026-05-01': 'Labor Day', '2026-05-27': "Eid'l Adha",
    '2026-06-12': 'Independence Day', '2026-08-21': 'Ninoy Aquino Day', '2026-08-31': 'National Heroes Day',
    '2026-11-01': "All Saints' Day", '2026-11-02': "All Souls' Day", '2026-11-30': 'Bonifacio Day',
    '2026-12-08': 'Immaculate Conception', '2026-12-24': 'Christmas Eve', '2026-12-25': 'Christmas Day',
    '2026-12-30': 'Rizal Day', '2026-12-31': 'Last Day of the Year',
};
// Fixed-date holidays for years not listed above.
const FIXED = {
    '01-01': 'New Year', '04-09': 'Araw ng Kagitingan', '05-01': 'Labor Day', '06-12': 'Independence Day',
    '08-21': 'Ninoy Aquino Day', '11-01': "All Saints' Day", '11-02': "All Souls' Day", '11-30': 'Bonifacio Day',
    '12-08': 'Immaculate Conception', '12-24': 'Christmas Eve', '12-25': 'Christmas Day', '12-30': 'Rizal Day',
    '12-31': 'Last Day of the Year',
};

/* Shop hours (Philippine time). The shop's real sales sit between 06:00 and
   17:00, so the simulation keeps to the same hours. Share of the day's
   customers per opening hour: a morning run before work, a lunch bump and an
   after-work peak before closing (estimate). */
const OPEN_HOUR = 6;
const HOUR_WEIGHTS = { 6: 0.04, 7: 0.07, 8: 0.08, 9: 0.10, 10: 0.11, 11: 0.11, 12: 0.10, 13: 0.08, 14: 0.08, 15: 0.10, 16: 0.13 };
// Weekends: flatter, busier late morning, smaller after-work rush (estimate).
const WEEKEND_HOUR_WEIGHTS = { 6: 0.04, 7: 0.07, 8: 0.09, 9: 0.12, 10: 0.13, 11: 0.12, 12: 0.10, 13: 0.09, 14: 0.08, 15: 0.08, 16: 0.08 };

// Sun..Sat (estimate; typical neighbourhood retail).
const DAY_OF_WEEK = [1.15, 0.90, 0.88, 0.92, 0.95, 1.05, 1.25];
// Jan..Dec. "Ber" months build to December (13th-month pay, gifts) (estimate).
const MONTH = [0.85, 0.90, 0.95, 0.95, 1.00, 0.95, 0.90, 0.90, 0.97, 1.00, 1.05, 1.25];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = day => new Date(day + 'T00:00:00Z');
const addDays = (day, n) => { const d = parse(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

/** Easter Sunday (Gregorian), as YYYY-MM-DD. */
function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${year}-${pad(month)}-${pad(day)}`;
}

function holidayName(day) {
    if (HOLIDAYS[day]) return HOLIDAYS[day];
    const year = Number(day.slice(0, 4));
    if (year !== 2025 && year !== 2026 && FIXED[day.slice(5)]) return FIXED[day.slice(5)];
    const e = easter(year);
    if (day === addDays(e, -3)) return 'Maundy Thursday';
    if (day === addDays(e, -2)) return 'Good Friday';
    if (day === addDays(e, -1)) return 'Black Saturday';
    return null;
}

/** Last day of the month, as a day number. */
const monthEnd = day => { const d = parse(day); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };

/** The pay day (15th or end of month) nearest to `day`, moved to the Friday
    before when it falls on a weekend, and how many days `day` is after it. */
function paydayOffset(day) {
    const d = parse(day);
    const candidates = [];
    for (const m of [-1, 0, 1]) {
        const y = d.getUTCFullYear(), mo = d.getUTCMonth() + m;
        for (const dd of [15, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()]) {
            const p = new Date(Date.UTC(y, mo, dd));
            const wd = p.getUTCDay();
            if (wd === 6) p.setUTCDate(p.getUTCDate() - 1);
            if (wd === 0) p.setUTCDate(p.getUTCDate() - 2);
            candidates.push(Math.round((d - p) / 86400e3));
        }
    }
    return candidates.reduce((best, x) => (Math.abs(x) < Math.abs(best) || (Math.abs(x) === Math.abs(best) && x > best) ? x : best));
}

// Days after pay day → busier; the days just before → tighter budgets.
// Packworks found sari-sari demand 6-9% higher on pay days; pet food is a
// planned buy, so the lift is set somewhat higher (estimate).
const PAYDAY_LIFT = { '-4': 0.92, '-3': 0.92, '-2': 0.92, '-1': 1.05, 0: 1.20, 1: 1.25, 2: 1.15, 3: 1.07 };

/**
 * How the shop trades on `day`.
 * `rand` is a function returning [0,1) seeded for that day.
 * Returns { open, closeHour, factor, bigBasket, reasons[] }.
 */
function dayProfile(day, rand) {
    const d = parse(day);
    const month = d.getUTCMonth(), dom = d.getUTCDate(), wd = d.getUTCDay();
    const reasons = [];
    const holiday = holidayName(day);

    // Closed: New Year, Maundy Thursday, Good Friday, Christmas Day.
    if (['New Year', 'Maundy Thursday', 'Good Friday', 'Christmas Day'].includes(holiday)) {
        return { open: false, closeHour: OPEN_HOUR, factor: 0, bigBasket: 1, reasons: ['closed: ' + holiday] };
    }

    let factor = DAY_OF_WEEK[wd] * MONTH[month];
    let closeHour = 17;
    if (month === 11 && dom >= 16 && dom <= 23) { factor *= 1.35 / MONTH[11]; reasons.push('Christmas rush'); }
    if (month === 11 && dom >= 26) { factor *= 0.90 / MONTH[11]; reasons.push('after Christmas'); }
    if (month === 0 && dom <= 15) { factor *= 0.80 / MONTH[0]; reasons.push('January budgets'); }

    // Holy Monday-Wednesday are quiet as people go home to the province.
    const e = easter(d.getUTCFullYear());
    if (day >= addDays(e, -6) && day <= addDays(e, -4)) { factor *= 0.85; reasons.push('Holy Week'); }
    if (day === e) { factor *= 0.80; reasons.push('Easter Sunday'); }

    if (holiday) {
        if (['Black Saturday', 'Christmas Eve', 'Last Day of the Year', "All Saints' Day"].includes(holiday)) {
            closeHour = 15; factor *= 0.60; reasons.push('half day: ' + holiday);
        } else { factor *= 0.80; reasons.push('holiday: ' + holiday); }
    }

    const off = paydayOffset(day);
    let bigBasket = 1;
    if (PAYDAY_LIFT[off] != null) {
        factor *= PAYDAY_LIFT[off];
        if (off >= 0 && off <= 2) { bigBasket = 1.5; reasons.push('payday'); }
        else if (off < -1) reasons.push('before payday');
    }

    // Rainy season (June-October): some days of heavy rain, and a few typhoon
    // days from July to October (about 3-4 a year) (estimate).
    const r = rand();
    if (month >= 6 && month <= 9 && r < 0.03) { factor *= 0.35; reasons.push('typhoon'); }
    else if (month >= 5 && month <= 9 && r < 0.25) { factor *= 0.80; reasons.push('heavy rain'); }

    return { open: true, closeHour, factor, bigBasket, reasons };
}

/** The share of customers per opening hour, cut at closing time. */
function hourWeights(day, closeHour) {
    const wd = parse(day).getUTCDay();
    const base = wd === 0 || wd === 6 ? WEEKEND_HOUR_WEIGHTS : HOUR_WEIGHTS;
    return Object.entries(base).filter(([h]) => Number(h) < closeHour).map(([h, w]) => [Number(h), w]);
}

module.exports = { dayProfile, hourWeights, holidayName, paydayOffset, easter, addDays, monthEnd };
