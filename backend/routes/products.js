const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, productController.getAllProducts);
router.get('/low-stock', authenticateToken, productController.getLowStockProducts);
router.get('/expiring', authenticateToken, productController.getExpiringProducts);
router.get('/overstock', authenticateToken, productController.getOverstockProducts);
router.get('/barcode', authenticateToken, productController.getProductByBarcode);
router.get('/categories', authenticateToken, productController.getCategories);
router.get('/suppliers', authenticateToken, productController.getSuppliers);
router.get('/species', authenticateToken, productController.getSpecies);
router.get('/:id', authenticateToken, productController.getProductById);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), productController.createProduct);
router.post('/bulk', authenticateToken, authorizeRole('admin', 'manager'), productController.bulkCreateProducts);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), productController.updateProduct);
router.put('/:id/stock', authenticateToken, authorizeRole('admin', 'manager'), productController.adjustStock);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), productController.deleteProduct);

module.exports = router;
