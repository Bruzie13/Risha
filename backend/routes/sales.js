const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { SELLING_ROLES } = require('../utils/roles');
const tillController = require('../controllers/tillController');

router.get('/', authenticateToken, saleController.getAllSales);
router.get('/stats', authenticateToken, saleController.getSalesStats);
router.get('/daily-sales', authenticateToken, saleController.getDailySales);
router.get('/weekly-sales', authenticateToken, saleController.getWeeklySales);
router.get('/monthly-sales', authenticateToken, saleController.getMonthlySales);
router.get('/total-sales', authenticateToken, saleController.getTotalSales);
router.get('/report', authenticateToken, saleController.getSalesReport);
router.get('/top-products', authenticateToken, saleController.getTopProducts);
// Till (cashier) — static paths, so they sit above '/:id'
router.get('/till', authenticateToken, authorizeRole('cashier'), tillController.getTill);
router.post('/till/open', authenticateToken, authorizeRole('cashier'), tillController.openTill);
router.get('/mine', authenticateToken, authorizeRole('cashier'), tillController.getMySales);
router.get('/pos-settings', authenticateToken, authorizeRole('admin', 'manager'), tillController.getPosSettings);
router.put('/pos-settings', authenticateToken, authorizeRole('admin'), tillController.savePosSettings);
router.delete('/eod/:id', authenticateToken, authorizeRole('admin', 'manager'), tillController.reopenCount);
router.get('/eod', authenticateToken, saleController.getEod);
router.get('/eod/history', authenticateToken, saleController.getEodHistory);
router.post('/eod', authenticateToken, authorizeRole('admin', 'manager', 'cashier'), saleController.saveEod);
router.get('/:id', authenticateToken, saleController.getSaleById);
router.post('/:id/void', authenticateToken, authorizeRole('admin', 'manager'), saleController.voidSale);
router.post('/:id/void-request', authenticateToken, authorizeRole('cashier'), tillController.requestVoid);
router.post('/:id/void-request/dismiss', authenticateToken, authorizeRole('admin', 'manager'), tillController.dismissVoidRequest);
// Selling is the cashier's job. Admins and managers manage inventory instead.
router.post('/', authenticateToken, authorizeRole(...SELLING_ROLES), saleController.createSale);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), saleController.updateSale);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), saleController.deleteSale);

module.exports = router;
