/* The shop's monthly sales goal (Carlo, 9 Nov: "Sa Forecast, dapat may goal
   siya"). One amount in pesos, kept in app_settings, that holds for every month
   until it is changed. The Forecast tab sets it against what has sold so far
   this month and what the forecast expects for the days left. */
const pool = require('../config/database');
const logAudit = require('../services/audit');

const KEY = 'monthly_sales_goal';
const MAX_GOAL = 1e9;

/** The shop's day and month, in Manila time. */
function shopNow() {
    const now = new Date(Date.now() + 8 * 3600e3);
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const pad = n => String(n).padStart(2, '0');
    return {
        today: `${y}-${pad(m + 1)}-${pad(now.getUTCDate())}`,
        monthStart: `${y}-${pad(m + 1)}-01`,
        nextMonth: m === 11 ? `${y + 1}-01-01` : `${y}-${pad(m + 2)}-01`,
        day: now.getUTCDate(),
        daysInMonth: new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    };
}

/** What a typed goal means, or why it cannot be saved. */
function goalProblem(raw) {
    const text = String(raw ?? '').replace(/[₱,\s]/g, '');
    if (text === '') return { error: 'Enter the goal in pesos, for example 500000.' };
    const amount = Number(text);
    if (!isFinite(amount)) return { error: 'The goal must be a number of pesos, for example 500000.' };
    if (amount <= 0) return { error: 'The goal must be more than ₱0.' };
    if (amount > MAX_GOAL) return { error: 'The goal cannot be more than ₱1,000,000,000.' };
    return { amount: Math.round(amount * 100) / 100 };
}

exports.getGoal = async (req, res) => {
    try {
        const t = shopNow();
        const [[setting]] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [KEY]);
        // completed sales this month so far, what the customer paid (after discounts)
        const [[sold]] = await pool.query(
            `SELECT COALESCE(SUM(final_amount), 0) AS revenue, COUNT(*) AS sales
               FROM sales
              WHERE payment_status <> 'voided'
                AND CONVERT_TZ(created_at, '+00:00', '+08:00') >= ? AND CONVERT_TZ(created_at, '+00:00', '+08:00') < ?`,
            [t.monthStart, t.nextMonth]);
        const goal = setting ? Number(setting.setting_value) || null : null;
        res.json({ success: true, data: {
            goal, month_start: t.monthStart, today: t.today, day: t.day, days_in_month: t.daysInMonth,
            sold_so_far: Math.round(Number(sold.revenue) * 100) / 100, sales_so_far: Number(sold.sales) || 0
        } });
    } catch (e) {
        console.error('Get sales goal error:', e);
        res.status(500).json({ success: false, message: 'The sales goal could not be loaded' });
    }
};

exports.saveGoal = async (req, res) => {
    try {
        const check = goalProblem(req.body && req.body.goal);
        if (check.error) return res.status(400).json({ success: false, message: check.error });
        const [[before]] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [KEY]);
        await pool.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [KEY, String(check.amount)]);
        logAudit(req.user.id, 'update', 'app_settings', null,
            before ? { [KEY]: before.setting_value } : null, { [KEY]: String(check.amount) }, req.ip);
        res.json({ success: true, message: 'Sales goal saved.', data: { goal: check.amount } });
    } catch (e) {
        console.error('Save sales goal error:', e);
        res.status(500).json({ success: false, message: 'The sales goal could not be saved' });
    }
};

exports._goalProblem = goalProblem;
