const pool = require('../config/database');

class Notification {
    // Builds the shared "which rows can this user see + which filters" WHERE
    // clause used by getAll and countAll so the page and its total agree.
    static _scopeWhere(filters, params) {
        const conditions = [];
        if (filters.user_id) {
            conditions.push('(n.user_id = ? OR n.user_id IS NULL)');
            params.push(filters.user_id);
        }
        if (filters.type) {
            conditions.push('n.type = ?');
            params.push(filters.type);
        }
        if (filters.status === 'unread' || filters.unread) {
            conditions.push('n.is_read = FALSE');
        } else if (filters.status === 'read') {
            conditions.push('n.is_read = TRUE');
        }
        return conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    }

    static async getAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            const params = [];
            let sql = `SELECT n.id, n.type, n.title, n.message, n.product_id, n.user_id, n.related_id, n.related_type, n.is_read,
                       UNIX_TIMESTAMP(n.created_at) * 1000 as created_at, p.name as product_name
                       FROM notifications n LEFT JOIN products p ON n.product_id = p.id`;
            sql += Notification._scopeWhere(filters, params);
            sql += ' ORDER BY n.created_at DESC';

            // LIMIT/OFFSET are inlined (parseInt-sanitized) — mysql2 execute()
            // rejects placeholders there.
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
            let sql = 'SELECT COUNT(*) as total FROM notifications n';
            sql += Notification._scopeWhere(filters, params);
            const [rows] = await connection.execute(sql, params);
            return rows[0].total;
        } finally {
            connection.release();
        }
    }

    // Counts per type + total + unread, for the notifications-page summary,
    // so it never needs to load every row just to show the tallies.
    static async getSummary(userId = null) {
        const connection = await pool.getConnection();
        try {
            const params = [];
            let where = '';
            if (userId) { where = ' WHERE (user_id = ? OR user_id IS NULL)'; params.push(userId); }
            const [rows] = await connection.execute(
                `SELECT COUNT(*) AS total,
                        COALESCE(SUM(is_read = FALSE), 0) AS unread,
                        COALESCE(SUM(type = 'low_stock'), 0) AS low_stock,
                        COALESCE(SUM(type = 'stockout'), 0) AS stockout,
                        COALESCE(SUM(type = 'expiration'), 0) AS expiration,
                        COALESCE(SUM(type = 'info'), 0) AS info
                 FROM notifications n${where}`, params);
            return rows[0];
        } finally {
            connection.release();
        }
    }

    // Clear read notifications in the user's scope (their own + global). Used
    // by the "Clear read" button so the pile can actually shrink.
    static async deleteRead(userId = null) {
        const connection = await pool.getConnection();
        try {
            let sql = 'DELETE FROM notifications WHERE is_read = TRUE';
            const params = [];
            if (userId) { sql += ' AND (user_id = ? OR user_id IS NULL)'; params.push(userId); }
            const [result] = await connection.execute(sql, params);
            return result.affectedRows;
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
