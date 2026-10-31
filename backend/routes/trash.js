const express = require('express');
const router = express.Router();
const trashController = require('../controllers/trashController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, authorizeRole('admin', 'manager'), trashController.getTrash);
router.put('/suppliers/:id/restore', authenticateToken, authorizeRole('admin', 'manager'), trashController.restoreSupplier);
router.delete('/:kind/:id', authenticateToken, authorizeRole('admin', 'manager'), trashController.purge);
router.get('/settings', authenticateToken, authorizeRole('admin', 'manager'), trashController.getSettings);
router.put('/settings', authenticateToken, authorizeRole('admin'), trashController.saveSettings);

module.exports = router;
