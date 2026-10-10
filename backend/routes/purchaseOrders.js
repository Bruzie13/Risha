const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const supplyController = require('../controllers/supplyController');

router.get('/', authenticateToken, purchaseOrderController.getAllPOs);
// Static paths before '/:id', or Express reads them as an order id.
router.get('/deliveries', authenticateToken, supplyController.getBoard);
router.post('/price-proposals/:id/decide', authenticateToken, authorizeRole('admin', 'manager'), supplyController.decidePrice);
router.get('/:id/messages', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getMessages);
router.post('/:id/messages', authenticateToken, authorizeRole('admin', 'manager'), supplyController.postMessage);
router.put('/:id/payment', authenticateToken, authorizeRole('admin', 'manager'), supplyController.setPayment);
router.post('/auto-generate', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.autoGeneratePO);
router.put('/:id/status', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.updatePOStatus);
router.post('/:id/send-email', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.emailPO);

module.exports = router;
