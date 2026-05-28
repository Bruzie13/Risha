const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.post('/login', authController.login);
router.post('/register', authenticateToken, authorizeRole('admin'), authController.register);
router.get('/verify', authenticateToken, authController.verifyToken);
router.get('/users', authenticateToken, authorizeRole('admin'), authController.getAllUsers);
router.get('/users/:id', authenticateToken, authorizeRole('admin'), authController.getUserById);
router.put('/users/:id', authenticateToken, authorizeRole('admin'), authController.updateUser);
router.put('/users/:id/role', authenticateToken, authorizeRole('admin'), authController.updateUserRole);
router.put('/users/:id/status', authenticateToken, authorizeRole('admin'), authController.toggleUserStatus);
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), authController.deleteUser);

module.exports = router;
