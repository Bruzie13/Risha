const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, purchaseOrderController.getAllPOs);
router.get('/:id', authenticateToken, purchaseOrderController.getPOById);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.createPO);
router.post('/auto-generate', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.autoGeneratePO);
router.put('/:id/status', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.updatePOStatus);
router.post('/:id/send-email', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.emailPO);
router.delete('/:id', authenticateToken, authorizeRole('admin'), purchaseOrderController.deletePO);

module.exports = router;
