const Product = require('../models/Product');
const logAudit = require('../services/audit');
const { notifyStockAdjusted, notifyProductCreated } = require('../services/notifier');
const { storeImage } = require('../services/imageStore');

exports.getAllProducts = async (req, res) => {
    try {
        const { category, species, limit, offset, search, status, sort, dir, fields } = req.query;
        const filters = {};
        if (category) filters.category_id = category;
        if (species) filters.species = species;
        if (search && String(search).trim()) filters.search = String(search).trim();
        if (status) filters.status = String(status); // whitelisted in the model
        if (sort) filters.sort = String(sort);       // whitelisted in the model
        if (dir === 'desc') filters.dir = 'desc';
        // light = every column except the heavy base64 image_url (+ has_image flag)
        if (fields === 'light') filters.light = true;
        // Optional pagination: without limit/offset the full list is returned
        // (dashboard, reports, etc. rely on that).
        const paginated = limit !== undefined || offset !== undefined;
        if (paginated) {
            const lim = parseInt(limit);
            if (Number.isInteger(lim) && lim > 0) filters.limit = lim;
            const off = parseInt(offset);
            if (Number.isInteger(off) && off > 0) filters.offset = off;
        }
        const products = await Product.getAll(filters);
        const total = paginated ? await Product.countAll(filters) : products.length;
        res.status(200).json({
            success: true,
            data: products,
            total
        });
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving products'
        });
    }
};

// Aggregate counts/value for the inventory stat cards and status chips
exports.getProductStats = async (req, res) => {
    try {
        const stats = await Product.getStats();
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        console.error('Get product stats error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving product stats' });
    }
};

// Lightweight id→stock snapshot for live polling (no images, tiny payload)
exports.getStockLevels = async (req, res) => {
    try {
        const levels = await Product.getStockLevels();
        res.status(200).json({ success: true, data: levels });
    } catch (error) {
        console.error('Get stock levels error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving stock levels' });
    }
};

exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        res.status(200).json({
            success: true,
            data: product
        });
    } catch (error) {
        console.error('Get product error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving product'
        });
    }
};

exports.getProductByBarcode = async (req, res) => {
    try {
        const { barcode } = req.query;

        if (!barcode) {
            return res.status(400).json({
                success: false,
                message: 'Barcode parameter is required'
            });
        }

        const product = await Product.findByBarcode(barcode);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found with that barcode'
            });
        }

        res.status(200).json({
            success: true,
            data: product
        });
    } catch (error) {
        console.error('Get product by barcode error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving product by barcode'
        });
    }
};

exports.createProduct = async (req, res) => {
    try {
        const { sku, name, description, brand, species, category_id, unit_price, cost_price, stock_quantity, reorder_level, unit_type, supplier_id, barcode, expiration_date, batch_number, image_url } = req.body;

        if (!sku || !name || !category_id || !unit_price) {
            return res.status(400).json({
                success: false,
                message: 'SKU, name, category, and unit price are required'
            });
        }

        const existingProduct = await Product.findBySku(sku);
        if (existingProduct) {
            return res.status(409).json({
                success: false,
                message: 'A product with this SKU already exists'
            });
        }

        const product = await Product.create({
            sku,
            name,
            description,
            brand,
            species,
            category_id,
            unit_price,
            cost_price,
            stock_quantity,
            reorder_level,
            unit_type: unit_type || 'piece',
            supplier_id,
            barcode,
            expiration_date,
            batch_number,
            // base64 → hosted URL when Cloudinary is configured (else unchanged)
            image_url: await storeImage(image_url)
        });

        logAudit(req.user.id, 'create', 'products', product.id, null, product, req.ip);

        notifyProductCreated(product, req.user.id).catch(e => console.error('Notif error:', e.message));

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: product
        });
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating product'
        });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // A newly pasted/uploaded image comes in as a base64 data URL — push it
        // to Cloudinary (when configured) and store the URL instead.
        if (updateData.image_url) {
            updateData.image_url = await storeImage(updateData.image_url);
        }

        const oldProduct = await Product.findById(id);
        const product = await Product.update(id, updateData);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        logAudit(req.user.id, 'update', 'products', parseInt(id), oldProduct, updateData, req.ip);

        res.status(200).json({
            success: true,
            message: 'Product updated successfully',
            data: product
        });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating product'
        });
    }
};

exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        await Product.delete(id);

        logAudit(req.user.id, 'delete', 'products', parseInt(id), null, null, req.ip);

        res.status(200).json({
            success: true,
            message: 'Product deleted successfully'
        });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting product'
        });
    }
};

