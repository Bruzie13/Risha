const Supplier = require('../models/Supplier');
const { supplierProblem } = require('../utils/supplier');
const SupplierPerformance = require('../models/SupplierPerformance');
const { scorecard, starRating } = require('../utils/supply');
const PurchaseOrder = require('../models/PurchaseOrder');
const logAudit = require('../services/audit');

exports.getAllSuppliers = async (req, res) => {
    try {
        const [suppliers, received] = await Promise.all([Supplier.getAll(), SupplierPerformance.scorecardOrdersAll()]);
        /* each supplier's stars, by the same rule as its Performance window */
        const bySupplier = new Map();
        for (const o of received) {
            if (!bySupplier.has(o.supplier_id)) bySupplier.set(o.supplier_id, []);
            bySupplier.get(o.supplier_id).push(o);
        }
        const data = suppliers.map(s => {
            const r = starRating(scorecard(bySupplier.get(s.id) || []));
            return { ...s, stars: { stars: r.stars, rated: r.rated, meets_standard: r.meets_standard, standard: r.standard, summary: r.summary } };
        });
        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving suppliers'
        });
    }
};

// Map pins are optional, but a stored pin has to be a real point on Earth —
// otherwise one bad value drags the whole map off to null island.
function normaliseCoords(body) {
    const out = {};
    for (const [key, range] of [['latitude', 90], ['longitude', 180]]) {
        if (body[key] === undefined) continue;
        if (body[key] === null || body[key] === '') { out[key] = null; continue; }
        const n = Number(body[key]);
        if (!Number.isFinite(n) || Math.abs(n) > range) {
            return { error: `${key} must be a number between -${range} and ${range}` };
        }
        out[key] = n;
    }
    // a pin needs both halves to mean anything
    if (out.latitude != null && out.longitude === null) return { error: 'longitude is required when latitude is set' };
    if (out.longitude != null && out.latitude === null) return { error: 'latitude is required when longitude is set' };
    return { value: out };
}

exports.createSupplier = async (req, res) => {
    try {
        const { contact_person, email, phone, address, city, payment_terms } = req.body;

        const problem = supplierProblem(req.body, true);
        if (problem) {
            return res.status(400).json({ success: false, message: problem });
        }
        const name = String(req.body.name).trim().replace(/\s+/g, ' ');

        const coords = normaliseCoords(req.body);
        if (coords.error) {
            return res.status(400).json({ success: false, message: coords.error });
        }

        const supplier = await Supplier.create({
            name,
            contact_person,
            email,
            phone,
            address,
            city,
            payment_terms,
            ...coords.value
        });

        logAudit(req.user.id, 'create', 'suppliers', supplier.id, null, supplier, req.ip);

        res.status(201).json({
            success: true,
            message: 'Supplier created successfully',
            data: supplier
        });
    } catch (error) {
        if (error.code === 'DUPLICATE_SUPPLIER') {
            return res.status(409).json({ success: false, code: 'DUPLICATE_SUPPLIER', message: 'A supplier with this name is already on the list.' });
        }
        if (error.code === 'SUPPLIER_BUSY') {
            return res.status(503).json({ success: false, message: 'Another supplier is being saved right now. Try again in a moment.' });
        }
        console.error('Create supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating supplier'
        });
    }
};

exports.updateSupplier = async (req, res) => {
    try {
        const { id } = req.params;

        const coords = normaliseCoords(req.body);
        if (coords.error) {
            return res.status(400).json({ success: false, message: coords.error });
        }
        const updateData = { ...req.body, ...coords.value };

        const problem = supplierProblem(updateData, false);
        if (problem) {
            return res.status(400).json({ success: false, message: problem });
        }
        if (updateData.name !== undefined) {
            updateData.name = String(updateData.name).trim().replace(/\s+/g, ' ');
            if (await Supplier.nameTaken(updateData.name, id)) {
                return res.status(409).json({ success: false, code: 'DUPLICATE_SUPPLIER', message: 'Another supplier already has this name.' });
            }
        }

        const oldSupplier = await Supplier.findById(id);
        const supplier = await Supplier.update(id, updateData);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        logAudit(req.user.id, 'update', 'suppliers', parseInt(id), oldSupplier, updateData, req.ip);

        res.status(200).json({
            success: true,
            message: 'Supplier updated successfully',
            data: supplier
        });
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating supplier'
        });
    }
};

exports.deleteSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        const left = await Supplier.stillCarries(id);
        await Supplier.delete(id);

        logAudit(req.user.id, 'delete', 'suppliers', parseInt(id), null, null, req.ip);

        // their products and unfinished orders are not deleted with them: say what is left to deal with
        const notes = [];
        if (left.products) notes.push(`${left.products} product${left.products === 1 ? ' now has' : 's now have'} no supplier. Assign one in Inventory before reordering.`);
        if (left.open_orders) notes.push(`${left.open_orders} order${left.open_orders === 1 ? ' is' : 's are'} still in progress with them.`);
        res.status(200).json({
            success: true,
            message: ['Supplier deleted successfully.', ...notes].join(' '),
            left
        });
    } catch (error) {
        console.error('Delete supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting supplier'
        });
    }
};

exports.getSupplierPerformance = async (req, res) => {
    try {
        const { id } = req.params;
        const [records, rating, received] = await Promise.all([
            SupplierPerformance.getBySupplier(id),
            SupplierPerformance.getSupplierRating(id),
            SupplierPerformance.scorecardOrders(id)
        ]);
        const score = scorecard(received);

        res.status(200).json({
            success: true,
            data: {
                records,
                rating,
                score,
                stars: starRating(score)
            }
        });
    } catch (error) {
        console.error('Get supplier performance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving supplier performance'
        });
    }
};
