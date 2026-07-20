const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, notificationController.getAllNotifications);
router.get('/summary', authenticateToken, notificationController.getSummary);
router.get('/unread', authenticateToken, notificationController.getUnreadNotifications);
router.get('/count', authenticateToken, notificationController.getNotificationCount);
router.get('/alerts', authenticateToken, notificationController.getAlerts);
router.post('/', authenticateToken, authorizeRole('admin'), notificationController.createNotification);
router.put('/read-all', authenticateToken, notificationController.markAllAsRead);
router.put('/:id/read', authenticateToken, notificationController.markAsRead);
router.delete('/read', authenticateToken, notificationController.clearRead);
router.delete('/old', authenticateToken, authorizeRole('admin'), notificationController.deleteOldNotifications);
router.delete('/:id', authenticateToken, authorizeRole('admin'), notificationController.deleteNotification);

module.exports = router;
