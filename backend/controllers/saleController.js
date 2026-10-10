const Sale = require('../models/Sale');
const Product = require('../models/Product');
const logAudit = require('../services/audit');
const { notifySaleCreated, notifyLowStock, notifyStockout } = require('../services/notifier');

function saleFilters(query) {
    const filters = {};
    // accept both param spellings (the frontend used date_from/date_to)
    const from = query.startDate || query.date_from;
    const to = query.endDate || query.date_to;
    if (from) filters.date_from = from;
    if (to) filters.date_to = to;
    if (query.search && String(query.search).trim()) filters.search = String(query.search).trim();
    return filters;
}

exports.getAllSales = async (req, res) => {
    try {
        const filters = saleFilters(req.query);
        const { limit, offset } = req.query;
        const paginated = limit !== undefined;
        if (paginated) {
            filters.limit = parseInt(limit);
            if (offset !== undefined) filters.offset = parseInt(offset);
        }
        const sales = await Sale.getAll(filters);
        const total = paginated ? await Sale.countAll(filters) : sales.length;
        res.status(200).json({ success: true, data: sales, total });
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving sales'
        });
    }
};

exports.getSalesStats = async (req, res) => {
    try {
        const stats = await Sale.getStats(saleFilters(req.query));
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        console.error('Get sales stats error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving sales stats' });
    }
};

exports.getSaleById = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await Sale.findById(id);

        if (!sale) {
            return res.status(404).json({
                success: false,
                message: 'Sale not found'
            });
        }

        // A till account can look up a sale only to reprint its own receipt.
        if (req.user.role === 'cashier' && Number(sale.created_by) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'This account cannot do that.' });
        }

        const items = await Sale.getSaleItems(id);
        res.status(200).json({
            success: true,
            data: { ...sale, items }
        });
    } catch (error) {
        console.error('Get sale error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving sale'
        });
    }
};

