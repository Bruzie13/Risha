const pool = require('../config/database');

class Notification {
    static async getAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            let sql = `SELECT n.id, n.type, n.title, n.message, n.product_id, n.user_id, n.related_id, n.related_type, n.is_read,
                       UNIX_TIMESTAMP(n.created_at) * 1000 as created_at, p.name as product_name
                       FROM notifications n LEFT JOIN products p ON n.product_id = p.id`;
            const params = [];
            const conditions = [];

            if (filters.user_id) {
                conditions.push('(n.user_id = ? OR n.user_id IS NULL)');
                params.push(filters.user_id);
            }
            if (filters.type) {
                conditions.push('n.type = ?');
                params.push(filters.type);
            }
            if (filters.unread) {
                conditions.push('n.is_read = FALSE');
            }

            if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
            sql += ' ORDER BY n.created_at DESC';

            if (filters.limit) {
                const limitVal = parseInt(filters.limit);
                if (!isNaN(limitVal) && limitVal > 0) {
                    sql += ' LIMIT ' + limitVal;
                }
            }

            const [rows] = await connection.execute(sql, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getUnread(userId = null) {
        const connection = await pool.getConnection();
        try {
            let sql = `SELECT n.id, n.type, n.title, n.message, n.product_id, n.user_id, n.related_id, n.related_type, n.is_read,
                       UNIX_TIMESTAMP(n.created_at) * 1000 as created_at, p.name as product_name
                       FROM notifications n LEFT JOIN products p ON n.product_id = p.id WHERE n.is_read = FALSE`;
            const params = [];
            if (userId) {
                sql += ' AND (n.user_id = ? OR n.user_id IS NULL)';
                params.push(userId);
            }
            sql += ' ORDER BY n.created_at DESC';
            const [rows] = await connection.execute(sql, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getUnreadCount(userId = null) {
        const connection = await pool.getConnection();
        try {
            let sql = 'SELECT COUNT(*) as count FROM notifications WHERE is_read = FALSE';
            const params = [];
            if (userId) {
                sql += ' AND (user_id = ? OR user_id IS NULL)';
                params.push(userId);
            }
            const [rows] = await connection.execute(sql, params);
            return rows[0].count;
        } finally {
            connection.release();
        }
    }

    static async create(data) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO notifications (type, title, message, product_id, user_id, related_id, related_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.type || 'info',
                    data.title,
                    data.message,
                    data.product_id || null,
                    data.user_id || null,
                    data.related_id || null,
                    data.related_type || null
                ]
            );
            return { id: result.insertId, ...data };
        } finally {
            connection.release();
        }
    }

    static async markAsRead(id) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                'UPDATE notifications SET is_read = TRUE WHERE id = ?',
                [id]
            );
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    static async markAllAsRead(userId = null) {
        const connection = await pool.getConnection();
        try {
            let sql = 'UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE';
            const params = [];
            if (userId) {
                sql += ' AND (user_id = ? OR user_id IS NULL)';
                params.push(userId);
            }
            await connection.execute(sql, params);
            return true;
        } finally {
            connection.release();
        }
    }

    static async delete(id) {
        const connection = await pool.getConnection();
        try {
            await connection.execute('DELETE FROM notifications WHERE id = ?', [id]);
            return true;
        } finally {
            connection.release();
        }
    }

    static async deleteOld(days = 30) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                'DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) AND is_read = TRUE',
                [days]
            );
            return result.affectedRows;
        } finally {
            connection.release();
        }
    }

    static async getAlerts(userId = null) {
        const connection = await pool.getConnection();
        try {
            let sql = `SELECT n.id, n.type, n.title, n.message, n.product_id, n.user_id, n.related_id, n.related_type, n.is_read,
                       UNIX_TIMESTAMP(n.created_at) * 1000 as created_at, p.name as product_name
                       FROM notifications n
                       LEFT JOIN products p ON n.product_id = p.id
                       WHERE n.type IN ('low_stock', 'stockout', 'expiration')
                       AND n.is_read = FALSE`;
            const params = [];
            if (userId) {
                sql += ' AND (n.user_id = ? OR n.user_id IS NULL)';
                params.push(userId);
            }
            sql += ' ORDER BY n.created_at DESC';
            const [rows] = await connection.execute(sql, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getByProduct(productId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT n.id, n.type, n.title, n.message, n.product_id, n.user_id, n.related_id, n.related_type, n.is_read,
                 UNIX_TIMESTAMP(n.created_at) * 1000 as created_at, p.name as product_name
                 FROM notifications n
                 LEFT JOIN products p ON n.product_id = p.id
                 WHERE n.product_id = ?
                 ORDER BY n.created_at DESC`,
                [productId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }
}

module.exports = Notification;
