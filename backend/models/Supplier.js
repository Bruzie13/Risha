const pool = require('../config/database');

class Supplier {
    static async getAll() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM suppliers WHERE is_active = TRUE ORDER BY name'
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async findById(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM suppliers WHERE id = ? AND is_active = TRUE',
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async create(data) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO suppliers (name, email, phone, address, city, latitude, longitude, contact_person, payment_terms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.name,
                    data.email || null,
                    data.phone || null,
                    data.address || null,
                    data.city || null,
                    // a supplier with no pin stays off the map rather than at (0,0)
                    data.latitude == null || data.latitude === '' ? null : data.latitude,
                    data.longitude == null || data.longitude === '' ? null : data.longitude,
                    data.contact_person || null,
                    data.payment_terms || null
                ]
            );
            return await this.findById(result.insertId);
        } finally {
            connection.release();
        }
    }

    static async update(id, data) {
        const connection = await pool.getConnection();
        try {
            const fields = [];
            const params = [];
            const allowedFields = [
                'name', 'email', 'phone', 'address', 'city',
                'latitude', 'longitude',
                'contact_person', 'payment_terms', 'is_active'
            ];

            for (const field of allowedFields) {
                if (data[field] !== undefined) {
                    fields.push(`${field} = ?`);
                    params.push(data[field]);
                }
            }

            if (fields.length === 0) return null;

            params.push(id);
            await connection.execute(
                `UPDATE suppliers SET ${fields.join(', ')} WHERE id = ?`,
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
            await connection.execute(
                'UPDATE suppliers SET is_active = FALSE WHERE id = ?',
                [id]
            );
            return true;
        } finally {
            connection.release();
        }
    }
}

module.exports = Supplier;
