const { shopToday, expiryProblem } = require('../utils/expiry');
const { imageProblem } = require('../utils/image');
const { SKU_TYPES, skuTypeProblem, skuFor } = require('../utils/sku');
const { productProblem } = require('../utils/product');
const { stockRequestKey } = require('../utils/requestKeys');
const { stockChangeProblem } = require('../utils/product');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const logAudit = require('../services/audit');
const { notifyStockAdjusted, notifyProductCreated } = require('../services/notifier');
const { storeImage } = require('../services/imageStore');

/* The answer when a product is being given a barcode another one carries. */
function barcodeTakenAnswer(code, other) {
    return { success: false, code: 'BARCODE_TAKEN',
        message: `The barcode ${String(code).trim()} is already used by "${other.name}" (SKU ${other.sku}). Each product needs its own barcode.` };
}

/* The answer when a product is being given a name another product already has. */
function sameNameAnswer(twin) {
    return {
        success: false,
        code: 'SAME_NAME',
        message: `A product named "${twin.name}" is already in Inventory (SKU ${twin.sku}).`,
        data: { id: twin.id, sku: twin.sku, name: twin.name }
    };
}

/** The suppliers still on the shop's list, as a Set of ids. */
async function currentSupplierIds() {
    return new Set((await Supplier.getAll()).map(s => Number(s.id)));
}

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

