const Product = require('../models/Product');
const Sale = require('../models/Sale');
const User = require('../models/User');

exports.getDashboardStats = async (req, res) => {
    try {
        /* Counted by the database. This used to read every product (pictures
           included) and every sale on record just to count them, on every
           visit: it was the slowest request in the system. The counts come
           from the same two queries the Inventory and Sales history pages
           use, so the pages cannot disagree. */
        const [stock, sales, users, recentSales] = await Promise.all([
            Product.getStats(),
            Sale.getStats(),
            User.getAll(),
            Sale.getAll({ limit: 10 })
        ]);

        const total_products = Number(stock.total) || 0;
        // completed sales only; voided ones are reported beside them
        const total_sales = Number(sales.transactions) || 0;
        const voided_sales = Number(sales.voided) || 0;
        const total_sales_amount = sales.revenue || 0;
        // at or below the reorder level, out of stock included
        const low_stock_count = Number(stock.reorder_count) || 0;
        const expiring_count = Number(stock.expiring_count) || 0;
        const overstock_count = Number(stock.overstock_count) || 0;
        const active_users = users ? users.filter(u => u.is_active !== false).length : 0;

        const alerts = [];
        if (low_stock_count > 0) {
            alerts.push({ type: 'warning', message: `${low_stock_count} product(s) are at or below reorder level` });
        }
        if (expiring_count > 0) {
            alerts.push({ type: 'warning', message: `${expiring_count} product(s) are expiring within 30 days` });
        }
        if (overstock_count > 0) {
            alerts.push({ type: 'info', message: `${overstock_count} product(s) are over their maximum stock level` });
        }

        res.status(200).json({
            success: true,
            data: {
                total_products,
                active_products: total_products,
                total_sales,
                voided_sales,
                total_sales_amount,
                low_stock_count,
                expiring_count,
                overstock_count,
                active_users,
                recent_sales: recentSales || [],
                alerts
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving dashboard statistics'
        });
    }
};

exports.getExpirationRisk = async (req, res) => {
    const pool = require('../config/database');
    const conn = await pool.getConnection();
    try {
        const [critical] = await conn.execute(
            `SELECT p.*, DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expiration_date, c.name as category_name, s.name as supplier_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.expiration_date IS NOT NULL
             AND p.expiration_date <= DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')), INTERVAL 30 DAY)
             AND p.expiration_date >= DATE(CONVERT_TZ(NOW(),'+00:00','+08:00'))
             AND p.is_active = TRUE
             ORDER BY p.expiration_date ASC`
        );

        const [warning] = await conn.execute(
            `SELECT p.*, DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expiration_date, c.name as category_name, s.name as supplier_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.expiration_date IS NOT NULL
             AND p.expiration_date > DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')), INTERVAL 30 DAY)
             AND p.expiration_date <= DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')), INTERVAL 60 DAY)
             AND p.is_active = TRUE
             ORDER BY p.expiration_date ASC`
        );

        const [notice] = await conn.execute(
            `SELECT p.*, DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expiration_date, c.name as category_name, s.name as supplier_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.expiration_date IS NOT NULL
             AND p.expiration_date > DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')), INTERVAL 60 DAY)
             AND p.expiration_date <= DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')), INTERVAL 90 DAY)
             AND p.is_active = TRUE
             ORDER BY p.expiration_date ASC`
        );

        res.status(200).json({
            success: true,
            data: {
                critical: { count: critical.length, products: critical },
                warning: { count: warning.length, products: warning },
                notice: { count: notice.length, products: notice },
                total: critical.length + warning.length + notice.length
            }
        });
    } catch (error) {
        console.error('Get expiration risk error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving expiration risk data'
        });
    } finally {
        conn.release();
    }
};

exports.getChartData = async (req, res) => {
    const pool = require('../config/database');
    let conn;
    try {
        const { period } = req.query;

        let salesData;
        switch (period) {
            case 'weekly':
                salesData = await Sale.getWeeklySales(12);
                break;
            case 'monthly':
                salesData = await Sale.getMonthlySales(12);
                break;
            default:
                salesData = await Sale.getDailySales(30);
        }

        conn = await pool.getConnection();

        const [categories] = await conn.execute(
            `SELECT c.name as label, COUNT(p.id) as value
             FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.is_active = TRUE
             GROUP BY c.id ORDER BY c.name`
        );

        // the same counts the Inventory page shows, from the same query
        const stock = await Product.getStats();

        res.status(200).json({
            success: true,
            data: {
                sales: salesData || [],
                category_breakdown: categories || [],
                stock_status: {
                    in_stock: Number(stock.in_count) || 0,
                    low_stock: Number(stock.low_count) || 0,
                    out_of_stock: Number(stock.out_count) || 0,
                    expiring: Number(stock.expiring_count) || 0,
                    expired: Number(stock.expired_count) || 0
                }
            }
        });
    } catch (error) {
        console.error('Get chart data error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving chart data'
        });
    } finally {
        if (conn) conn.release();
    }
};
