const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, auditController.getAuditLogs);

module.exports = router;
