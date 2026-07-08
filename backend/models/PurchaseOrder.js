const pool = require('../config/database');

class PurchaseOrder {
    static async getAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            let sql = `SELECT po.id, po.po_number, po.supplier_id, po.order_date, po.expected_delivery_date,
                        po.total_amount, po.status, po.notes, po.created_by,
                        UNIX_TIMESTAMP(po.created_at) * 1000 as created_at,
                        UNIX_TIMESTAMP(po.updated_at) * 1000 as updated_at,
                        s.name as supplier_name, u.full_name as created_by_name,
                 (SELECT COUNT(*) FROM po_items poi WHERE poi.po_id = po.id) as item_count
                 FROM purchase_orders po
                 LEFT JOIN suppliers s ON po.supplier_id = s.id
                 LEFT JOIN users u ON po.created_by = u.id`;
            const params = [];
            const conditions = [];

            if (filters.status) {
                conditions.push('po.status = ?');
                params.push(filters.status);
            }

            if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
            sql += ' ORDER BY po.created_at DESC';

            const [rows] = await connection.execute(sql, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    static async findById(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT po.id, po.po_number, po.supplier_id, po.order_date, po.expected_delivery_date,
                        po.total_amount, po.status, po.notes, po.created_by,
                        UNIX_TIMESTAMP(po.created_at) * 1000 as created_at,
                        UNIX_TIMESTAMP(po.updated_at) * 1000 as updated_at,
                        s.name as supplier_name, u.full_name as created_by_name
                 FROM purchase_orders po
                 LEFT JOIN suppliers s ON po.supplier_id = s.id
                 LEFT JOIN users u ON po.created_by = u.id
                 WHERE po.id = ?`,
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async getPOItems(poId) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT poi.*, p.name as product_name, p.sku
                 FROM po_items poi
                 JOIN products p ON poi.product_id = p.id
                 WHERE poi.po_id = ?`,
                [poId]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async create(poData) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const poNumber = 'PO-' + Date.now();

            const [result] = await connection.execute(
                `INSERT INTO purchase_orders 
                 (po_number, supplier_id, order_date, expected_delivery_date, total_amount, 
                  status, notes, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    poNumber,
                    poData.supplier_id,
                    poData.order_date || new Date(),
                    poData.expected_delivery_date || null,
                    poData.total_amount || 0,
                    poData.status || 'pending',
                    poData.notes || null,
                    poData.created_by || null
                ]
            );

            const poId = result.insertId;

            if (poData.items && poData.items.length > 0) {
                for (const item of poData.items) {
                    await connection.execute(
                        `INSERT INTO po_items 
                         (po_id, product_id, quantity, unit_price, subtotal) 
                         VALUES (?, ?, ?, ?, ?)`,
                        [
                            poId,
                            item.product_id,
                            item.quantity,
                            item.unit_price || 0,
                            item.subtotal || (item.quantity * (item.unit_price || item.unit_cost || 0))
                        ]
                    );
                }
            }

            await connection.commit();
            return await this.findById(poId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async updateStatus(id, status) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.execute(
                'UPDATE purchase_orders SET status = ? WHERE id = ?',
                [status, id]
            );

            if (status === 'received') {
                const items = await this.getPOItems(id);
                for (const item of items) {
                    await connection.execute(
                        'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
                        [item.quantity, item.product_id]
                    );

                    await connection.execute(
                        `INSERT INTO stock_movements 
                         (product_id, movement_type, quantity, reference_type, reference_id, notes) 
                                                   VALUES (?, 'purchase', ?, 'purchase_order', ?, ?)`,
                        [
                            item.product_id,
                            item.quantity,
                            id,
                            `Purchase Order #${id} received`
                        ]
                    );
                }
            }

            await connection.commit();
            return await this.findById(id);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async delete(id) {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                'DELETE FROM po_items WHERE po_id = ?',
                [id]
            );
            await connection.execute(
                'DELETE FROM purchase_orders WHERE id = ?',
                [id]
            );
            return true;
        } finally {
            connection.release();
        }
    }
}

module.exports = PurchaseOrder;
