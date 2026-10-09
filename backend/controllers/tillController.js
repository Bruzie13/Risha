/* The cashier's side of the till: starting cash, their own sales for the day,
   asking for a void, and the discount limit an admin sets.

   Everything a cashier reads or writes here is tied to their own account and
   to today. Neither comes from the request. */
const pool = require('../config/database');
const logAudit = require('../services/audit');
const Notification = require('../models/Notification');
const { maxDiscountFrom, voidRequestProblem } = require('../utils/till');

const SHOP_DAY = "DATE(CONVERT_TZ(created_at,'+00:00','+08:00'))";

function shopToday() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function readMaxDiscount(conn) {
    const [rows] = await conn.query("SELECT setting_value FROM app_settings WHERE setting_key = 'pos_max_discount_percent'");
    return maxDiscountFrom(rows.length ? rows[0].setting_value : null);
}

async function fail(res, where, error) {
    console.error(`[Till] ${where} failed:`, error.message);
    res.status(500).json({ success: false, message: 'The till could not complete that. Please try again.' });
}

// What the POS needs to know when a cashier opens it.
exports.getTill = async (req, res) => {
    try {
        const today = shopToday();
        const [opening] = await pool.query(
            'SELECT opening_cash FROM till_openings WHERE business_date = ? AND cashier_id = ?', [today, req.user.id]);
        const [counted] = await pool.query(
            'SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [today, req.user.id]);
        res.json({
            success: true,
            data: {
                date: today,
                opening_set: opening.length > 0,
                opening_cash: opening.length ? Number(opening[0].opening_cash) : 0,
                counted: counted.length > 0,
                max_discount_percent: await readMaxDiscount(pool)
            }
        });
    } catch (e) { fail(res, 'getTill', e); }
};

// Record the cash the drawer starts the day with.
exports.openTill = async (req, res) => {
    try {
        const amount = Math.round(parseFloat(req.body?.opening_cash) * 100) / 100;
        if (!isFinite(amount) || amount < 0 || amount > 1000000) {
            return res.status(400).json({ success: false, message: 'Enter the starting cash as an amount of zero or more.' });
        }
        const today = shopToday();
        // Once the day is counted the starting figure is part of a finished
        // record; changing it would change the result after the fact.
        const [counted] = await pool.query(
            'SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [today, req.user.id]);
        if (counted.length) {
            return res.status(400).json({ success: false, message: "Today's cash count is already recorded, so the starting cash can no longer be changed." });
        }
        await pool.query(
            `INSERT INTO till_openings (business_date, cashier_id, opening_cash) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE opening_cash = VALUES(opening_cash)`, [today, req.user.id, amount]);
        logAudit(req.user.id, 'create', 'till_openings', null, null, { date: today, opening_cash: amount }, req.ip);
        res.json({ success: true, data: { date: today, opening_cash: amount } });
    } catch (e) { fail(res, 'openTill', e); }
};

// The cashier's own sales today, newest first — for reprints and void requests.
exports.getMySales = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.sale_number, s.customer_name, s.final_amount, s.payment_status,
                    UNIX_TIMESTAMP(s.created_at) * 1000 AS created_at,
                    s.void_requested_at IS NOT NULL AS void_requested,
                    (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
             FROM sales s
             WHERE s.created_by = ? AND ${SHOP_DAY.replace('created_at', 's.created_at')} = ?
             ORDER BY s.created_at DESC LIMIT 300`, [req.user.id, shopToday()]);
        res.json({ success: true, data: rows.map(r => ({ ...r, void_requested: !!r.void_requested })) });
    } catch (e) { fail(res, 'getMySales', e); }
};

// A cashier cannot void. They flag the sale and say why; a manager decides.
exports.requestVoid = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || '').trim().slice(0, 300);
        if (!Number.isInteger(id)) return res.status(404).json({ success: false, message: 'Sale not found' });
        if (reason.length < 3) return res.status(400).json({ success: false, message: 'Say briefly why this sale should be voided.' });

        const [rows] = await pool.query(
            `SELECT id, sale_number, created_by, payment_status, void_requested_at,
                    DATE_FORMAT(CONVERT_TZ(created_at,'+00:00','+08:00'), '%Y-%m-%d') AS sale_day
             FROM sales WHERE id = ?`, [id]);
        const problem = voidRequestProblem(rows[0], req.user.id, rows[0] && rows[0].sale_day, shopToday());
        if (problem) return res.status(problem === 'Sale not found' ? 404 : 400).json({ success: false, message: problem });

        await pool.query('UPDATE sales SET void_requested_at = NOW(), void_request_reason = ? WHERE id = ?', [reason, id]);
        logAudit(req.user.id, 'update', 'sales', id, null, { void_requested: true, reason }, req.ip);
        Notification.create({
            title: 'Void requested',
            // the cashier's own words stay out of the alert; they are shown,
            // escaped, beside the sale in Sales History
            message: `A cashier asked for sale #${id} to be voided. Review it in Sales History.`,
            type: 'info', related_id: id, related_type: 'sale', user_id: req.user.id
        }).catch(e => console.error('Notif error:', e.message));
        res.json({ success: true, message: 'Sent to a manager for voiding.' });
    } catch (e) { fail(res, 'requestVoid', e); }
};

// A manager decides the sale should stand.
exports.dismissVoidRequest = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(404).json({ success: false, message: 'Sale not found' });
        const [result] = await pool.query(
            'UPDATE sales SET void_requested_at = NULL, void_request_reason = NULL WHERE id = ? AND void_requested_at IS NOT NULL', [id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'No void request on that sale' });
        logAudit(req.user.id, 'update', 'sales', id, null, { void_request_dismissed: true }, req.ip);
        res.json({ success: true, message: 'Request dismissed. The sale stands.' });
    } catch (e) { fail(res, 'dismissVoidRequest', e); }
};

// Let a cashier count again: remove their count for that day.
exports.reopenCount = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(404).json({ success: false, message: 'Count not found' });
        const [rows] = await pool.query('SELECT * FROM cash_reconciliations WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Count not found' });
        await pool.query('DELETE FROM cash_reconciliations WHERE id = ?', [id]);
        logAudit(req.user.id, 'delete', 'cash_reconciliations', id, rows[0], null, req.ip);
        res.json({ success: true, message: 'Count removed. It can be recorded again.' });
    } catch (e) { fail(res, 'reopenCount', e); }
};

exports.getPosSettings = async (req, res) => {
    try {
        res.json({ success: true, data: { max_discount_percent: await readMaxDiscount(pool) } });
    } catch (e) { fail(res, 'getPosSettings', e); }
};

exports.savePosSettings = async (req, res) => {
    try {
        const pct = parseFloat(req.body?.max_discount_percent);
        if (!isFinite(pct) || pct < 0 || pct > 100) {
            return res.status(400).json({ success: false, message: 'The discount limit must be between 0 and 100.' });
        }
        const value = String(Math.round(pct * 100) / 100);
        await pool.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ('pos_max_discount_percent', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [value]);
        logAudit(req.user.id, 'update', 'app_settings', null, null, { pos_max_discount_percent: value }, req.ip);
        res.json({ success: true, data: { max_discount_percent: Number(value) } });
    } catch (e) { fail(res, 'savePosSettings', e); }
};

exports.readMaxDiscount = readMaxDiscount;
exports.shopToday = shopToday;
