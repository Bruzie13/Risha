const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, productController.getAllProducts);
router.get('/stock-levels', authenticateToken, productController.getStockLevels);
router.get('/image-ids', authenticateToken, productController.getImageIds);   // which products have a photo, ids only
router.get('/stats', authenticateToken, productController.getProductStats);
router.get('/low-stock', authenticateToken, productController.getLowStockProducts);
router.get('/categories', authenticateToken, productController.getCategories);
router.get('/next-sku', authenticateToken, authorizeRole('admin', 'manager'), productController.getNextSku);
router.get('/:id/image', productController.getProductImage);   // no sign-in: an <img> cannot send one
// a product's suppliers, compared (Carlo, 14 Nov)
const productSuppliers = require('../controllers/productSupplierController');
router.get('/:id/suppliers', authenticateToken, authorizeRole('admin', 'manager'), productSuppliers.getSuppliers);
router.post('/:id/suppliers', authenticateToken, authorizeRole('admin'), productSuppliers.addSupplier);
router.delete('/:id/suppliers/:supplierId', authenticateToken, authorizeRole('admin'), productSuppliers.removeSupplier);
router.get('/:id', authenticateToken, productController.getProductById);
router.post('/', authenticateToken, authorizeRole('admin', 'manager'), productController.createProduct);
router.post('/bulk', authenticateToken, authorizeRole('admin', 'manager'), productController.bulkCreateProducts);
router.put('/:id', authenticateToken, authorizeRole('admin', 'manager'), productController.updateProduct);
router.put('/:id/stock', authenticateToken, authorizeRole('admin', 'manager'), productController.adjustStock);
router.put('/:id/restore', authenticateToken, authorizeRole('admin', 'manager'), productController.restoreProduct);
router.delete('/:id', authenticateToken, authorizeRole('admin', 'manager'), productController.deleteProduct);

module.exports = router;
