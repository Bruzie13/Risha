const pool = require('../config/database');

class PurchaseOrder {
    static async getAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            let sql = `SELECT po.id, po.po_number, po.supplier_id, po.order_date, po.expected_delivery_date,
                        po.total_amount, po.status, po.notes, po.created_by,
                        UNIX_TIMESTAMP(po.created_at) * 1000 as created_at,
                        UNIX_TIMESTAMP(po.updated_at) * 1000 as updated_at,
                        UNIX_TIMESTAMP(po.confirmed_at) * 1000 as confirmed_at,
                        UNIX_TIMESTAMP(po.shipped_at) * 1000 as shipped_at,
                        UNIX_TIMESTAMP(po.received_at) * 1000 as received_at,
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
                        UNIX_TIMESTAMP(po.confirmed_at) * 1000 as confirmed_at,
                        UNIX_TIMESTAMP(po.shipped_at) * 1000 as shipped_at,
                        UNIX_TIMESTAMP(po.received_at) * 1000 as received_at,
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

    // options.expiration_date (YYYY-MM-DD, optional): the fresh batch's expiry.
    // When receiving, it replaces each product's expiration_date — this is how
    // an expired product becomes sellable again after a new delivery arrives.
    static async updateStatus(id, status, options = {}) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Stamp the stage the first time it is reached, so "3 days in
            // transit" stays true even if the row is edited again later.
            const STAGE_COLUMN = { confirmed: 'confirmed_at', shipped: 'shipped_at', received: 'received_at' };
            const stampCol = STAGE_COLUMN[status];
            await connection.execute(
                stampCol
                    ? `UPDATE purchase_orders SET status = ?, ${stampCol} = COALESCE(${stampCol}, NOW()) WHERE id = ?`
                    : 'UPDATE purchase_orders SET status = ? WHERE id = ?',
                [status, id]
            );

            // A delivered or cancelled order should stop broadcasting.
            if (status === 'received' || status === 'cancelled') {
                await connection.execute(
                    'UPDATE delivery_tracking SET revoked = 1 WHERE po_id = ? AND revoked = 0',
                    [id]
                );
            }

            if (status === 'received') {
                const items = await this.getPOItems(id);
                const newExpiry = /^\d{4}-\d{2}-\d{2}$/.test(options.expiration_date || '') ? options.expiration_date : null;
                for (const item of items) {
                    if (newExpiry) {
                        // fresh batch resets stock and expiry together
                        await connection.execute(
                            'UPDATE products SET stock_quantity = stock_quantity + ?, expiration_date = ? WHERE id = ?',
                            [item.quantity, newExpiry, item.product_id]
                        );
                    } else {
                        await connection.execute(
                            'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
                            [item.quantity, item.product_id]
                        );
                    }

                    await connection.execute(
                        `INSERT INTO stock_movements
                         (product_id, movement_type, quantity, reference_type, reference_id, notes)
                                                   VALUES (?, 'purchase', ?, 'purchase_order', ?, ?)`,
                        [
                            item.product_id,
                            item.quantity,
                            id,
                            newExpiry
                                ? `Purchase Order #${id} received (new batch, expires ${newExpiry})`
                                : `Purchase Order #${id} received`
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
