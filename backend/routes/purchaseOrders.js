const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, purchaseOrderController.getAllPOs);
// Static path before '/:id', or Express reads "deliveries" as an order id.
router.get('/deliveries', authenticateToken, purchaseOrderController.getActiveDeliveries);
router.get('/route', authenticateToken, purchaseOrderController.getRoute);
router.get('/:id', authenticateToken, purchaseOrderController.getPOById);
router.get('/:id/tracking', authenticateToken, purchaseOrderController.getTracking);
router.post('/:id/tracking-link', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.createTrackingLink);
router.post('/:id/tracking-link/email', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.emailTrackingLink);
router.delete('/:id/tracking-link', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.revokeTrackingLink);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.createPO);
router.post('/auto-generate', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.autoGeneratePO);
router.put('/:id/status', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.updatePOStatus);
router.post('/:id/send-email', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.emailPO);
router.delete('/:id', authenticateToken, authorizeRole('admin'), purchaseOrderController.deletePO);

module.exports = router;
