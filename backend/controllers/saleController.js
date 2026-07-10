const Sale = require('../models/Sale');
const Product = require('../models/Product');
const logAudit = require('../services/audit');
const { notifySaleCreated, notifyLowStock, notifyStockout } = require('../services/notifier');

exports.getAllSales = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const filters = {};
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;
        const sales = await Sale.getAll(filters);
        res.status(200).json({
            success: true,
            data: sales
        });
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving sales'
        });
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
            if (product.expiration_date && new Date(product.expiration_date) <= new Date()) {
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

        const discPct = Math.min(100, Math.max(0, parseFloat(discount_percent) || 0));
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

exports.getEod = async (req, res) => {
    try {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
        const conn = await pool.getConnection();
        try {
            const [sales] = await conn.execute(
                `SELECT COUNT(*) as transactions, COALESCE(SUM(final_amount), 0) as expected_cash,
                        MIN(created_at) as first_sale, MAX(created_at) as last_sale
                 FROM sales
                 WHERE DATE(created_at) = ? AND payment_method = 'cash' AND payment_status = 'completed'`, [date]);
            const [voided] = await conn.execute(
                `SELECT COUNT(*) as c FROM sales WHERE DATE(created_at) = ? AND payment_status = 'voided'`, [date]);
            const [existing] = await conn.execute(
                `SELECT cr.*, u.full_name as counted_by_name FROM cash_reconciliations cr
                 LEFT JOIN users u ON cr.counted_by = u.id WHERE cr.business_date = ?`, [date]);
            res.json({
                success: true,
                data: {
                    date,
                    expected_cash: parseFloat(sales[0].expected_cash) || 0,
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
        const bizDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
        const counted = parseFloat(counted_cash);
        if (isNaN(counted) || counted < 0) {
            return res.status(400).json({ success: false, message: 'Counted cash must be a valid amount' });
        }
        const conn = await pool.getConnection();
        try {
            const [sales] = await conn.execute(
                `SELECT COALESCE(SUM(final_amount), 0) as expected FROM sales
                 WHERE DATE(created_at) = ? AND payment_method = 'cash' AND payment_status = 'completed'`, [bizDate]);
            const expected = parseFloat(sales[0].expected) || 0;
            const discrepancy = Math.round((counted - expected) * 100) / 100;
            await conn.execute(
                `INSERT INTO cash_reconciliations (business_date, expected_cash, counted_cash, discrepancy, notes, counted_by)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE expected_cash = VALUES(expected_cash), counted_cash = VALUES(counted_cash),
                     discrepancy = VALUES(discrepancy), notes = VALUES(notes), counted_by = VALUES(counted_by)`,
                [bizDate, expected, counted, discrepancy, (notes || '').slice(0, 500) || null, req.user.id]);
            logAudit(req.user.id, 'create', 'cash_reconciliations', null, null, { date: bizDate, expected, counted, discrepancy }, req.ip);
            res.json({ success: true, data: { date: bizDate, expected_cash: expected, counted_cash: counted, discrepancy } });
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
                `SELECT cr.*, u.full_name as counted_by_name FROM cash_reconciliations cr
                 LEFT JOIN users u ON cr.counted_by = u.id
                 ORDER BY cr.business_date DESC LIMIT 30`);
            res.json({ success: true, data: rows });
        } finally { conn.release(); }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error loading reconciliation history' });
    }
};

exports.updateSale = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const oldSale = await Sale.findById(id);
        const sale = await Sale.update(id, updateData);

        if (!sale) {
            return res.status(404).json({
                success: false,
                message: 'Sale not found'
            });
        }

        logAudit(req.user.id, 'update', 'sales', parseInt(id), oldSale, updateData, req.ip);

        res.status(200).json({
            success: true,
            message: 'Sale updated successfully',
            data: sale
        });
    } catch (error) {
        console.error('Update sale error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating sale'
        });
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

exports.getWeeklySales = async (req, res) => {
    try {
        const weeks = parseInt(req.query.weeks) || 12;
        const sales = await Sale.getWeeklySales(weeks);
        res.status(200).json({
            success: true,
            data: sales
        });
    } catch (error) {
        console.error('Get weekly sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving weekly sales'
        });
    }
};

exports.getMonthlySales = async (req, res) => {
    try {
        const months = parseInt(req.query.months) || 12;
        const sales = await Sale.getMonthlySales(months);
        res.status(200).json({
            success: true,
            data: sales
        });
    } catch (error) {
        console.error('Get monthly sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving monthly sales'
        });
    }
};

exports.getTotalSales = async (req, res) => {
    try {
        const total = await Sale.getTotalSales();
        res.status(200).json({
            success: true,
            data: { total_sales: total }
        });
    } catch (error) {
        console.error('Get total sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving total sales'
        });
    }
};

exports.getSalesReport = async (req, res) => {
    try {
        const { period, date_from, date_to } = req.query;
        const startDate = date_from || null;
        const endDate = date_to || null;
        const report = await Sale.getSalesReport(period || 'daily', startDate, endDate);
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

exports.getTopProducts = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const topProducts = await Sale.getTopProducts(limit);
        res.status(200).json({
            success: true,
            data: topProducts
        });
    } catch (error) {
        console.error('Get top products error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving top products'
        });
    }
};