exports.createSale = async (req, res) => {
    try {
        const { items, payment_method, notes, customer_name, customer_phone, discount_percent } = req.body;
        const staff_id = req.user.id;

        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Sale must have at least one item'
            });
        }

        /* A cashier who has saved the end-of-day count has closed the drawer.
           A sale after that would put cash into a drawer whose count is
           already final, and it would never be counted. So selling stops with
           the count, the same as cash in and out does, until an administrator
           reopens the count. */
        if (req.user.role === 'cashier') {
            const [closed] = await pool.query(
                'SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [shopToday(), req.user.id]);
            if (closed.length) {
                return res.status(400).json({
                    success: false,
                    code: 'DRAWER_CLOSED',
                    message: "Your drawer is closed for today: the end-of-day count is already saved. Ask an administrator or a manager to reopen the count if you need to sell again."
                });
            }
        }

        for (const item of items) {
            if (!item.product_id || !item.quantity || item.quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Each item must have a valid product_id and positive quantity' });
            }
            if (item.unit_price !== undefined && (isNaN(item.unit_price) || item.unit_price < 0)) {
                return res.status(400).json({ success: false, message: 'Unit price must be a non-negative number' });
            }
            const product = await Product.findById(item.product_id);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: `Product with ID ${item.product_id} not found`
                });
            }
            if (product.stock_quantity < item.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}, requested: ${item.quantity}`
                });
            }
            // Expired means the date has passed. It was "on or before now",
            // which refused a product on its last good day while inventory
            // still listed it as merely expiring.
            if (product.expiration_date && expiryDay(product.expiration_date) < shopToday()) {
                return res.status(400).json({
                    success: false,
                    message: `Product ${product.name} has expired and cannot be sold`
                });
            }
            item.unit_price = product.unit_price;
        }

        let total_amount = 0;
        for (const item of items) {
            item.subtotal = item.quantity * item.unit_price;
            total_amount += item.subtotal;
        }

        // The ceiling is the shop's, read fresh each sale; the browser's copy
        // of it is only there to warn the cashier early.
        const discountCheck = checkDiscount(discount_percent, await readMaxDiscount(pool));
        if (discountCheck.error) {
            return res.status(400).json({ success: false, message: discountCheck.error });
        }
        const discPct = discountCheck.percent;
        const final_amount = Math.max(0, total_amount - (total_amount * (discPct / 100)));

        const saleData = {
            staff_id,
            total_amount,
            final_amount,
            discount: discPct,
            // POS is cash-only: ignore whatever the client sends
            payment_method: 'cash',
            notes: notes || null,
            customer_name: customer_name || null,
            customer_phone: customer_phone || null,
            items
        };

        const sale = await Sale.create(saleData);

        logAudit(req.user.id, 'create', 'sales', sale.data?.id || sale.id, null, sale, req.ip);

        notifySaleCreated(sale, req.user.id).catch(e => console.error('Notif error:', e.message));

        // Check if any sold items are now low stock or out of stock
        for (const item of items) {
            const product = await Product.findById(item.product_id);
            if (product) {
                if (product.stock_quantity <= 0) {
                    notifyStockout(product).catch(() => {});
                } else if (product.stock_quantity <= product.reorder_level) {
                    notifyLowStock(product).catch(() => {});
                }
            }
        }

        res.status(201).json({
            success: true,
            message: 'Sale created successfully',
            data: sale
        });
    } catch (error) {
        console.error('Create sale error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating sale'
        });
    }
};

exports.voidSale = async (req, res) => {
    try {
        const { id } = req.params;
        const reason = (req.body && req.body.reason ? String(req.body.reason) : '').slice(0, 300);
        const result = await Sale.void(id, reason);
        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }
        logAudit(req.user.id, 'update', 'sales', parseInt(id), null, { voided: true, reason }, req.ip);
        res.status(200).json({ success: true, message: 'Sale voided and stock restored', data: result });
    } catch (error) {
        console.error('Void sale error:', error);
        res.status(500).json({ success: false, message: 'Error voiding sale' });
    }
};

// ---- End-of-day cash reconciliation ----

const pool = require('../config/database');
const { checkDiscount, drawerExpected, discrepancy } = require('../utils/till');
const { readMaxDiscount } = require('./tillController');

/* A DATE column read as the calendar day it means. mysql2 hands it over as a
   Date at the server's own midnight, so the UTC reading is a day early on a
   machine ahead of UTC; shifting by the shop's offset lands on the right day
   whether the server runs in Manila or in UTC. */
function expiryDay(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const d = new Date(value);
    return isNaN(d) ? '9999-12-31' : new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* The shop's calendar day. toISOString() is UTC, which is still yesterday in
   the Philippines until 8am — a cashier closing an early shift would have
   recorded the count against the wrong date. */
function shopToday() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* Which day a cash count is for. Back-office roles may pick a date (to fix a
   missed close); a cashier counts the drawer in front of them, so it is
   always today, whatever the request says. */
function eodDate(req, requested) {
    if (req.user.role === 'cashier') return shopToday();
    return /^\d{4}-\d{2}-\d{2}$/.test(requested || '') ? requested : shopToday();
}

/* A cashier's count is of their own drawer: what it started with plus the
   cash they took today. It is blind — the expected figure is withheld until
   they have typed what they counted — and final, so the answer cannot be
   read off the screen and then typed in. A manager can remove a count to let
   it be done again.

   Admins and managers keep the shop-wide view from Sales History. */
/* Cash put into or taken out of drawers on a day, other than through sales.
   One cashier's when cashierId is given, the whole shop's otherwise. */
async function cashMovesFor(conn, date, cashierId) {
    const [rows] = await conn.execute(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount END), 0) AS cash_in,
                COALESCE(SUM(CASE WHEN kind = 'out' THEN amount END), 0) AS cash_out
         FROM till_cash_moves WHERE business_date = ?` + (cashierId ? ' AND cashier_id = ?' : ''),
        cashierId ? [date, cashierId] : [date]);
    return { cash_in: parseFloat(rows[0].cash_in) || 0, cash_out: parseFloat(rows[0].cash_out) || 0 };
}

async function cashierDrawer(conn, cashierId, date) {
    const [sales] = await conn.execute(
        `SELECT COUNT(*) AS transactions, COALESCE(SUM(final_amount), 0) AS cash_sales
         FROM sales
         WHERE created_by = ? AND DATE(CONVERT_TZ(created_at,'+00:00','+08:00')) = ?
           AND payment_method = 'cash' AND payment_status = 'completed'`, [cashierId, date]);
    const [opening] = await conn.execute(
        'SELECT opening_cash FROM till_openings WHERE business_date = ? AND cashier_id = ?', [date, cashierId]);
    const openingCash = opening.length ? parseFloat(opening[0].opening_cash) || 0 : 0;
    const moves = await cashMovesFor(conn, date, cashierId);
    return {
        transactions: Number(sales[0].transactions) || 0,
        opening_set: opening.length > 0,
        opening_cash: openingCash,
        cash_in: moves.cash_in,
        cash_out: moves.cash_out,
        expected: drawerExpected(openingCash, sales[0].cash_sales, moves.cash_in, moves.cash_out)
    };
}
exports._cashierDrawer = cashierDrawer;

