const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/', authenticateToken, notificationController.getAllNotifications);
router.get('/unread', authenticateToken, notificationController.getUnreadNotifications);
router.post('/', authenticateToken, authorizeRole('admin'), notificationController.createNotification);
router.put('/read-all', authenticateToken, notificationController.markAllAsRead);
router.put('/:id/read', authenticateToken, notificationController.markAsRead);
router.delete('/:id', authenticateToken, authorizeRole('admin'), notificationController.deleteNotification);

module.exports = router;
