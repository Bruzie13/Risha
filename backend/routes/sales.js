const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', saleController.getAllSales);
router.get('/daily-sales', saleController.getDailySales);
router.get('/weekly-sales', saleController.getWeeklySales);
router.get('/monthly-sales', saleController.getMonthlySales);
router.get('/total-sales', saleController.getTotalSales);
router.get('/report', authenticateToken, saleController.getSalesReport);
router.get('/top-products', saleController.getTopProducts);
router.get('/:id', saleController.getSaleById);
router.post('/', authenticateToken, authorizeRole('admin', 'manager', 'staff'), saleController.createSale);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), saleController.updateSale);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), saleController.deleteSale);

module.exports = router;
