const pool = require('../config/database');

class AuditLog {
    static async create(logData) {
        const connection = await pool.getConnection();
        try {
            const sql = `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value, ip_address) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const vals = [
                logData.user_id || null,
                logData.action,
                logData.table_name,
                logData.record_id || null,
                logData.old_value ? JSON.stringify(logData.old_value) : null,
                logData.new_value ? JSON.stringify(logData.new_value) : null,
                logData.ip_address || null
            ];
            const [result] = await connection.execute(sql, vals);
            return { id: result.insertId, ...logData };
        } finally {
            connection.release();
        }
    }

    static async getAll(limit = 100, offset = 0) {
        const connection = await pool.getConnection();
        try {
            const sql = `SELECT al.*, u.full_name as user_name 
                 FROM audit_logs al 
                 LEFT JOIN users u ON al.user_id = u.id 
                 ORDER BY al.created_at DESC 
                 LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
            const [rows] = await connection.query(sql);
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getByFilters(filters, limit = 100, offset = 0) {
        const connection = await pool.getConnection();
        try {
            const conditions = [];
            const params = [];

            if (filters.action) {
                conditions.push('al.action = ?');
                params.push(filters.action);
            }
            if (filters.table_name) {
                conditions.push('al.table_name = ?');
                params.push(filters.table_name);
            }

            const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
            const safeLimit = parseInt(limit);
            const safeOffset = parseInt(offset);

            let sql = `SELECT al.*, u.full_name as user_name 
                 FROM audit_logs al 
                 LEFT JOIN users u ON al.user_id = u.id 
                 ${whereClause}
                 ORDER BY al.created_at DESC 
                 LIMIT ${safeLimit} OFFSET ${safeOffset}`;

            if (params.length) {
                const [rows] = await connection.execute(sql, params);
                return rows;
            } else {
                const [rows] = await connection.query(sql);
                return rows;
            }
        } finally {
            connection.release();
        }
    }

    static async count(filters) {
        const connection = await pool.getConnection();
        try {
            const conditions = [];
            const params = [];

            if (filters.action) {
                conditions.push('action = ?');
                params.push(filters.action);
            }
            if (filters.table_name) {
                conditions.push('table_name = ?');
                params.push(filters.table_name);
            }

            const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
            const sql = `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`;

            let rows;
            if (params.length) {
                [rows] = await connection.execute(sql, params);
            } else {
                [rows] = await connection.query(sql);
            }
            return rows[0].total;
        } finally {
            connection.release();
        }
    }

    static async getByTable(tableName, recordId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT al.*, u.full_name as user_name 
                 FROM audit_logs al 
                 LEFT JOIN users u ON al.user_id = u.id 
                 WHERE al.table_name = ? AND al.record_id = ? 
                 ORDER BY al.created_at DESC`,
                [tableName, recordId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getByUser(userId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT al.*, u.full_name as user_name 
                 FROM audit_logs al 
                 LEFT JOIN users u ON al.user_id = u.id 
                 WHERE al.user_id = ? 
                 ORDER BY al.created_at DESC`,
                [userId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }
}

module.exports = AuditLog;
