const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, notificationController.getAllNotifications);
router.get('/summary', authenticateToken, notificationController.getSummary);
router.get('/count', authenticateToken, notificationController.getNotificationCount);
router.put('/read-all', authenticateToken, notificationController.markAllAsRead);
router.put('/:id/read', authenticateToken, notificationController.markAsRead);
router.delete('/read', authenticateToken, notificationController.clearRead);

module.exports = router;
