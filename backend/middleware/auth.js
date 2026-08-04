const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'No token provided'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        /* A valid signature only proves the token was ours when it was minted.
           Check it still stands: the account must be active, and the token's
           version must match the account's. Deactivating, demoting or changing
           a password bumps that version, which retires every token issued
           before it — otherwise a sacked employee keeps full access for the
           rest of the 24-hour lifetime. */
        try {
            const conn = await pool.getConnection();
            let rows;
            try {
                [rows] = await conn.execute(
                    'SELECT is_active, role, token_version FROM users WHERE id = ?',
                    [user.id]
                );
            } finally {
                conn.release();
            }

            if (!rows.length || !rows[0].is_active) {
                return res.status(403).json({ success: false, message: 'This account is no longer active. Please sign in again.' });
            }
            if (Number(rows[0].token_version) !== Number(user.tv || 0)) {
                return res.status(403).json({ success: false, message: 'Your session has expired. Please sign in again.' });
            }

            // Trust the database for the role, not the token: a demotion takes
            // effect immediately rather than at the next sign-in.
            user.role = rows[0].role;
            req.user = user;
            next();
        } catch (e) {
            console.error('Auth check error:', e.message);
            return res.status(500).json({ success: false, message: 'Could not verify session' });
        }
    });
};

const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions'
            });
        }
        next();
    };
};

module.exports = {
    authenticateToken,
    authorizeRole
};