const pool = require('../config/database');

class Supplier {
    static async getAll() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT s.*,
                        (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.is_active = TRUE) AS product_count,
                        (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id
                            AND po.status IN ('proposed', 'pending', 'confirmed', 'shipped')) AS open_orders
                 FROM suppliers s WHERE s.is_active = TRUE ORDER BY s.name`
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

    /** What a supplier still carries: products assigned to them, and orders not yet finished. */
    static async stillCarries(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT (SELECT COUNT(*) FROM products p WHERE p.supplier_id = ? AND p.is_active = TRUE) AS products,
                        (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = ?
                            AND po.status IN ('proposed', 'pending', 'confirmed', 'shipped')) AS open_orders`,
                [id, id]
            );
            return { products: Number(rows[0].products) || 0, open_orders: Number(rows[0].open_orders) || 0 };
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
