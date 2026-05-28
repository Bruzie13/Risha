const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, supplierController.getAllSuppliers);
router.get('/:id', authenticateToken, supplierController.getSupplierById);
router.get('/:id/performance', authenticateToken, supplierController.getSupplierPerformance);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), supplierController.createSupplier);
router.post('/:id/performance', authenticateToken, authorizeRole('admin', 'manager'), supplierController.recordDeliveryMetric);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), supplierController.updateSupplier);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), supplierController.deleteSupplier);

module.exports = router;