exports.createProduct = async (req, res) => {
    try {
        /* The SKU is made by the system from the product type the user chose
           (see utils/sku.js); a SKU typed by hand is not taken. */
        const typeIssue = skuTypeProblem(req.body.sku_type);
        if (typeIssue) {
            return res.status(400).json({ success: false, message: typeIssue });
        }
        req.body.sku = skuFor(req.body.sku_type, (await Product.highestSkuNumber()) + 1);
        const { sku, name, description, brand, species, category_id, unit_price, cost_price, stock_quantity, reorder_level, max_stock_level, unit_type, supplier_id, barcode, expiration_date, batch_number, image_url } = req.body;

        // nothing important may be missing, and the supplier has to be a current one
        const problem = productProblem(req.body, true, await currentSupplierIds());
        if (problem) {
            return res.status(400).json({ success: false, message: problem });
        }

        // stock being added cannot already be past its date
        const expiryIssue = expiryProblem(expiration_date, shopToday());
        if (expiryIssue) {
            return res.status(400).json({ success: false, message: expiryIssue });
        }

        const pictureIssue = imageProblem(image_url);
        if (pictureIssue) {
            return res.status(400).json({ success: false, message: pictureIssue });
        }

        // the SKU was just made from the next free number (a clash with someone
        // saving at the same moment is settled below by taking the next one)
        const barcodeOwner = await Product.findByBarcode(barcode);
        if (barcodeOwner) return res.status(409).json(barcodeTakenAnswer(barcode, barcodeOwner));
        // Two products under one name are hard to tell apart at the till. It is
        // allowed (two sizes, two suppliers), but only when asked for.
        const twin = req.body.allow_same_name ? null : await Product.findByName(name);
        if (twin) return res.status(409).json(sameNameAnswer(twin));

        const fields = {
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
            // the max stock level typed when adding used to be dropped here
            max_stock_level,
            unit_type: unit_type || 'piece',
            supplier_id,
            barcode,
            expiration_date,
            batch_number,
            // base64 → hosted URL when Cloudinary is configured (else unchanged)
            image_url: await storeImage(image_url)
        };
        let product;
        for (let attempt = 0; ; attempt++) {
            try {
                product = await Product.create({ ...fields, sku: req.body.sku });
                break;
            } catch (e) {
                // someone else took this number a moment ago: use the next one
                if (e && e.code === 'ER_DUP_ENTRY' && /sku/i.test(e.message) && attempt < 5) {
                    req.body.sku = skuFor(req.body.sku_type, (await Product.highestSkuNumber()) + 1);
                    continue;
                }
                throw e;
            }
        }

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

// The SKU the next product of a type would get (shown in the form; the
// number is given for good only when the product is saved).
exports.getNextSku = async (req, res) => {
    try {
        const problem = skuTypeProblem(req.query.type);
        if (problem) return res.status(400).json({ success: false, message: problem });
        res.json({ success: true, data: { sku: skuFor(req.query.type, (await Product.highestSkuNumber()) + 1), types: SKU_TYPES } });
    } catch (error) {
        console.error('Next SKU error:', error);
        res.status(500).json({ success: false, message: 'Could not work out the next SKU.' });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const oldProduct = await Product.findById(id);

        // an edit cannot empty out what a product needs (only the fields it carries are judged)
        const problem = productProblem(updateData, false, await currentSupplierIds(), oldProduct);
        if (problem) {
            return res.status(400).json({ success: false, message: problem });
        }

        if (updateData.sku !== undefined && oldProduct && String(updateData.sku).trim() !== String(oldProduct.sku)) {
            return res.status(400).json({ success: false, message: `The SKU cannot be changed once the product is saved. It stays ${oldProduct.sku}.` });
        }

        if (updateData.barcode != null && String(updateData.barcode).trim()) {
            const barcodeOwner = await Product.findByBarcode(updateData.barcode, id);
            if (barcodeOwner) return res.status(409).json(barcodeTakenAnswer(updateData.barcode, barcodeOwner));
        }

        // renaming a product to a name another one has: the same question as on adding
        if (updateData.name !== undefined && oldProduct && !updateData.allow_same_name
            && String(updateData.name).trim().toLowerCase() !== String(oldProduct.name).trim().toLowerCase()) {
            const twin = await Product.findByName(updateData.name, id);
            if (twin) return res.status(409).json(sameNameAnswer(twin));
        }

        // A changed expiration date has to be today or later. The date the
        // product already has may stay, so an expired product can be edited.
        if (updateData.expiration_date !== undefined) {
            const expiryIssue = expiryProblem(updateData.expiration_date, shopToday(), oldProduct && oldProduct.expiration_date);
            if (expiryIssue) {
                return res.status(400).json({ success: false, message: expiryIssue });
            }
        }
        if (updateData.image_url !== undefined) {
            const pictureIssue = imageProblem(updateData.image_url);
            if (pictureIssue) {
                return res.status(400).json({ success: false, message: pictureIssue });
            }
        }

        // A newly pasted/uploaded image comes in as a base64 data URL — push it
        // to Cloudinary (when configured) and store the URL instead. This is
        // done last, once nothing above has refused the edit: it used to come
        // before the name and expiry checks, so an edit they refused had
        // already uploaded its picture.
        if (updateData.image_url) {
            updateData.image_url = await storeImage(updateData.image_url);
        }

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
        // A product that is not there, or was deleted already, is not "deleted
        // successfully": this used to say so and write it in the Activity log.
        const product = await Product.findById(id);
        if (!product || !product.is_active) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        await Product.delete(id);

        // what was removed, so the log says more than a number
        logAudit(req.user.id, 'delete', 'products', parseInt(id),
            { sku: product.sku, name: product.name, stock_quantity: product.stock_quantity, unit_price: product.unit_price, supplier_id: product.supplier_id },
            null, req.ip);

        res.status(200).json({
            success: true,
            message: 'Product deleted successfully',
            stock_left: Number(product.stock_quantity) || 0
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

exports.adjustStock = async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, movement_type, notes } = req.body;

        const problem = stockChangeProblem(quantity, movement_type);
        if (problem) {
            return res.status(400).json({ success: false, message: problem });
        }
        // Stock being added may come with its own expiration date (a new batch).
        const newExpiry = movement_type === 'in' && req.body.expiration_date ? String(req.body.expiration_date) : null;
        const expiryIssue = expiryProblem(newExpiry, shopToday());
        if (expiryIssue) {
            return res.status(400).json({ success: false, message: expiryIssue });
        }

        // One press of Save is one change (see utils/requestKeys.js).
        const key = stockRequestKey(req.body.request_key);
        if (key === false) {
            return res.status(400).json({ success: false, message: 'The request number sent with this change is not valid' });
        }

        const pool = require('../config/database');
        const conn = await pool.getConnection();
        let before = null;
        let repeated = false;
        let removedExpired = 0;
        try {
            /* The change and its history row are saved together or not at all,
               and the product's row is held while that happens. Two requests
               for the same product therefore take turns: the second one finds
               the row the first one wrote, and changes nothing. */
            await conn.beginTransaction();
            const [rows] = await conn.execute("SELECT name, stock_quantity, DATE_FORMAT(expiration_date, '%Y-%m-%d') AS expires FROM products WHERE id = ? FOR UPDATE", [id]);
            if (!rows.length) {
                await conn.rollback();
                return res.status(404).json({ success: false, message: 'Product not found' });
            }
            before = rows[0].stock_quantity;
            if (key) {
                const [seen] = await conn.execute(
                    `SELECT id FROM stock_movements
                     WHERE product_id = ? AND reference_type = 'manual' AND reference_id = ?
                       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT 1`,
                    [id, key]
                );
                repeated = seen.length > 0;
            }
            /* Adding stock to a product whose date has passed, without a new
               date, would put the new stock on the shelf as expired too. */
            if (!repeated && movement_type === 'in' && !newExpiry && rows[0].expires && rows[0].expires < shopToday()) {
                await conn.rollback();
                return res.status(400).json({ success: false, code: 'EXPIRY_NEEDED',
                    message: `"${rows[0].name}" expired on ${rows[0].expires}. Enter the expiration date of the stock being added, or the new stock would be counted as expired too.` });
            }
            /* Adding a new batch to a product whose date has passed: the
               expired units are written off (as spoiled) first, so the new
               stock replaces them instead of being added on top. */
            if (!repeated && movement_type === 'in' && newExpiry && rows[0].expires && rows[0].expires < shopToday() && Number(rows[0].stock_quantity) > 0) {
                removedExpired = Number(rows[0].stock_quantity);
                await conn.execute('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [removedExpired, id]);
                await conn.execute(
                    `INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
                     VALUES (?, 'damage', ?, 'manual', NULL, ?, ?)`,
                    [id, -removedExpired, `Expired stock removed (expired ${rows[0].expires}) when new stock was added`, req.user.id]
                );
            }
            if (!repeated) {
                const qty = movement_type === 'in' ? Number(quantity) : -Number(quantity);
                /* More cannot be taken off the shelf than is on it. This used
                   to be accepted: the stock was quietly set to zero while the
                   history row recorded the full amount. The row is held, so
                   the stock read above is the stock this change applies to. */
                if (qty < 0 && Number(quantity) > Number(before)) {
                    await conn.rollback();
                    return res.status(400).json({
                        success: false,
                        code: 'NOT_ENOUGH_STOCK',
                        message: `Only ${Number(before)} in stock: you cannot remove ${Number(quantity)}.`,
                        data: { stock_quantity: before }
                    });
                }
                if (newExpiry) {
                    await conn.execute('UPDATE products SET stock_quantity = stock_quantity + ?, expiration_date = ? WHERE id = ?', [qty, newExpiry, id]);
                } else {
                    await conn.execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [qty, id]);
                }
                await conn.execute(
                    `INSERT INTO stock_movements (product_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
                     VALUES (?, ?, ?, 'manual', ?, ?, ?)`,
                    [id, movement_type, qty, key, (notes || 'Manual stock adjustment') + (newExpiry ? ` (new batch, expires ${newExpiry})` : ''), req.user.id]
                );
            }
            await conn.commit();
        } catch (e) {
            try { await conn.rollback(); } catch (x) { /* nothing open */ }
            throw e;
        } finally {
            conn.release();
        }

        const updated = await Product.findById(id);
        if (repeated) {
            // the same press arriving twice: say it is saved, and do nothing more
            return res.status(200).json({ success: true, duplicate: true, message: 'This change was already saved', data: updated });
        }
        logAudit(req.user.id, 'update', 'products', parseInt(id), { stock_quantity: before }, { stock_quantity: updated.stock_quantity }, req.ip);
        notifyStockAdjusted(updated, before, updated.stock_quantity, req.user.id).catch(e => console.error('Notif error:', e.message));
        res.status(200).json({ success: true, message: removedExpired ? `Stock adjusted. The ${removedExpired} expired were removed and replaced by the new stock.` : 'Stock adjusted successfully', removed_expired: removedExpired, data: updated });
    } catch (error) {
        console.error('Adjust stock error:', error);
        res.status(500).json({ success: false, message: 'Error adjusting stock' });
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
        const suppliers = await currentSupplierIds();

        for (const p of products) {
            if (!p.sku || !p.name) {
                errors.push({ sku: p.sku, error: 'SKU and name are required' });
                continue;
            }
            // the same rules as adding one product by hand
            const problem = productProblem(p, true, suppliers);
            if (problem) {
                errors.push({ sku: p.sku, error: problem });
                continue;
            }
            try {
                const existing = await Product.findBySku(p.sku);
                if (existing) {
                    errors.push({ sku: p.sku, error: 'SKU already exists' });
                    continue;
                }
                const expiryIssue = expiryProblem(p.expiration_date, shopToday());
                if (expiryIssue) {
                    errors.push({ sku: p.sku, error: expiryIssue });
                    continue;
                }
                // a file cannot be asked "are you sure", so a name already in use is left out and named
                const twin = await Product.findByName(p.name);
                if (twin) {
                    errors.push({ sku: p.sku, error: `A product named "${twin.name}" already exists (SKU ${twin.sku})` });
                    continue;
                }
                const product = await Product.create({
                    sku: p.sku,
                    name: p.name,
                    description: p.description || null,
                    brand: p.brand || null,
                    species: p.species || null,
                    category_id: p.category_id,
                    unit_price: p.unit_price,
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
