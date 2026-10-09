const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { SELLING_ROLES } = require('../utils/roles');

router.get('/', authenticateToken, saleController.getAllSales);
router.get('/stats', authenticateToken, saleController.getSalesStats);
router.get('/daily-sales', authenticateToken, saleController.getDailySales);
router.get('/weekly-sales', authenticateToken, saleController.getWeeklySales);
router.get('/monthly-sales', authenticateToken, saleController.getMonthlySales);
router.get('/total-sales', authenticateToken, saleController.getTotalSales);
router.get('/report', authenticateToken, saleController.getSalesReport);
router.get('/top-products', authenticateToken, saleController.getTopProducts);
router.get('/eod', authenticateToken, saleController.getEod);
router.get('/eod/history', authenticateToken, saleController.getEodHistory);
router.post('/eod', authenticateToken, authorizeRole('admin', 'manager', 'staff'), saleController.saveEod);
router.get('/:id', authenticateToken, saleController.getSaleById);
router.post('/:id/void', authenticateToken, authorizeRole('admin', 'manager'), saleController.voidSale);
// Selling is the till's job: cashier accounts, and the floor staff who
// already ran it. Admins and managers manage inventory instead.
router.post('/', authenticateToken, authorizeRole(...SELLING_ROLES), saleController.createSale);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), saleController.updateSale);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), saleController.deleteSale);

module.exports = router;
