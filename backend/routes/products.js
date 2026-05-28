const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', productController.getAllProducts);
router.get('/low-stock', productController.getLowStockProducts);
router.get('/expiring', productController.getExpiringProducts);
router.get('/overstock', productController.getOverstockProducts);
router.get('/barcode', productController.getProductByBarcode);
router.get('/categories', productController.getCategories);
router.get('/suppliers', productController.getSuppliers);
router.get('/species', productController.getSpecies);
router.get('/:id', productController.getProductById);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), productController.createProduct);
router.post('/bulk', authenticateToken, authorizeRole('admin', 'manager'), productController.bulkCreateProducts);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), productController.updateProduct);
router.put('/:id/stock', authenticateToken, authorizeRole('admin', 'manager'), productController.adjustStock);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), productController.deleteProduct);

module.exports = router;
