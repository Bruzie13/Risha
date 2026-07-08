const pool = require('../config/database');

class SupplierPerformance {
    static async getBySupplier(supplierId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT sp.id, sp.supplier_id, sp.order_id, sp.metric_type, sp.metric_value, sp.notes,
                        UNIX_TIMESTAMP(sp.created_at) * 1000 as created_at, po.po_number 
                 FROM supplier_performance sp 
                 LEFT JOIN purchase_orders po ON sp.order_id = po.id 
                 WHERE sp.supplier_id = ? 
                 ORDER BY sp.created_at DESC`,
                [supplierId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async addMetric(supplierId, orderId, metricType, metricValue, notes) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO supplier_performance (supplier_id, order_id, metric_type, metric_value, notes) 
                 VALUES (?, ?, ?, ?, ?)`,
                [supplierId, orderId || null, metricType, metricValue || null, notes || null]
            );
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    static async getSupplierRating(supplierId) {
        const connection = await pool.getConnection();
        try {
            const [deliveryTime] = await connection.execute(
                `SELECT AVG(metric_value) as avg_delivery_days 
                 FROM supplier_performance 
                 WHERE supplier_id = ? AND metric_type = 'delivery_time'`,
                [supplierId]
            );

            const [onTime] = await connection.execute(
                `SELECT 
                    COUNT(*) as total_deliveries,
                    SUM(CASE WHEN metric_value = 1 THEN 1 ELSE 0 END) as on_time_count
                 FROM supplier_performance 
                 WHERE supplier_id = ? AND metric_type = 'on_time_delivery'`,
                [supplierId]
            );

            const [totalOrders] = await connection.execute(
                `SELECT COUNT(DISTINCT order_id) as total_orders 
                 FROM supplier_performance 
                 WHERE supplier_id = ? AND order_id IS NOT NULL`,
                [supplierId]
            );

            const onTimePct = onTime[0].total_deliveries > 0
                ? ((onTime[0].on_time_count / onTime[0].total_deliveries) * 100)
                : 0;

            return {
                avg_delivery_days: deliveryTime[0].avg_delivery_days
                    ? parseFloat(deliveryTime[0].avg_delivery_days).toFixed(2)
                    : null,
                on_time_delivery_pct: parseFloat(onTimePct).toFixed(1),
                total_deliveries: onTime[0].total_deliveries,
                total_orders: totalOrders[0].total_orders
            };
        } finally {
            connection.release();
        }
    }
}

module.exports = SupplierPerformance;
