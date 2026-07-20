const pool = require('../config/database');

class Sale {
    // Shared date/search WHERE, used by getAll, countAll and getStats so the
    // page, its total and its stat cards all cover the same rows.
    static _filterWhere(filters, params) {
        const conditions = [];
        const from = filters.startDate || filters.date_from;
        const to = filters.endDate || filters.date_to;
        if (from) { conditions.push('DATE(s.created_at) >= ?'); params.push(from); }
        if (to) { conditions.push('DATE(s.created_at) <= ?'); params.push(to); }
        if (filters.search) {
            conditions.push('(CAST(s.id AS CHAR) LIKE ? OR s.sale_number LIKE ? OR u.full_name LIKE ?)');
            const like = `%${filters.search}%`;
            params.push(like, like, like);
        }
        return conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    }

    static async getAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            const params = [];
            let sql = `SELECT s.id, s.sale_number, s.customer_name, s.customer_phone, s.total_amount, s.discount,
                        s.final_amount, s.payment_method, s.payment_status, s.notes, s.created_by,
                        UNIX_TIMESTAMP(s.created_at) * 1000 as created_at,
                        UNIX_TIMESTAMP(s.updated_at) * 1000 as updated_at,
                        u.full_name as staff_name,
                 (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
                 FROM sales s
                 LEFT JOIN users u ON s.created_by = u.id`;
            sql += Sale._filterWhere(filters, params);
            sql += ' ORDER BY s.created_at DESC';

            // LIMIT/OFFSET inlined (parseInt-sanitized) — mysql2 rejects them as
            // placeholders.
            const lim = parseInt(filters.limit);
            if (Number.isInteger(lim) && lim > 0) {
                sql += ' LIMIT ' + lim;
                const off = parseInt(filters.offset);
                if (Number.isInteger(off) && off > 0) sql += ' OFFSET ' + off;
            }

