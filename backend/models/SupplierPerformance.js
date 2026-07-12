const pool = require('../config/database');

class SupplierPerformance {
    // Performance history is derived from the purchase orders the system
    // actually creates (auto-reorder → status lifecycle), not a separate table
    // that nobody feeds. Each PO is one row of the supplier's track record.
    static async getBySupplier(supplierId) {
        const connection = await pool.getConnection();
        try {
            // Join the PO's tracked email so we know if the SUPPLIER confirmed
            // it (clicked the confirm link) or merely viewed it — separate from
            // the shop-set fulfillment status.
            const [rows] = await connection.execute(
                `SELECT po.id, po.po_number, po.status, po.total_amount,
                        po.order_date, po.expected_delivery_date,
                        UNIX_TIMESTAMP(po.created_at) * 1000 as created_at,
                        UNIX_TIMESTAMP(po.updated_at) * 1000 as updated_at,
                        DATEDIFF(po.updated_at, po.order_date) as lead_days,
                        MAX(el.clicked_at IS NOT NULL) as confirmed,
                        MAX(el.opened_at IS NOT NULL) as viewed
                 FROM purchase_orders po
                 LEFT JOIN email_logs el
                        ON el.email_type = 'po'
                       AND el.subject LIKE CONCAT('%', po.po_number, '%')
                 WHERE po.supplier_id = ?
                 GROUP BY po.id
                 ORDER BY po.created_at DESC`,
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

    // Rating computed from the supplier's purchase orders. Everything here is
    // real data the system produced — no manual entry required.
    static async getSupplierRating(supplierId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT
                    COUNT(*) AS total_orders,
                    SUM(status = 'received') AS received,
                    SUM(status = 'pending') AS pending,
                    SUM(status = 'shipped') AS shipped,
                    SUM(status = 'cancelled') AS cancelled,
                    SUM(CASE WHEN status = 'received' THEN total_amount ELSE 0 END) AS total_value,
                    AVG(CASE WHEN status = 'received' THEN DATEDIFF(updated_at, order_date) END) AS avg_lead_days,
                    SUM(CASE WHEN status = 'received' AND expected_delivery_date IS NOT NULL
                             AND updated_at <= expected_delivery_date THEN 1 ELSE 0 END) AS on_time_count,
                    SUM(CASE WHEN status = 'received' AND expected_delivery_date IS NOT NULL THEN 1 ELSE 0 END) AS datable_deliveries,
                    SUM(EXISTS(SELECT 1 FROM email_logs el WHERE el.email_type = 'po'
                              AND el.subject LIKE CONCAT('%', po.po_number, '%')
                              AND el.clicked_at IS NOT NULL)) AS confirmed_count,
                    SUM(status = 'received' AND NOT EXISTS(SELECT 1 FROM email_logs el WHERE el.email_type = 'po'
                              AND el.subject LIKE CONCAT('%', po.po_number, '%')
                              AND el.clicked_at IS NOT NULL)) AS received_unconfirmed
                 FROM purchase_orders po WHERE supplier_id = ?`,
                [supplierId]
            );
            const r = rows[0] || {};
            const totalOrders = Number(r.total_orders) || 0;
            const received = Number(r.received) || 0;
            const active = totalOrders - (Number(r.cancelled) || 0);
            const datable = Number(r.datable_deliveries) || 0;

            return {
                total_orders: totalOrders,
                total_deliveries: received,
                pending: Number(r.pending) || 0,
                shipped: Number(r.shipped) || 0,
                cancelled: Number(r.cancelled) || 0,
                total_value: parseFloat(r.total_value) || 0,
                // fulfillment: received out of non-cancelled orders
                fulfillment_pct: active > 0 ? parseFloat(((received / active) * 100).toFixed(1)) : null,
                avg_delivery_days: r.avg_lead_days != null ? parseFloat(Number(r.avg_lead_days).toFixed(1)) : null,
                // on-time only measurable when an expected date was set
                on_time_delivery_pct: datable > 0 ? parseFloat(((Number(r.on_time_count) / datable) * 100).toFixed(1)) : null,
                // supplier acknowledgement (from tracked PO emails)
                confirmed_count: Number(r.confirmed_count) || 0,
                confirmation_pct: totalOrders > 0 ? parseFloat(((Number(r.confirmed_count) / totalOrders) * 100).toFixed(1)) : null,
                received_unconfirmed: Number(r.received_unconfirmed) || 0,
                has_orders: totalOrders > 0
            };
        } finally {
            connection.release();
        }
    }
}

module.exports = SupplierPerformance;
