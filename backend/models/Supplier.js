const pool = require('../config/database');
const { nameKey } = require('../utils/supplier');

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

    /** The id of another current supplier already using this name, or null. */
    static async nameTaken(name, exceptId = null) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, name FROM suppliers WHERE is_active = TRUE AND id <> ?', [exceptId == null ? 0 : exceptId]);
            const same = rows.find(r => nameKey(r.name) === nameKey(name));
            return same ? same.id : null;
        } finally {
            connection.release();
        }
    }

    static async create(data) {
        const connection = await pool.getConnection();
        let locked = false;
        try {
            /* Two suppliers with one name cannot be told apart on an order.
               The check and the insert are done under one named lock, so two
               requests arriving together (a double press of Save) take turns
               and the second finds the first. */
            const [lock] = await connection.execute("SELECT GET_LOCK('fetch_supplier_name', 5) AS held");
            locked = Number(lock[0].held) === 1;
            if (!locked) { const e = new Error('Another supplier is being saved'); e.code = 'SUPPLIER_BUSY'; throw e; }
            const [current] = await connection.execute('SELECT id, name FROM suppliers WHERE is_active = TRUE');
            if (current.some(r => nameKey(r.name) === nameKey(data.name))) {
                const e = new Error('A supplier with this name already exists'); e.code = 'DUPLICATE_SUPPLIER'; throw e;
            }
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
            if (locked) { try { await connection.execute("SELECT RELEASE_LOCK('fetch_supplier_name')"); } catch (e) { /* released with the connection */ } }
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
