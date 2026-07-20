const pool = require('../config/database');

// Stock/expiry status as SQL, mirroring the inventory page's statusMatches():
// a product can be both low-stock AND expiring, so each filter is a plain fact.
const STATUS_SQL = {
    low: 'p.stock_quantity > 0 AND p.stock_quantity <= COALESCE(p.reorder_level, 10)',
    out: 'p.stock_quantity <= 0',
    reorder: 'p.stock_quantity <= COALESCE(p.reorder_level, 10)',
    expiring: 'p.expiration_date IS NOT NULL AND DATEDIFF(DATE(p.expiration_date), CURDATE()) BETWEEN 0 AND 30',
    expired: 'p.expiration_date IS NOT NULL AND DATEDIFF(DATE(p.expiration_date), CURDATE()) < 0',
    in: `(p.expiration_date IS NULL OR DATEDIFF(DATE(p.expiration_date), CURDATE()) > 30)
         AND p.stock_quantity > 0 AND p.stock_quantity > COALESCE(p.reorder_level, 10)`
};

// Badge priority rank (expired > expiring > out > low > in) for status sorting
const STATUS_RANK_SQL = `CASE
    WHEN p.expiration_date IS NOT NULL AND DATEDIFF(DATE(p.expiration_date), CURDATE()) < 0 THEN 0
    WHEN p.expiration_date IS NOT NULL AND DATEDIFF(DATE(p.expiration_date), CURDATE()) <= 30 THEN 2
    WHEN p.stock_quantity <= 0 THEN 1
    WHEN p.stock_quantity <= COALESCE(p.reorder_level, 10) THEN 3
    ELSE 4
END`;

const SORT_SQL = {
    name: 'p.name',
    category: 'category_name',
    price: 'p.unit_price',
    stock: 'p.stock_quantity'
};

// Appends the shared WHERE conditions (category/species/search/status) used by
// both getAll and countAll so the paged list and its total always agree.
function applyProductFilters(sql, params, filters) {
    if (filters.category_id) {
        sql += ' AND p.category_id = ?';
        params.push(filters.category_id);
    }
    if (filters.species) {
        sql += ' AND p.species = ?';
        params.push(filters.species);
    }
    if (filters.search) {
        sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ? OR p.barcode LIKE ?)';
        const like = `%${filters.search}%`;
        params.push(like, like, like, like);
    }
    if (filters.status && STATUS_SQL[filters.status]) {
        sql += ` AND (${STATUS_SQL[filters.status]})`;
    }
    return sql;
}

// Replace the heavy image_url (base64 data URLs) with a tiny has_image flag.
function stripImages(rows) {
    return rows.map(({ image_url, ...rest }) => ({
        ...rest,
        has_image: !!(image_url && String(image_url).trim())
    }));
}

