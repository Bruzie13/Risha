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
            payment_method: payment_method || 'cash',
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