exports.getEod = async (req, res) => {
    try {
        const date = eodDate(req, req.query.date);
        const conn = await pool.getConnection();
        try {
            if (req.user.role === 'cashier') {
                const drawer = await cashierDrawer(conn, req.user.id, date);
                const [mine] = await conn.execute(
                    `SELECT expected_cash, counted_cash, discrepancy, notes, opening_cash, cash_in, cash_out
                     FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?`, [date, req.user.id]);
                const done = mine[0] || null;
                return res.json({
                    success: true,
                    data: {
                        date,
                        transactions: drawer.transactions,
                        opening_set: drawer.opening_set,
                        opening_cash: drawer.opening_cash,
                        // what the cashier recorded themselves, so not a secret
                        cash_in: drawer.cash_in,
                        cash_out: drawer.cash_out,
                        counted: !!done,
                        // only once the count is in
                        result: done ? {
                            expected_cash: parseFloat(done.expected_cash),
                            cash_in: parseFloat(done.cash_in) || 0,
                            cash_out: parseFloat(done.cash_out) || 0,
                            counted_cash: parseFloat(done.counted_cash),
                            discrepancy: parseFloat(done.discrepancy),
                            notes: done.notes || ''
                        } : null
                    }
                });
            }

            const [sales] = await conn.execute(
                `SELECT COUNT(*) as transactions, COALESCE(SUM(final_amount), 0) as cash_sales,
                        MIN(created_at) as first_sale, MAX(created_at) as last_sale
                 FROM sales
                 WHERE DATE(CONVERT_TZ(created_at,'+00:00','+08:00')) = ? AND payment_method = 'cash' AND payment_status = 'completed'`, [date]);
            const [voided] = await conn.execute(
                `SELECT COUNT(*) as c FROM sales WHERE DATE(CONVERT_TZ(created_at,'+00:00','+08:00')) = ? AND payment_status = 'voided'`, [date]);
            // Each person's count is its own row now; the dialog edits yours.
            const [existing] = await conn.execute(
                `SELECT cr.*, u.full_name as counted_by_name FROM cash_reconciliations cr
                 LEFT JOIN users u ON cr.counted_by = u.id WHERE cr.business_date = ? AND cr.counted_by = ?`, [date, req.user.id]);
            // Cash put in or taken out of any drawer that day, with who and why.
            const moves = await cashMovesFor(conn, date);
            const [moveRows] = await conn.execute(
                `SELECT m.id, m.kind, m.amount, m.reason, UNIX_TIMESTAMP(m.created_at) * 1000 AS created_at,
                        u.full_name AS cashier_name
                 FROM till_cash_moves m LEFT JOIN users u ON u.id = m.cashier_id
                 WHERE m.business_date = ? ORDER BY m.id`, [date]);
            const cashSales = parseFloat(sales[0].cash_sales) || 0;
            res.json({
                success: true,
                data: {
                    date,
                    cash_sales: cashSales,
                    cash_in: moves.cash_in,
                    cash_out: moves.cash_out,
                    cash_moves: moveRows.map(r => ({ ...r, amount: parseFloat(r.amount) })),
                    expected_cash: drawerExpected(0, cashSales, moves.cash_in, moves.cash_out),
                    transactions: sales[0].transactions || 0,
                    voided_sales: voided[0].c || 0,
                    first_sale: sales[0].first_sale,
                    last_sale: sales[0].last_sale,
                    reconciliation: existing[0] || null
                }
            });
        } finally { conn.release(); }
    } catch (error) {
        console.error('EOD error:', error);
        res.status(500).json({ success: false, message: 'Error computing end of day' });
    }
};