exports.getCategories = async (req, res) => {
    try {
        const categories = await Product.getCategories();
        res.status(200).json({
            success: true,
            data: categories
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving categories'
        });
    }
};

exports.getLowStockProducts = async (req, res) => {
    try {
        let products = await Product.getLowStock();
        // The reorder dialog only needs names/levels — drop the heavy images
        if (req.query.fields === 'light') {
            products = products.map(({ image_url, ...rest }) => rest);
        }
        res.status(200).json({
            success: true,
            data: products
        });
    } catch (error) {
        console.error('Get low stock error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving low stock products'
        });
    }
};

exports.getExpiringProducts = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const products = await Product.getExpiringSoon(days);
        res.status(200).json({
            success: true,
            data: products
        });
    } catch (error) {
        console.error('Get expiring products error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving expiring products'
        });
    }
};

exports.getOverstockProducts = async (req, res) => {
    try {
        const products = await Product.getOverstock();
        res.status(200).json({
            success: true,
            data: products
        });
    } catch (error) {
        console.error('Get overstock products error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving overstock products'
        });
    }
};

exports.getSpecies = async (req, res) => {
    try {
        const species = await Product.getSpecies();
        res.status(200).json({
            success: true,
            data: species
        });
    } catch (error) {
        console.error('Get species error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving species'
        });
    }
};

exports.adjustStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, movement_type, notes } = req.body;

        if (!quantity || quantity <= 0) {
            return res.status(400).json({ success: false, message: 'Valid quantity is required' });
        }

        const product = await Product.findById(id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const pool = require('../config/database');
        const conn = await pool.getConnection();
        try {
            const qty = movement_type === 'in' ? quantity : -quantity;
            await conn.execute('UPDATE products SET stock_quantity = GREATEST(0, stock_quantity + ?) WHERE id = ?', [qty, id]);
            await conn.execute(
                `INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, notes, created_by)
                 VALUES (?, ?, ?, 'manual', ?, ?)`,
                [id, movement_type || 'adjustment', qty, notes || 'Manual stock adjustment', req.user.id]
            );
            conn.release();
        } catch (e) { conn.release(); throw e; }

        const updated = await Product.findById(id);
        logAudit(req.user.id, 'update', 'products', parseInt(id), { stock_quantity: product.stock_quantity }, { stock_quantity: updated.stock_quantity }, req.ip);
        notifyStockAdjusted(updated, product.stock_quantity, updated.stock_quantity, req.user.id).catch(e => console.error('Notif error:', e.message));
        res.status(200).json({ success: true, message: 'Stock adjusted successfully', data: updated });
    } catch (error) {
        console.error('Adjust stock error:', error);
        res.status(500).json({ success: false, message: 'Error adjusting stock' });
    }
};

exports.getSuppliers = async (req, res) => {
    try {
        const suppliers = await Product.getSuppliers();
        res.status(200).json({
            success: true,
            data: suppliers
        });
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving suppliers'
        });
    }
};

exports.bulkCreateProducts = async (req, res) => {
    try {
        const { products } = req.body;
        if (!Array.isArray(products) || products.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Products array is required'
            });
        }

        const created = [];
        const errors = [];

        for (const p of products) {
            if (!p.sku || !p.name) {
                errors.push({ sku: p.sku, error: 'SKU and name are required' });
                continue;
            }
            try {
                const existing = await Product.findBySku(p.sku);
                if (existing) {
                    errors.push({ sku: p.sku, error: 'SKU already exists' });
                    continue;
                }
                const product = await Product.create({
                    sku: p.sku,
                    name: p.name,
                    description: p.description || null,
                    brand: p.brand || null,
                    species: p.species || null,
                    category_id: p.category_id || 1,
                    unit_price: p.unit_price || 0,
                    cost_price: p.cost_price || 0,
                    stock_quantity: p.stock_quantity || 0,
                    reorder_level: p.reorder_level || 10,
                    max_stock_level: p.max_stock_level || null,
                    unit_type: p.unit_type || 'piece',
                    supplier_id: p.supplier_id || null,
                    barcode: p.barcode || null,
                    expiration_date: p.expiration_date || null,
                    batch_number: p.batch_number || null
                });
                created.push(product);
            } catch (e) {
                errors.push({ sku: p.sku, error: e.message });
            }
        }

        logAudit(req.user.id, 'create', 'products', null, null, { count: created.length }, req.ip);

        res.status(201).json({
            success: true,
            message: `Created ${created.length} product(s)${errors.length ? `, ${errors.length} skipped` : ''}`,
            data: { created: created.length, errors }
        });
    } catch (error) {
        console.error('Bulk create error:', error);
        res.status(500).json({
            success: false,
            message: 'Error bulk creating products'
        });
    }
};
