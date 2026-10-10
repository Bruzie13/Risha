const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, supplierController.getAllSuppliers);
// Static paths must come before '/:id' or Express matches them as an id.
router.get('/:id/performance', authenticateToken, supplierController.getSupplierPerformance);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), supplierController.createSupplier);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), supplierController.updateSupplier);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), supplierController.deleteSupplier);

module.exports = router;
