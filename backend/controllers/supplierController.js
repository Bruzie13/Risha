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

exports.getSupplierById = async (req, res) => {
    try {
        const { id } = req.params;
        const supplier = await Supplier.findById(id);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        res.status(200).json({
            success: true,
            data: supplier
        });
    } catch (error) {
        console.error('Get supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving supplier'
        });
    }
};

exports.createSupplier = async (req, res) => {
    try {
        const { name, contact_person, email, phone, address, city, payment_terms } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

        const supplier = await Supplier.create({
            name,
            contact_person,
            email,
            phone,
            address,
            city,
            payment_terms
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
        const updateData = req.body;

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

exports.recordDeliveryMetric = async (req, res) => {
    try {
        const { id } = req.params;
        const { order_id, delivery_date } = req.body;

        if (!order_id) {
            return res.status(400).json({
                success: false,
                message: 'order_id is required'
            });
        }

        const po = await PurchaseOrder.findById(order_id);
        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        const actualDelivery = delivery_date ? new Date(delivery_date) : new Date();
        const expected = new Date(po.expected_delivery_date);
        const diffDays = Math.max(0, Math.ceil((actualDelivery - expected) / (1000 * 60 * 60 * 24)));
        const onTime = actualDelivery <= expected ? 1 : 0;

        await SupplierPerformance.addMetric(id, order_id, 'delivery_time', diffDays, `Delivered on ${actualDelivery.toISOString().split('T')[0]}`);
        await SupplierPerformance.addMetric(id, order_id, 'on_time_delivery', onTime, onTime ? 'On-time delivery' : `Late by ${diffDays} day(s)`);

        logAudit(req.user.id, 'create', 'supplier_performance', null, null, { supplier_id: id, order_id, on_time: !!onTime }, req.ip);

        res.status(201).json({
            success: true,
            message: onTime ? 'On-time delivery recorded' : `Late delivery recorded (${diffDays} day(s) late)`,
            data: { delivery_days: diffDays, on_time: !!onTime }
        });
    } catch (error) {
        console.error('Record delivery metric error:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording delivery metric'
        });
    }
};
