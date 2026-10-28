const express = require('express');
const router = express.Router();
const trashController = require('../controllers/trashController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, authorizeRole('admin', 'manager'), trashController.getTrash);
router.put('/suppliers/:id/restore', authenticateToken, authorizeRole('admin', 'manager'), trashController.restoreSupplier);

module.exports = router;
