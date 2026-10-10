const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const LOGIN_WINDOW = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

/* Each family of endpoints gets its own counter. Sharing one would mean a
   staff member who fumbles their password twice can no longer open the
   confirmation link in their inbox — two unrelated actions punishing each
   other from the same shop IP.

   `failuresOnly` counts a request only when it was refused. A whole shop sits
   behind one IP address: counting successful sign-ins too meant the sixth
   person to sign in within 15 minutes was told "Too many login attempts",
   having done nothing wrong. */
function makeRateLimiter(attempts, max, window, label, { failuresOnly = false } = {}) {
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
        const count = () => {
            const entry = attempts.get(ip) || { count: 0, windowStart: Date.now() };
            entry.count++;
            attempts.set(ip, entry);
        };
        if (failuresOnly) {
            res.on('finish', () => { if (res.statusCode >= 400) count(); });
        } else {
            count();
        }
        next();
    };
}

// Sign-in: five refused attempts in 15 minutes locks the address out.
const loginAttempts = new Map();
const rateLimitLogin = makeRateLimiter(loginAttempts, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW, 'login', { failuresOnly: true });

// Asking for a reset counts every time (it always answers "success", by
// design), so it has its own, slightly roomier, counter.
const forgotAttempts = new Map();
const rateLimitForgot = makeRateLimiter(forgotAttempts, 8, LOGIN_WINDOW, 'password reset');

// Choosing the new password: mistyping the password rules is not a sign-in
// failure and must not lock anybody out of signing in.
const resetAttempts = new Map();
const rateLimitReset = makeRateLimiter(resetAttempts, 10, LOGIN_WINDOW, 'password reset', { failuresOnly: true });

// Confirming is a link click, not a guess — one shop can legitimately have
// several new staff clicking through in the same window.
const verifyAttempts = new Map();
const rateLimitVerify = makeRateLimiter(verifyAttempts, 15, LOGIN_WINDOW, 'verification');

router.post('/login', rateLimitLogin, authController.login);
router.post('/forgot-password', rateLimitForgot, authController.forgotPassword);
router.post('/reset-password', rateLimitReset, authController.resetPassword);
router.post('/verify-email', rateLimitVerify, authController.verifyEmail);
router.post('/resend-verification', rateLimitVerify, authController.resendVerification);
router.post('/logout', authController.logout);
router.post('/email-code', authenticateToken, authorizeRole('admin'), authController.sendEmailVerificationCode);
router.post('/register', authenticateToken, authorizeRole('admin'), authController.register);
router.get('/verify', authenticateToken, authController.verifyToken);
router.get('/users', authenticateToken, authorizeRole('admin'), authController.getAllUsers);
router.put('/users/:id', authenticateToken, authorizeRole('admin'), authController.updateUser);
router.put('/users/:id/status', authenticateToken, authorizeRole('admin'), authController.toggleUserStatus);
router.post('/users/:id/resend-verification', authenticateToken, authorizeRole('admin'), authController.adminResendVerification);
router.delete('/users/:id', authenticateToken, authorizeRole('admin'), authController.deleteUser);

// Forgotten passwords wait here for an administrator's decision.
router.get('/reset-requests', authenticateToken, authorizeRole('admin'), authController.listResetRequests);
router.post('/reset-requests/:id/:decision', authenticateToken, authorizeRole('admin'), authController.decideResetRequest);

router.put('/profile', authenticateToken, authController.updateProfile);
router.put('/change-password', authenticateToken, authController.changePassword);

module.exports = router;