exports.saveEod = async (req, res) => {
    try {
        const { date, counted_cash, notes } = req.body;
        const bizDate = eodDate(req, date);
        const counted = parseFloat(counted_cash);
        if (isNaN(counted) || counted < 0) {
            return res.status(400).json({ success: false, message: 'Counted cash must be a valid amount' });
        }
        const cleanNotes = String(notes || '').slice(0, 500) || null;
        const conn = await pool.getConnection();
        try {
            if (req.user.role === 'cashier') {
                const [mine] = await conn.execute(
                    'SELECT id FROM cash_reconciliations WHERE business_date = ? AND counted_by = ?', [bizDate, req.user.id]);
                if (mine.length) {
                    return res.status(400).json({ success: false, message: "Today's count is already recorded. Ask a manager if it needs to be done again." });
                }
                const drawer = await cashierDrawer(conn, req.user.id, bizDate);
                const diff = discrepancy(counted, drawer.expected);
                await conn.execute(
                    `INSERT INTO cash_reconciliations (business_date, expected_cash, counted_cash, discrepancy, notes, counted_by, opening_cash, cash_in, cash_out)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [bizDate, drawer.expected, counted, diff, cleanNotes, req.user.id, drawer.opening_cash, drawer.cash_in, drawer.cash_out]);
                logAudit(req.user.id, 'create', 'cash_reconciliations', null, null,
                    { date: bizDate, opening: drawer.opening_cash, cash_in: drawer.cash_in, cash_out: drawer.cash_out, expected: drawer.expected, counted, discrepancy: diff }, req.ip);
                return res.json({ success: true, data: { date: bizDate, opening_cash: drawer.opening_cash, cash_in: drawer.cash_in, cash_out: drawer.cash_out, expected_cash: drawer.expected, counted_cash: counted, discrepancy: diff } });
            }

            const [sales] = await conn.execute(
                `SELECT COALESCE(SUM(final_amount), 0) as expected FROM sales
                 WHERE DATE(CONVERT_TZ(created_at,'+00:00','+08:00')) = ? AND payment_method = 'cash' AND payment_status = 'completed'`, [bizDate]);
            // the whole shop: every cashier's cash sales, plus cash put into the
            // drawers, less cash taken out of them
            const moves = await cashMovesFor(conn, bizDate);
            const expected = drawerExpected(0, sales[0].expected, moves.cash_in, moves.cash_out);
            const diff = discrepancy(counted, expected);
            await conn.execute(
                `INSERT INTO cash_reconciliations (business_date, expected_cash, counted_cash, discrepancy, notes, counted_by, cash_in, cash_out)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE expected_cash = VALUES(expected_cash), counted_cash = VALUES(counted_cash),
                     discrepancy = VALUES(discrepancy), notes = VALUES(notes), cash_in = VALUES(cash_in), cash_out = VALUES(cash_out)`,
                [bizDate, expected, counted, diff, cleanNotes, req.user.id, moves.cash_in, moves.cash_out]);
            logAudit(req.user.id, 'create', 'cash_reconciliations', null, null, { date: bizDate, expected, counted, discrepancy: diff }, req.ip);
            res.json({ success: true, data: { date: bizDate, expected_cash: expected, counted_cash: counted, discrepancy: diff } });
        } finally { conn.release(); }
    } catch (error) {
        console.error('EOD save error:', error);
        res.status(500).json({ success: false, message: 'Error saving reconciliation' });
    }
};

exports.getEodHistory = async (req, res) => {
    try {
        const conn = await pool.getConnection();
        try {
            const [rows] = await conn.execute(
                `SELECT cr.*, u.full_name as counted_by_name, u.role as counted_by_role FROM cash_reconciliations cr
                 LEFT JOIN users u ON cr.counted_by = u.id
                 ORDER BY cr.business_date DESC, cr.id DESC LIMIT 40`);
            // Who put cash in or took it out on each of those days, and why.
            if (rows.length) {
                const days = [...new Set(rows.map(r => r.business_date instanceof Date
                    ? new Date(r.business_date.getTime() - r.business_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
                    : String(r.business_date).slice(0, 10)))];
                const [moves] = await conn.query(
                    `SELECT DATE_FORMAT(business_date, '%Y-%m-%d') AS day, cashier_id, kind, amount, reason,
                            UNIX_TIMESTAMP(created_at) * 1000 AS created_at
                     FROM till_cash_moves WHERE business_date IN (?) ORDER BY id`, [days]);
                rows.forEach(r => {
                    const day = r.business_date instanceof Date
                        ? new Date(r.business_date.getTime() - r.business_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
                        : String(r.business_date).slice(0, 10);
                    // a cashier's count shows their own drawer; a whole-shop count shows everyone's
                    r.cash_moves = moves
                        .filter(m => m.day === day && (r.counted_by_role !== 'cashier' || Number(m.cashier_id) === Number(r.counted_by)))
                        .map(m => ({ kind: m.kind, amount: parseFloat(m.amount), reason: m.reason, created_at: m.created_at }));
                });
            }
            res.json({ success: true, data: rows });
        } finally { conn.release(); }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error loading reconciliation history' });
    }
};

exports.deleteSale = async (req, res) => {
    try {
        const { id } = req.params;
        await Sale.delete(id);

        logAudit(req.user.id, 'delete', 'sales', parseInt(id), null, null, req.ip);

        res.status(200).json({
            success: true,
            message: 'Sale deleted and stock restored successfully'
        });
    } catch (error) {
        console.error('Delete sale error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting sale'
        });
    }
};

exports.getDailySales = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const sales = await Sale.getDailySales(days);
        res.status(200).json({
            success: true,
            data: sales
        });
    } catch (error) {
        console.error('Get daily sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving daily sales'
        });
    }
};

exports.getSalesReport = async (req, res) => {
    try {
        const { period, date_from, date_to } = req.query;
        // Only real calendar dates reach the query; anything else is ignored
        // rather than passed along.
        const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
        const ranged = isDate(date_from) && isDate(date_to);
        const startDate = ranged ? date_from : null;
        const endDate = ranged ? date_to : null;
        const grouping = ['daily', 'weekly', 'monthly'].includes(period) ? period : 'daily';
        const report = await Sale.getSalesReport(grouping, startDate, endDate);
        res.status(200).json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('Get sales report error:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating sales report'
        });
    }
};
