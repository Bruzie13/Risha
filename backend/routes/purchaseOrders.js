const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const supplyController = require('../controllers/supplyController');

router.get('/', authenticateToken, purchaseOrderController.getAllPOs);
// Static paths before '/:id', or Express reads them as an order id.
router.get('/deliveries', authenticateToken, supplyController.getBoard);
router.post('/price-proposals/:id/decide', authenticateToken, authorizeRole('admin', 'manager'), supplyController.decidePrice);
router.get('/price-proposals/:id', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getPriceDetails);
// products a supplier offered that the shop does not sell yet (UAT part 4)
router.get('/new-products', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getNewProducts);
router.get('/new-products/:id', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getNewProduct);
router.post('/new-products/:id/decline', authenticateToken, authorizeRole('admin', 'manager'), supplyController.declineNewProduct);
router.post('/new-products/:id/added', authenticateToken, authorizeRole('admin', 'manager'), supplyController.newProductAdded);
router.get('/:id/messages', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getMessages);
router.post('/:id/messages', authenticateToken, authorizeRole('admin', 'manager'), supplyController.postMessage);
router.put('/:id/payment', authenticateToken, authorizeRole('admin', 'manager'), supplyController.setPayment);
router.get('/:id/receipt', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getReceipt);
router.get('/:id/order-receipt', authenticateToken, authorizeRole('admin', 'manager'), supplyController.getOrderReceipt);
router.post('/auto-generate', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.autoGeneratePO);
router.put('/:id/status', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.updatePOStatus);
router.post('/:id/send-email', authenticateToken, authorizeRole('admin', 'manager'), purchaseOrderController.emailPO);

module.exports = router;
