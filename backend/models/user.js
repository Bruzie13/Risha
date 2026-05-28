const pool = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
    static async findByEmail(email) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
                [email]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async findByUsername(username) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM users WHERE username = ? AND is_active = TRUE',
                [username]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async findById(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, username, email, full_name, role, phone, address, is_active, created_at FROM users WHERE id = ?',
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async getAll() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, username, email, full_name, role, phone, address, is_active, created_at FROM users WHERE is_active = TRUE ORDER BY created_at DESC'
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getAllStaff() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                "SELECT id, username, email, full_name, role, phone, is_active FROM users WHERE role IN ('staff', 'admin') AND is_active = TRUE ORDER BY full_name"
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async create(userData) {
        const connection = await pool.getConnection();
        try {
            const hashedPassword = await bcrypt.hash(userData.password, 10);

            const [result] = await connection.execute(
                `INSERT INTO users (username, email, password, full_name, role, phone, address, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userData.username || userData.email.split('@')[0],
                    userData.email,
                    hashedPassword,
                    userData.full_name,
                    userData.role || 'staff',
                    userData.phone || null,
                    userData.address || null,
                    userData.is_active !== undefined ? userData.is_active : true
                ]
            );

            return {
                id: result.insertId,
                username: userData.username || userData.email.split('@')[0],
                email: userData.email,
                full_name: userData.full_name,
                role: userData.role || 'staff'
            };
        } finally {
            connection.release();
        }
    }

    static async update(id, userData) {
        const connection = await pool.getConnection();
        try {
            const fields = [];
            const params = [];
            const allowedFields = [
                'email', 'full_name', 'role', 'phone', 'address', 'is_active'
            ];

            for (const field of allowedFields) {
                if (userData[field] !== undefined) {
                    fields.push(`${field} = ?`);
                    params.push(userData[field]);
                }
            }

            if (userData.password) {
                const hashedPassword = await bcrypt.hash(userData.password, 10);
                fields.push('password = ?');
                params.push(hashedPassword);
            }

            if (fields.length === 0) return null;

            params.push(id);
            await connection.execute(
                `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
                params
            );
            return await this.findById(id);
        } finally {
            connection.release();
        }
    }

    static async updateRole(id, role) {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'UPDATE users SET role = ? WHERE id = ?',
                [role, id]
            );
            return await this.findById(id);
        } finally {
            connection.release();
        }
    }

    static async updateStatus(id, isActive) {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'UPDATE users SET is_active = ? WHERE id = ?',
                [isActive, id]
            );
            return await this.findById(id);
        } finally {
            connection.release();
        }
    }

    static async delete(id) {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'UPDATE users SET is_active = FALSE WHERE id = ?',
                [id]
            );
            return true;
        } finally {
            connection.release();
        }
    }

    static async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }
}

module.exports = User;