class Product {
    static async getAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            let sql = `SELECT p.*, c.name as category_name, s.name as supplier_name
                       FROM products p
                       LEFT JOIN categories c ON p.category_id = c.id
                       LEFT JOIN suppliers s ON p.supplier_id = s.id
                       WHERE p.is_active = TRUE`;
            const params = [];
            sql = applyProductFilters(sql, params, filters);
            if (filters.sort && SORT_SQL[filters.sort]) {
                const dir = filters.dir === 'desc' ? 'DESC' : 'ASC';
                sql += ` ORDER BY ${SORT_SQL[filters.sort]} ${dir}`;
            } else if (filters.sort === 'expiry') {
                // Products without an expiry date always sink to the bottom
                const dir = filters.dir === 'desc' ? 'DESC' : 'ASC';
                sql += ` ORDER BY p.expiration_date IS NULL ASC, DATE(p.expiration_date) ${dir}`;
            } else if (filters.sort === 'status') {
                const dir = filters.dir === 'desc' ? 'DESC' : 'ASC';
                sql += ` ORDER BY ${STATUS_RANK_SQL} ${dir}`;
            } else {
                sql += ' ORDER BY p.created_at DESC';
            }
            // Pagination: values are parseInt-sanitized in the controller.
            // mysql2 execute() rejects placeholders in LIMIT, so inline them
            // (same pattern as AuditLog).
            if (filters.limit !== undefined || filters.offset !== undefined) {
                const lim = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100000;
                const off = Number.isInteger(filters.offset) && filters.offset > 0 ? filters.offset : 0;
                sql += ` LIMIT ${lim} OFFSET ${off}`;
            }
            const [rows] = await connection.execute(sql, params);
            return filters.light ? stripImages(rows) : rows;
        } finally {
            connection.release();
        }
    }

    static async getStockLevels() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, stock_quantity FROM products WHERE is_active = TRUE'
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async countAll(filters = {}) {
        const connection = await pool.getConnection();
        try {
            let sql = 'SELECT COUNT(*) as total FROM products p WHERE p.is_active = TRUE';
            const params = [];
            sql = applyProductFilters(sql, params, filters);
            const [rows] = await connection.execute(sql, params);
            return rows[0].total;
        } finally {
            connection.release();
        }
    }

    // One aggregate row for the inventory stat cards + status chip counts,
    // so the frontend never needs the whole catalog just to show numbers.
    static async getStats() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT COUNT(*) AS total,
                        COALESCE(SUM(p.unit_price * p.stock_quantity), 0) AS total_value,
                        COALESCE(SUM(${STATUS_SQL.low}), 0) AS low_count,
                        COALESCE(SUM(${STATUS_SQL.out}), 0) AS out_count,
                        COALESCE(SUM(${STATUS_SQL.reorder}), 0) AS reorder_count,
                        COALESCE(SUM(${STATUS_SQL.expiring}), 0) AS expiring_count,
                        COALESCE(SUM(${STATUS_SQL.expired}), 0) AS expired_count,
                        COALESCE(SUM(${STATUS_SQL.in}), 0) AS in_count,
                        COALESCE(SUM(p.max_stock_level IS NOT NULL AND p.max_stock_level > 0
                            AND p.stock_quantity > p.max_stock_level * 1.5), 0) AS overstock_count
                 FROM products p WHERE p.is_active = TRUE`
            );
            return rows[0];
        } finally {
            connection.release();
        }
    }

    static async findById(id) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT p.*, c.name as category_name, s.name as supplier_name 
                 FROM products p 
                 LEFT JOIN categories c ON p.category_id = c.id 
                 LEFT JOIN suppliers s ON p.supplier_id = s.id 
                 WHERE p.id = ?`,
                [id]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async findBySku(sku) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT p.*, c.name as category_name, s.name as supplier_name 
                 FROM products p 
                 LEFT JOIN categories c ON p.category_id = c.id 
                 LEFT JOIN suppliers s ON p.supplier_id = s.id 
                 WHERE p.sku = ?`,
                [sku]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async findByBarcode(barcode) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT p.*, c.name as category_name, s.name as supplier_name 
                 FROM products p 
                 LEFT JOIN categories c ON p.category_id = c.id 
                 LEFT JOIN suppliers s ON p.supplier_id = s.id 
                 WHERE p.barcode = ?`,
                [barcode]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async create(productData) {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO products 
                 (sku, name, description, brand, species, breed_size, age_group, health_category,
                  category_id, unit_price, cost_price, 
                   stock_quantity, reorder_level, max_stock_level, unit_type, batch_number, expiration_date, 
                   barcode, image_url, supplier_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    productData.sku,
                    productData.name,
                    productData.description || null,
                    productData.brand || null,
                    productData.species || null,
                    productData.breed_size || null,
                    productData.age_group || null,
                    productData.health_category || null,
                    productData.category_id || null,
                    productData.unit_price,
                    productData.cost_price || null,
                    productData.stock_quantity || 0,
                    productData.reorder_level || 10,
                    productData.max_stock_level || null,
                    productData.unit_type || 'piece',
                    productData.batch_number || null,
                    productData.expiration_date || null,
                    productData.barcode || null,
                    productData.image_url || null,
                    productData.supplier_id || null
                ]
            );
            return await this.findById(result.insertId);
        } finally {
            connection.release();
        }
    }

    static async update(id, productData) {
        const connection = await pool.getConnection();
        try {
            const fields = [];
            const params = [];
            const allowedFields = [
                'sku', 'name', 'description', 'brand', 'species', 'breed_size',
                'age_group', 'health_category', 'category_id',
                'unit_price', 'cost_price', 'stock_quantity', 'reorder_level',
                'max_stock_level', 'unit_type', 'batch_number', 'expiration_date', 'barcode',
                'image_url', 'supplier_id', 'is_active'
            ];

            for (const field of allowedFields) {
                if (productData[field] !== undefined) {
                    fields.push(`${field} = ?`);
                    params.push(productData[field]);
                }
            }

            if (fields.length === 0) return null;

            params.push(id);
            await connection.execute(
                `UPDATE products SET ${fields.join(', ')} WHERE id = ?`,
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
                'UPDATE products SET is_active = FALSE WHERE id = ?',
                [id]
            );
            return true;
        } finally {
            connection.release();
        }
    }

    static async getCategories() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM categories ORDER BY name'
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getLowStock() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT p.*, c.name as category_name, s.name as supplier_name, s.email as supplier_email
                 FROM products p 
                 LEFT JOIN categories c ON p.category_id = c.id 
                 LEFT JOIN suppliers s ON p.supplier_id = s.id AND s.is_active = TRUE
                 WHERE p.stock_quantity <= p.reorder_level AND p.is_active = TRUE 
                 ORDER BY p.stock_quantity ASC`
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getExpiringSoon(days) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT p.*, c.name as category_name 
                 FROM products p 
                 LEFT JOIN categories c ON p.category_id = c.id 
                 WHERE p.expiration_date IS NOT NULL 
                 AND p.expiration_date <= DATE_ADD(NOW(), INTERVAL ? DAY) 
                 AND p.expiration_date >= CURDATE() 
                 AND p.is_active = TRUE 
                 ORDER BY p.expiration_date ASC`,
                [days]
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getOverstock() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT p.*, c.name as category_name 
                 FROM products p 
                 LEFT JOIN categories c ON p.category_id = c.id 
                 WHERE p.stock_quantity >= p.max_stock_level 
                 AND p.max_stock_level IS NOT NULL 
                 AND p.is_active = TRUE 
                 ORDER BY (p.stock_quantity - p.max_stock_level) DESC`
            );
            return rows;
        } finally {
            connection.release();
        }
    }

    static async getSuppliers() {
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

    static async getSpecies() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                "SELECT DISTINCT species FROM products WHERE species IS NOT NULL AND species != '' ORDER BY species"
            );
            return rows.map(r => r.species);
        } finally {
            connection.release();
        }
    }
}

module.exports = Product;
