const Product = require('../models/Product');
const Sale = require('../models/Sale');
const User = require('../models/User');

exports.getDashboardStats = async (req, res) => {
    try {
        const [
            products,
            totalSalesAmount,
            lowStockProducts,
            expiringProducts,
            overstockProducts,
            users,
            recentSales
        ] = await Promise.all([
            Product.getAll(),
            Sale.getTotalSales(),
            Product.getLowStock(),
            Product.getExpiringSoon(30),
            Product.getOverstock(),
            User.getAll(),
            Sale.getAll()
        ]);

        const total_products = products ? products.length : 0;
        const total_sales = recentSales ? recentSales.length : 0;
        const total_sales_amount = totalSalesAmount || 0;
        const low_stock_count = lowStockProducts ? lowStockProducts.length : 0;
        const expiring_count = expiringProducts ? expiringProducts.length : 0;
        const overstock_count = overstockProducts ? overstockProducts.length : 0;
        const active_users = users ? users.filter(u => u.is_active !== false).length : 0;

        const alerts = [];
        if (low_stock_count > 0) {
            alerts.push({ type: 'warning', message: `${low_stock_count} product(s) are below reorder level` });
        }
        if (expiring_count > 0) {
            alerts.push({ type: 'warning', message: `${expiring_count} product(s) are expiring within 30 days` });
        }
        if (overstock_count > 0) {
            alerts.push({ type: 'info', message: `${overstock_count} product(s) are overstocked` });
        }

        res.status(200).json({
            success: true,
            data: {
                total_products,
                active_products: total_products,
                total_sales,
                total_sales_amount,
                low_stock_count,
                expiring_count,
                overstock_count,
                active_users,
                recent_sales: recentSales ? recentSales.slice(0, 10) : [],
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
            `SELECT p.*, c.name as category_name, s.name as supplier_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.expiration_date IS NOT NULL
             AND p.expiration_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             AND p.expiration_date >= CURDATE()
             AND p.is_active = TRUE
             ORDER BY p.expiration_date ASC`
        );

        const [warning] = await conn.execute(
            `SELECT p.*, c.name as category_name, s.name as supplier_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.expiration_date IS NOT NULL
             AND p.expiration_date > DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             AND p.expiration_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
             AND p.is_active = TRUE
             ORDER BY p.expiration_date ASC`
        );

        const [notice] = await conn.execute(
            `SELECT p.*, c.name as category_name, s.name as supplier_name
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.expiration_date IS NOT NULL
             AND p.expiration_date > DATE_ADD(CURDATE(), INTERVAL 60 DAY)
             AND p.expiration_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
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

        const [inStock] = await conn.execute(
            "SELECT COUNT(*) as count FROM products WHERE is_active = TRUE AND stock_quantity > reorder_level"
        );
        const [lowStock] = await conn.execute(
            "SELECT COUNT(*) as count FROM products WHERE is_active = TRUE AND stock_quantity > 0 AND stock_quantity <= reorder_level"
        );
        const [outOfStock] = await conn.execute(
            "SELECT COUNT(*) as count FROM products WHERE is_active = TRUE AND (stock_quantity = 0 OR stock_quantity IS NULL)"
        );

        res.status(200).json({
            success: true,
            data: {
                sales: salesData || [],
                category_breakdown: categories || [],
                stock_status: {
                    in_stock: inStock[0].count,
                    low_stock: lowStock[0].count,
                    out_of_stock: outOfStock[0].count
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
