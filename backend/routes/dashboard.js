const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');

router.get('/stats', authenticateToken, dashboardController.getDashboardStats);
router.get('/charts', authenticateToken, dashboardController.getChartData);
router.get('/expiration-risk', authenticateToken, dashboardController.getExpirationRisk);

module.exports = router;
