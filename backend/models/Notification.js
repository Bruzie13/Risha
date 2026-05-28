const pool = require('../config/database');

class Notification {
    static async getAll() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM notifications ORDER BY created_at DESC'
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getUnread() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                "SELECT * FROM notifications WHERE is_read = FALSE ORDER BY created_at DESC"
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async create(notifData) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO notifications (type, title, message, product_id) 
                 VALUES (?, ?, ?, ?)`,
                [
                    notifData.type || 'info',
                    notifData.title,
                    notifData.message,
                    notifData.product_id || null
                ]
            );
            return { id: result.insertId, ...notifData };
        } finally {
            connection.release();
        }
    }

    static async markAsRead(id) {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'UPDATE notifications SET is_read = TRUE WHERE id = ?',
                [id]
            );
            return true;
        } finally {
            connection.release();
        }
    }

    static async markAllAsRead() {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE'
            );
            return true;
        } finally {
            connection.release();
        }
    }

    static async delete(id) {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'DELETE FROM notifications WHERE id = ?',
                [id]
            );
            return true;
        } finally {
            connection.release();
        }
    }

    static async getAlerts() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT * FROM notifications 
                 WHERE type IN ('alert', 'warning', 'critical') 
                 AND is_read = FALSE 
                 ORDER BY created_at DESC`
            );
            return rows;
        } finally {
            connection.release();
        }
    }
}

module.exports = Notification;
