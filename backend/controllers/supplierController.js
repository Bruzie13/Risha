const Supplier = require('../models/Supplier');
const SupplierPerformance = require('../models/SupplierPerformance');
const PurchaseOrder = require('../models/PurchaseOrder');
const logAudit = require('../services/audit');

exports.getAllSuppliers = async (req, res) => {
    try {
        const suppliers = await Supplier.getAll();
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
        const { name, contact_person, email, phone, address, city, payment_terms } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

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
        await Supplier.delete(id);

        logAudit(req.user.id, 'delete', 'suppliers', parseInt(id), null, null, req.ip);

        res.status(200).json({
            success: true,
            message: 'Supplier deleted successfully'
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
        const [records, rating] = await Promise.all([
            SupplierPerformance.getBySupplier(id),
            SupplierPerformance.getSupplierRating(id)
        ]);

        res.status(200).json({
            success: true,
            data: {
                records,
                rating
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
