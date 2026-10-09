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

    /* findByUsername/findByEmail deliberately ignore deactivated accounts —
       they gate sign-in. Uniqueness is a different question: the UNIQUE index
       covers every row, active or not, so a "is this name free?" check has to
       see deactivated rows too or it will promise a name the INSERT rejects. */
    static async findAnyByUsername(username) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, username, email, full_name, is_active FROM users WHERE username = ?',
                [username]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async findAnyByEmail(email) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, username, email, full_name, is_active FROM users WHERE email = ?',
                [email]
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
                // token_version is needed to mint a replacement JWT after a
                // password change; without it the new token stamps 0 against a
                // freshly-bumped row and locks the user straight back out.
                'SELECT id, username, email, full_name, avatar, role, phone, address, is_active, token_version, UNIX_TIMESTAMP(created_at) * 1000 as created_at FROM users WHERE id = ?',
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async findByIdWithPassword(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM users WHERE id = ? AND is_active = TRUE',
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async getAll(includeInactive = false) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT u.id, u.username, u.email, u.full_name, u.role, u.phone, u.address, u.is_active, u.email_verified, u.supplier_id, s.name AS supplier_name, UNIX_TIMESTAMP(u.created_at) * 1000 as created_at FROM users u LEFT JOIN suppliers s ON s.id = u.supplier_id' +
                (includeInactive ? '' : ' WHERE u.is_active = TRUE') +
                ' ORDER BY u.created_at DESC'
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    /** The supplier a login is tied to, or null. */
    static async getSupplierId(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute('SELECT supplier_id FROM users WHERE id = ?', [id]);
            return rows[0] ? rows[0].supplier_id : null;
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
                `INSERT INTO users (username, email, password, full_name, role, phone, address, is_active, supplier_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userData.username || userData.email.split('@')[0],
                    userData.email,
                    hashedPassword,
                    userData.full_name,
                    userData.role || 'staff',
                    userData.phone || null,
                    userData.address || null,
                    userData.is_active !== undefined ? userData.is_active : true,
                    userData.supplier_id || null
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
                'email', 'full_name', 'role', 'phone', 'address', 'is_active', 'avatar', 'supplier_id'
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
