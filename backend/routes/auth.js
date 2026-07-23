const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const loginAttempts = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function rateLimitLogin(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (record && now - record.windowStart > LOGIN_WINDOW) {
        loginAttempts.delete(ip);
    }
    const current = loginAttempts.get(ip) || { count: 0, windowStart: now };
    if (current.count >= MAX_LOGIN_ATTEMPTS) {
        const remaining = Math.ceil((current.windowStart + LOGIN_WINDOW - now) / 1000);
        return res.status(429).json({ success: false, message: `Too many login attempts. Try again in ${remaining}s.` });
    }
    current.count++;
    loginAttempts.set(ip, current);
    next();
}

router.post('/login', rateLimitLogin, authController.login);
router.post('/forgot-password', rateLimitLogin, authController.forgotPassword);
router.post('/reset-password', rateLimitLogin, authController.resetPassword);
router.post('/logout', authController.logout);
router.post('/register', authenticateToken, authorizeRole('admin'), authController.register);
router.get('/verify', authenticateToken, authController.verifyToken);
router.get('/users', authenticateToken, authorizeRole('admin'), authController.getAllUsers);
router.get('/users/:id', authenticateToken, authorizeRole('admin'), authController.getUserById);
router.put('/users/:id', authenticateToken, authorizeRole('admin'), authController.updateUser);
router.put('/users/:id/role', authenticateToken, authorizeRole('admin'), authController.updateUserRole);
router.put('/users/:id/status', authenticateToken, authorizeRole('admin'), authController.toggleUserStatus);
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), authController.deleteUser);

router.put('/profile', authenticateToken, authController.updateProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
