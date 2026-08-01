const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

/* Each family of endpoints gets its own counter. Sharing one would mean a
   staff member who fumbles their password twice can no longer open the
   confirmation link in their inbox — two unrelated actions punishing each
   other from the same shop IP. */
function makeRateLimiter(attempts, max, window, label) {
    return function (req, res, next) {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const record = attempts.get(ip);
        if (record && now - record.windowStart > window) {
            attempts.delete(ip);
        }
        const current = attempts.get(ip) || { count: 0, windowStart: now };
        if (current.count >= max) {
            const remaining = Math.ceil((current.windowStart + window - now) / 1000);
            return res.status(429).json({ success: false, message: `Too many ${label} attempts. Try again in ${remaining}s.` });
        }
        current.count++;
        attempts.set(ip, current);
        next();
    };
}

const loginAttempts = new Map();
const rateLimitLogin = makeRateLimiter(loginAttempts, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW, 'login');

// Confirming is a link click, not a guess — one shop can legitimately have
// several new staff clicking through in the same window.
const verifyAttempts = new Map();
const rateLimitVerify = makeRateLimiter(verifyAttempts, 15, LOGIN_WINDOW, 'verification');

router.post('/login', rateLimitLogin, authController.login);
router.post('/forgot-password', rateLimitLogin, authController.forgotPassword);
router.post('/reset-password', rateLimitLogin, authController.resetPassword);
router.post('/verify-email', rateLimitVerify, authController.verifyEmail);
router.post('/resend-verification', rateLimitVerify, authController.resendVerification);
router.post('/logout', authController.logout);
router.post('/email-code', authenticateToken, authorizeRole('admin'), authController.sendEmailVerificationCode);
router.post('/register', authenticateToken, authorizeRole('admin'), authController.register);
router.get('/verify', authenticateToken, authController.verifyToken);
router.get('/users', authenticateToken, authorizeRole('admin'), authController.getAllUsers);
router.get('/users/:id', authenticateToken, authorizeRole('admin'), authController.getUserById);
router.put('/users/:id', authenticateToken, authorizeRole('admin'), authController.updateUser);
router.put('/users/:id/role', authenticateToken, authorizeRole('admin'), authController.updateUserRole);
router.put('/users/:id/status', authenticateToken, authorizeRole('admin'), authController.toggleUserStatus);
router.post('/users/:id/resend-verification', authenticateToken, authorizeRole('admin'), authController.adminResendVerification);
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), authController.deleteUser);

router.put('/profile', authenticateToken, authController.updateProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