            const [rows] = await connection.execute(sql, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    static async countAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            const params = [];
            let sql = 'SELECT COUNT(*) as total FROM sales s LEFT JOIN users u ON s.created_by = u.id';
            sql += Sale._filterWhere(filters, params);
            const [rows] = await connection.execute(sql, params);
            return rows[0].total;
        } finally {
            connection.release();
        }
    }

    // Count + revenue for the filtered range (non-voided), plus today's revenue,
    // so the sales-history stat cards never need the whole table.
    static async getStats(filters = {}) {
        const connection = await pool.getConnection();
        try {
            const params = [];
            let sql = `SELECT COUNT(*) AS transactions,
                        COALESCE(SUM(CASE WHEN s.payment_status <> 'voided' THEN s.total_amount ELSE 0 END), 0) AS revenue,
                        COALESCE(SUM(CASE WHEN s.payment_status <> 'voided' AND DATE(s.created_at) = CURDATE() THEN s.total_amount ELSE 0 END), 0) AS today_revenue
                       FROM sales s LEFT JOIN users u ON s.created_by = u.id`;
            sql += Sale._filterWhere(filters, params);
            const [rows] = await connection.execute(sql, params);
            return rows[0];
        } finally {
            connection.release();
        }
    }

    static async findById(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT s.id, s.sale_number, s.customer_name, s.customer_phone, s.total_amount, s.discount,
                        s.final_amount, s.payment_method, s.payment_status, s.notes, s.created_by,
                        UNIX_TIMESTAMP(s.created_at) * 1000 as created_at,
                        UNIX_TIMESTAMP(s.updated_at) * 1000 as updated_at,
                        u.full_name as staff_name 
                 FROM sales s 
                 LEFT JOIN users u ON s.created_by = u.id 
                 WHERE s.id = ?`,
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async getSaleItems(saleId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT si.*, p.name as product_name, p.sku, p.unit_type 
                 FROM sale_items si 
                 JOIN products p ON si.product_id = p.id 
                 WHERE si.sale_id = ?`,
                [saleId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async create(saleData) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            for (const item of saleData.items) {
                const [rows] = await connection.execute(
                    'SELECT stock_quantity FROM products WHERE id = ? FOR UPDATE',
                    [item.product_id]
                );
                if (!rows.length || rows[0].stock_quantity < item.quantity) {
                    await connection.rollback();
                    const name = rows.length ? rows[0].name || `Product #${item.product_id}` : `Product #${item.product_id}`;
                    throw new Error(`Insufficient stock for ${name}. Available: ${rows[0]?.stock_quantity || 0}, requested: ${item.quantity}`);
                }
            }

            const saleNumber = 'SALE-' + Date.now();

            const [result] = await connection.execute(
                `INSERT INTO sales 
                 (sale_number, customer_name, customer_phone, total_amount, final_amount, 
                  discount, payment_method, payment_status, notes, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    saleNumber,
                    saleData.customer_name || null,
                    saleData.customer_phone || null,
                    saleData.total_amount,
                    saleData.final_amount || saleData.total_amount,
                    saleData.discount || 0,
                    saleData.payment_method || 'cash',
                    saleData.payment_status || 'completed',
                    saleData.notes || null,
                    saleData.created_by || saleData.staff_id || null
                ]
            );

            const saleId = result.insertId;

            for (const item of saleData.items) {
                await connection.execute(
                    `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        saleId,
                        item.product_id,
                        item.quantity,
                        item.unit_price,
                        item.subtotal || (item.quantity * item.unit_price)
                    ]
                );

                await connection.execute(
                    'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                    [item.quantity, item.product_id]
                );

                await connection.execute(
                    `INSERT INTO stock_movements 
                     (product_id, movement_type, quantity, reference_type, reference_id, notes) 
                     VALUES (?, 'out', ?, 'sale', ?, ?)`,
                    [
                        item.product_id,
                        -item.quantity,
                        saleId,
                        `Sale #${saleNumber}`
                    ]
                );
            }

            await connection.commit();
            return await this.findById(saleId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async update(id, saleData) {
        const connection = await pool.getConnection();
        try {
            const fields = [];
            const params = [];
            const allowedFields = [
                'customer_name', 'customer_phone', 'total_amount', 'final_amount',
                'payment_method', 'payment_status', 'notes', 'created_by'
            ];

            for (const field of allowedFields) {
                if (saleData[field] !== undefined) {
                    fields.push(`${field} = ?`);
                    params.push(saleData[field]);
                }
            }

            if (fields.length === 0) return null;

            params.push(id);
            await connection.execute(
                `UPDATE sales SET ${fields.join(', ')} WHERE id = ?`,
                params
            );
            return await this.findById(id);
        } finally {
            connection.release();
        }
    }

    static async delete(id) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const items = await this.getSaleItems(id);

            for (const item of items) {
                await connection.execute(
                    'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
                    [item.quantity, item.product_id]
                );

                await connection.execute(
                    `INSERT INTO stock_movements 
                     (product_id, movement_type, quantity, reference_type, reference_id, notes) 
                     VALUES (?, 'in', ?, 'sale_void', ?, ?)`,
                    [
                        item.product_id,
                        item.quantity,
                        id,
                        `Sale #${id} voided - stock restored`
                    ]
                );
            }

            await connection.execute('DELETE FROM sale_items WHERE sale_id = ?', [id]);
            await connection.execute('DELETE FROM sales WHERE id = ?', [id]);

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getDailySales(days) {
        const connection = await pool.getConnection();
        try {
            const interval = days || 30;
            const [rows] = await connection.execute(
                `SELECT DATE(created_at) as date, 
                 COUNT(*) as transaction_count, 
                 SUM(total_amount) as daily_total 
                 FROM sales 
                 WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                   AND payment_status <> 'voided'
                 GROUP BY DATE(created_at) 
                 ORDER BY date DESC`,
                [interval]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getWeeklySales(weeks) {
        const connection = await pool.getConnection();
        try {
            const interval = weeks || 12;
            const [rows] = await connection.execute(
                `SELECT YEAR(created_at) as year, 
                 WEEK(created_at) as week, 
                 COUNT(*) as transaction_count, 
                 SUM(total_amount) as weekly_total 
                 FROM sales 
                 WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? WEEK)
                   AND payment_status <> 'voided'
                 GROUP BY YEAR(created_at), WEEK(created_at) 
                 ORDER BY year DESC, week DESC`,
                [interval]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getMonthlySales(months) {
        const connection = await pool.getConnection();
        try {
            const interval = months || 12;
            const [rows] = await connection.execute(
                `SELECT YEAR(created_at) as year, 
                 MONTH(created_at) as month, 
                 COUNT(*) as transaction_count, 
                 SUM(total_amount) as monthly_total 
                 FROM sales 
                 WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
                   AND payment_status <> 'voided'
                 GROUP BY YEAR(created_at), MONTH(created_at) 
                 ORDER BY year DESC, month DESC`,
                [interval]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getTotalSales() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                "SELECT SUM(total_amount) as total FROM sales WHERE payment_status <> 'voided'"
            );
            return rows[0].total || 0;
        } finally {
            connection.release();
        }
    }

    // Void a sale: restores the stock and marks the record (kept for audit —
    // deleting sales history hides mistakes instead of documenting them).
    static async void(id, reason) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute(
                'SELECT payment_status FROM sales WHERE id = ? FOR UPDATE', [id]);
            if (!rows.length) { await connection.rollback(); return { error: 'Sale not found' }; }
            if (rows[0].payment_status === 'voided') { await connection.rollback(); return { error: 'Sale is already voided' }; }

            const [items] = await connection.execute(
                'SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', [id]);
            for (const item of items) {
                await connection.execute(
                    'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
                    [item.quantity, item.product_id]);
            }
            await connection.execute(
                `UPDATE sales SET payment_status = 'voided',
                        notes = CONCAT(COALESCE(CONCAT(notes, ' | '), ''), 'VOIDED: ', ?)
                 WHERE id = ?`, [reason || 'no reason given', id]);
            await connection.commit();
            return { success: true, items_restored: items.length };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    static async getSalesByDateRange(startDate, endDate) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT s.*, u.full_name as staff_name,
                 (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
                 FROM sales s 
                 LEFT JOIN users u ON s.created_by = u.id 
                 WHERE DATE(s.created_at) BETWEEN ? AND ?
                 ORDER BY s.created_at DESC`,
                [startDate, endDate]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getTopProducts(limit) {
        const connection = await pool.getConnection();
        try {
            const maxLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
            const [rows] = await connection.execute(
                `SELECT p.id, p.name, p.sku, p.unit_price,
                 COALESCE(SUM(si.quantity), 0) as total_quantity_sold,
                 COALESCE(SUM(si.subtotal), 0) as total_revenue
                 FROM products p
                 LEFT JOIN sale_items si ON si.product_id = p.id
                 LEFT JOIN sales s ON si.sale_id = s.id AND s.payment_status <> 'voided'
                 GROUP BY p.id
                 ORDER BY total_quantity_sold DESC
                 LIMIT ${maxLimit}`
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getSalesReport(period = 'daily', startDate = null, endDate = null) {
        const connection = await pool.getConnection();
        try {
            let sql, topSql;
            const params = [];
            const topParams = [];
            let dateFilter = "WHERE s.payment_status <> 'voided'";
            let dateParams = [];

            if (startDate && endDate) {
                dateFilter = "WHERE DATE(s.created_at) BETWEEN ? AND ? AND s.payment_status <> 'voided'";
                dateParams = [startDate, endDate];
            }

            if (period === 'daily') {
                sql = `SELECT DATE(s.created_at) as date,
                              COUNT(*) as total_sales,
                              SUM(s.total_amount) as total_amount,
                              COALESCE(SUM(si.quantity), 0) as item_count
                       FROM sales s
                       LEFT JOIN sale_items si ON si.sale_id = s.id
                       ${dateFilter}
                       GROUP BY DATE(s.created_at)
                       ORDER BY date DESC`;
                params.push(...dateParams);
                topSql = `SELECT p.name, SUM(si.quantity) as quantity
                          FROM sale_items si
                          JOIN products p ON si.product_id = p.id
                          JOIN sales s ON si.sale_id = s.id
                          ${dateFilter}
                          GROUP BY p.id
                          ORDER BY quantity DESC
                          LIMIT 5`;
                if (startDate && endDate) topParams.push(startDate, endDate);
            } else if (period === 'weekly') {
                sql = `SELECT ANY_VALUE(CONCAT(YEAR(s.created_at), '-W', LPAD(WEEK(s.created_at), 2, '0'))) as week,
                              YEAR(s.created_at) as year,
                              WEEK(s.created_at) as week_number,
                              COUNT(*) as total_sales,
                              SUM(s.total_amount) as total_amount
                       FROM sales s
                       ${dateFilter}
                       GROUP BY YEAR(s.created_at), WEEK(s.created_at)
                       ORDER BY year DESC, week_number DESC`;
                params.push(...dateParams);
                topSql = `SELECT p.name, SUM(si.quantity) as quantity
                          FROM sale_items si
                          JOIN products p ON si.product_id = p.id
                          JOIN sales s ON si.sale_id = s.id
                          ${dateFilter}
                          GROUP BY p.id
                          ORDER BY quantity DESC
                          LIMIT 5`;
                if (startDate && endDate) topParams.push(startDate, endDate);
            } else if (period === 'monthly') {
                sql = `SELECT ANY_VALUE(DATE_FORMAT(s.created_at, '%Y-%m')) as month,
                              ANY_VALUE(MONTHNAME(s.created_at)) as month_name,
                              YEAR(s.created_at) as year,
                              MONTH(s.created_at) as month_number,
                              COUNT(*) as total_transactions,
                              SUM(s.total_amount) as total_amount
                       FROM sales s
                       ${dateFilter}
                       GROUP BY YEAR(s.created_at), MONTH(s.created_at)
                       ORDER BY year DESC, month_number DESC`;
                params.push(...dateParams);
                topSql = `SELECT p.name, SUM(si.quantity) as quantity
                          FROM sale_items si
                          JOIN products p ON si.product_id = p.id
                          JOIN sales s ON si.sale_id = s.id
                          ${dateFilter}
                          GROUP BY p.id
                          ORDER BY quantity DESC
                          LIMIT 5`;
                if (startDate && endDate) topParams.push(startDate, endDate);
            } else {
                return { rows: [], top_products: [] };
            }

            const [rows] = await connection.execute(sql, params);
            const [topProducts] = await connection.execute(topSql, topParams);
            const summary = await this.getSalesReportSummary(startDate, endDate);

            return {
                rows: rows || [],
                top_products: topProducts || [],
                summary
            };
        } finally {
            connection.release();
        }
    }

    static async getSalesReportSummary(startDate = null, endDate = null) {
        const connection = await pool.getConnection();
        try {
            let dateFilter = "WHERE s.payment_status <> 'voided'";
            const params = [];
            if (startDate && endDate) {
                dateFilter = "WHERE DATE(s.created_at) BETWEEN ? AND ? AND s.payment_status <> 'voided'";
                params.push(startDate, endDate);
            }

            const [revenueRows] = await connection.execute(
                `SELECT COUNT(*) as total_transactions,
                        COALESCE(SUM(s.total_amount), 0) as total_revenue,
                        COALESCE(SUM(si.quantity), 0) as total_items_sold
                 FROM sales s
                 LEFT JOIN sale_items si ON si.sale_id = s.id
                 ${dateFilter}`,
                params
            );

            const [paymentRows] = await connection.execute(
                `SELECT s.payment_method,
                        COUNT(*) as count,
                        COALESCE(SUM(s.total_amount), 0) as total
                 FROM sales s
                 ${dateFilter}
                 GROUP BY s.payment_method
                 ORDER BY total DESC`,
                params
            );

            const [categoryRows] = await connection.execute(
                `SELECT c.name as category_name,
                        COALESCE(SUM(si.subtotal), 0) as total_revenue,
                        COALESCE(SUM(si.quantity), 0) as total_quantity
                 FROM sale_items si
                 JOIN products p ON si.product_id = p.id
                 JOIN categories c ON p.category_id = c.id
                 JOIN sales s ON si.sale_id = s.id
                 ${dateFilter}
                 GROUP BY c.id, c.name
                 ORDER BY total_revenue DESC`,
                params
            );

            const r = revenueRows[0] || {};
            return {
                total_transactions: r.total_transactions || 0,
                total_revenue: parseFloat(r.total_revenue) || 0,
                total_items_sold: r.total_items_sold || 0,
                avg_transaction_value: r.total_transactions > 0
                    ? parseFloat((r.total_revenue / r.total_transactions).toFixed(2))
                    : 0,
                payment_breakdown: paymentRows || [],
                category_breakdown: categoryRows || []
            };
        } finally {
            connection.release();
        }
    }
}

module.exports = Sale;
