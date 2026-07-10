const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Audit trail exposes every user's actions and IPs — admins only
router.get('/', authenticateToken, authorizeRole('admin'), auditController.getAuditLogs);

module.exports = router;
