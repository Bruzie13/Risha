const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

/* Whether a notice has been read is one mark shared by everyone, and clearing
   deletes the notice for everyone. A view-only account may read the notices
   but not change them: marking and clearing belong to the people who run the
   shop. (Till and supplier accounts never reach this file; see utils/roles.js.) */
const canChangeNotices = authorizeRole('admin', 'manager');

router.get('/', authenticateToken, notificationController.getAllNotifications);
router.get('/summary', authenticateToken, notificationController.getSummary);
router.get('/count', authenticateToken, notificationController.getNotificationCount);
router.get('/:id/details', authenticateToken, notificationController.getDetails);
router.put('/read-all', authenticateToken, canChangeNotices, notificationController.markAllAsRead);
router.put('/:id/read', authenticateToken, canChangeNotices, notificationController.markAsRead);
router.delete('/read', authenticateToken, canChangeNotices, notificationController.clearRead);

module.exports = router;
