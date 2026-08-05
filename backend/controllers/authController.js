const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const logAudit = require('../services/audit');
const { notifyUserLogin } = require('../services/notifier');
const { validatePassword } = require('../utils/passwordPolicy');
const { sendPasswordResetEmail, sendVerificationEmail, sendEmailCode, sendWelcomeEmail, isValidEmail } = require('../utils/mailer');

// Brute-force protection: after 5 failed logins per IP+username within
// 10 minutes, further attempts are rejected until the window expires.
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

function attemptKey(req, username) {
    return `${req.ip}|${String(username || '').toLowerCase()}`;
}

function tooManyAttempts(key) {
    const entry = loginAttempts.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
        loginAttempts.delete(key);
        return false;
    }
    return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
    const now = Date.now();
    const entry = loginAttempts.get(key);
    if (!entry || now - entry.first > ATTEMPT_WINDOW_MS) {
        loginAttempts.set(key, { count: 1, first: now });
    } else {
        entry.count++;
    }
    // keep the map from growing unbounded
    if (loginAttempts.size > 10000) {
        for (const [k, v] of loginAttempts) {
            if (now - v.first > ATTEMPT_WINDOW_MS) loginAttempts.delete(k);
        }
    }
}

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// j***doe@gmail.com — enough for the owner to recognise which inbox to open,
// not enough to hand a full address to whoever is looking at the screen.
function maskEmail(email) {
    if (!isValidEmail(email)) return 'your email address';
    const [local, domain] = String(email).trim().split('@');
    const head = local.slice(0, 1);
    const tail = local.length > 2 ? local.slice(-1) : '';
    return `${head}***${tail}@${domain}`;
}

/**
 * Issue a fresh confirmation link for a user and email it out.
 * Any previously issued token stops working the moment this replaces it.
 */
async function issueVerificationEmail(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    const conn = await pool.getConnection();
    try {
        await conn.execute(
            'UPDATE users SET verify_token_hash = ?, verify_token_expires = ?, email_verified = 0 WHERE id = ?',
            [tokenHash, expires, user.id]
        );
    } finally {
        conn.release();
    }

    await sendVerificationEmail(user.email, user.full_name, token);
}

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

/**
 * Admin-only. Mails a 6-digit code to the address being registered, so the
 * inbox has to actually exist before the account can be created.
 */
exports.sendEmailVerificationCode = async (req, res) => {
    try {
        const email = String(req.body.email || '').trim();
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Enter a valid email address first' });
        }

        // No point mailing a code for an address that can never be registered.
        const owner = await User.findAnyByEmail(email);
        if (owner) {
            return res.status(400).json({
                success: false,
                message: owner.is_active
                    ? `That email address is already used by ${owner.username}.`
                    : `That email address belongs to a deactivated account (${owner.username}).`
            });
        }

        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expires = new Date(Date.now() + EMAIL_CODE_TTL_MS);

        const conn = await pool.getConnection();
        try {
            // Re-requesting replaces the pending code and clears the attempt count.
            await conn.execute(
                `INSERT INTO email_verification_codes (email, code_hash, expires_at, attempts, requested_by)
                 VALUES (?, ?, ?, 0, ?)
                 ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), attempts = 0, requested_by = VALUES(requested_by)`,
                [email, codeHash, expires, req.user.id]
            );
        } finally {
            conn.release();
        }

        await sendEmailCode(email, code);
        logAudit(req.user.id, 'email_code_sent', 'users', null, null, { email }, req.ip);

        res.status(200).json({
            success: true,
            message: `A 6-digit code was sent to ${email}. It expires in 10 minutes.`
        });
    } catch (error) {
        console.error('Send email code error:', error);
        res.status(500).json({ success: false, message: 'Could not send the code: ' + error.message });
    }
};

/**
 * Check a submitted code against the pending one for that address.
 * Returns an error string, or null when the code is good (and consumed).
 */
async function consumeEmailCode(email, code) {
    if (!code || !/^\d{6}$/.test(String(code).trim())) {
        return 'Enter the 6-digit code that was emailed to that address.';
    }

    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.execute(
            'SELECT code_hash, attempts, expires_at > NOW() AS still_valid FROM email_verification_codes WHERE email = ?',
            [email]
        );
        if (!rows.length) {
            return 'No code has been sent to that address yet. Use "Send code" first.';
        }
        const row = rows[0];
        if (!Number(row.still_valid)) {
            await conn.execute('DELETE FROM email_verification_codes WHERE email = ?', [email]);
            return 'That code has expired. Send a new one.';
        }
        if (row.attempts >= MAX_CODE_ATTEMPTS) {
            await conn.execute('DELETE FROM email_verification_codes WHERE email = ?', [email]);
            return 'Too many incorrect attempts. Send a new code.';
        }

        const submitted = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
        // Both sides are fixed-length hex digests, so timingSafeEqual is safe here.
        const match = crypto.timingSafeEqual(Buffer.from(submitted, 'hex'), Buffer.from(row.code_hash, 'hex'));
        if (!match) {
            await conn.execute('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ?', [email]);
            const left = MAX_CODE_ATTEMPTS - (row.attempts + 1);
            return `That code is not correct. ${left > 0 ? left + ' attempt(s) left.' : 'Send a new code.'}`;
        }

        await conn.execute('DELETE FROM email_verification_codes WHERE email = ?', [email]);
        return null;
    } finally {
        conn.release();
    }
}

const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            // Checked on every request; raising the stored version retires
            // every token minted before it. See bumpTokenVersion below.
            tv: Number(user.token_version) || 0
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

/**
 * End every existing session for a user. Called wherever their access should
 * stop mattering immediately: deactivation, deletion, role change, password
 * change or reset.
 */
async function bumpTokenVersion(userId) {
    const conn = await pool.getConnection();
    try {
        await conn.execute('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
    } catch (e) {
        console.error('Failed to bump token version for user', userId, e.message);
    } finally {
        conn.release();
    }
}

exports.login = async (req, res) => {
    try {
        const { username, password, remember } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }

        const key = attemptKey(req, username);
        if (tooManyAttempts(key)) {
            return res.status(429).json({
                success: false,
                message: 'Too many failed login attempts. Please try again in a few minutes.'
            });
        }

        const user = await User.findByUsername(username);
        if (!user) {
            recordFailure(key);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        if (!user.is_active) {
            return res.status(401).json({
                success: false,
                message: 'User account is inactive'
            });
        }

        const isPasswordValid = await User.verifyPassword(password, user.password);
        if (!isPasswordValid) {
            recordFailure(key);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        // Password was right, so this is the real owner of the account — but the
        // address on file is still unproven. Say so plainly (the password is
        // already confirmed, so this leaks nothing an attacker doesn't have).
        if (Number(user.email_verified) === 0) {
            loginAttempts.delete(key);
            return res.status(403).json({
                success: false,
                code: 'EMAIL_NOT_VERIFIED',
                message: 'Please confirm your email address first. Check ' + maskEmail(user.email) + ' for the confirmation link.'
            });
        }

        loginAttempts.delete(key);

        const token = generateToken(user);

        logAudit(user.id, 'login', 'users', user.id, null, null, req.ip);

        notifyUserLogin(user, req.ip).catch(e => console.error('Notif error:', e.message));

        /* HttpOnly cookie for the server-side page guard (not readable by JS).
           Without "remember" it is deliberately given no maxAge, which makes it
           a session cookie the browser drops on close — matching where the
           client puts the token. If the two disagreed, closing the browser
           would clear the token but leave the cookie still admitting you to
           pages. */
        const cookieOpts = {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/'
        };
        if (remember) cookieOpts.maxAge = 24 * 60 * 60 * 1000;
        res.cookie('token', token, cookieOpts);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            token: token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                avatar: user.avatar || null
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
};

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

// Always answers with the same generic message so the endpoint can't be
// used to probe which usernames/emails exist.
exports.forgotPassword = async (req, res) => {
    const genericResponse = {
        success: true,
        message: 'If that account exists, a reset link has been sent to its email address.'
    };
    try {
        const { username } = req.body;
        if (!username || !String(username).trim()) {
            return res.status(400).json({ success: false, message: 'Username or email is required' });
        }

        const input = String(username).trim();
        let user = await User.findByUsername(input);
        if (!user && isValidEmail(input)) user = await User.findByEmail(input);

        if (!user || !user.is_active || !isValidEmail(user.email)) {
            return res.status(200).json(genericResponse);
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        const conn = await pool.getConnection();
        try {
            await conn.execute(
                'UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?',
                [tokenHash, expires, user.id]
            );
        } finally {
            conn.release();
        }

        await sendPasswordResetEmail(user.email, user.full_name, token);
        logAudit(user.id, 'password_reset_requested', 'users', user.id, null, null, req.ip);

        res.status(200).json(genericResponse);
    } catch (error) {
        console.error('Forgot password error:', error.message);
        // Same generic answer on send failure — details go to the server log only
        res.status(200).json(genericResponse);
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ success: false, message: 'Token and new password are required' });
        }

        const pwError = validatePassword(newPassword);
        if (pwError) {
            return res.status(400).json({ success: false, message: pwError });
        }

        const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
        const conn = await pool.getConnection();
        let rows;
        try {
            [rows] = await conn.execute(
                'SELECT id FROM users WHERE reset_token_hash = ? AND reset_token_expires > NOW() AND is_active = 1',
                [tokenHash]
            );
        } finally {
            conn.release();
        }

        if (!rows.length) {
            return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired. Please request a new one.' });
        }

        const userId = rows[0].id;
        await User.update(userId, { password: newPassword });

        const conn2 = await pool.getConnection();
        try {
            await conn2.execute(
                'UPDATE users SET reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?',
                [userId]
            );
        } finally {
            conn2.release();
        }

        // Whoever prompted the reset may already hold a live token — retire it.
        await bumpTokenVersion(userId);
        logAudit(userId, 'password_reset', 'users', userId, null, null, req.ip);
        res.status(200).json({ success: true, message: 'Password has been reset. You can now sign in.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error resetting password' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('token', { path: '/' });
    res.status(200).json({ success: true, message: 'Logged out' });
};

exports.register = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only administrators can register new users'
            });
        }

        const { username, email, password, full_name, phone, address, role, emailCode } = req.body;

        if (!username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, and full name are required'
            });
        }

        // The address is what the account is verified against, so it has to be
        // real and reachable — no placeholder fallback any more.
        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'A valid email address is required — a code is sent to it before the account can be created'
            });
        }

        const emailOwner = await User.findAnyByEmail(String(email).trim());
        if (emailOwner) {
            return res.status(400).json({
                success: false,
                conflict: 'email',
                deactivatedId: emailOwner.is_active ? undefined : emailOwner.id,
                message: emailOwner.is_active
                    ? `That email address is already used by ${emailOwner.username}.`
                    : `That email address belongs to a deactivated account (${emailOwner.username}). Tick "Show deactivated" on this page to restore it, or use a different address.`
            });
        }

        const pwError = validatePassword(password);
        if (pwError) {
            return res.status(400).json({ success: false, message: pwError });
        }

        if (role && !['admin', 'manager', 'staff', 'viewer'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role. Must be one of: admin, manager, staff, viewer' });
        }

        // Deleting a user only flips is_active, but the UNIQUE index keeps
        // holding the name — so say which case this is instead of insisting a
        // name is taken by an account the admin cannot see anywhere.
        const existingUser = await User.findAnyByUsername(username);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                conflict: 'username',
                deactivatedId: existingUser.is_active ? undefined : existingUser.id,
                message: existingUser.is_active
                    ? 'Username already taken'
                    : `"${username}" belongs to a deactivated account (${existingUser.full_name || existingUser.email}). Tick "Show deactivated" on this page to restore it, or pick a different username.`
            });
        }

        // Last gate: the code proves someone opened that inbox. Checked after
        // the cheap validations so a fumbled form doesn't burn an attempt.
        const codeError = await consumeEmailCode(String(email).trim(), emailCode);
        if (codeError) {
            return res.status(400).json({ success: false, conflict: 'code', message: codeError });
        }

        const newUser = await User.create({
            username,
            email: String(email).trim(),
            password,
            full_name,
            phone,
            address,
            role: role || 'staff'
        });

        // The code was the proof, so there is nothing left to confirm — the
        // account is verified from birth and can sign in immediately.
        const conn = await pool.getConnection();
        try {
            await conn.execute('UPDATE users SET email_verified = 1 WHERE id = ?', [newUser.id]);
        } finally {
            conn.release();
        }

        logAudit(req.user.id, 'create', 'users', newUser.id, null, newUser, req.ip);

        // Courtesy, not a gate: the account already works, so a failed send
        // must not fail the request.
        sendWelcomeEmail(newUser.email, newUser.full_name, newUser.username, newUser.role)
            .catch(e => console.error('Welcome email failed:', e.message));

        res.status(201).json({
            success: true,
            message: `Account created. ${newUser.email} is verified — they can sign in right away, and a welcome email with their username is on the way.`,
            user: newUser
        });

    } catch (error) {
        // DB unique constraint — e.g. two admins creating the same account at
        // once. Name the column that actually collided; the index name is in
        // the driver's message ("for key 'email'").
        if (error && error.code === 'ER_DUP_ENTRY') {
            const onEmail = /'email'/.test(error.sqlMessage || '');
            return res.status(400).json({
                success: false,
                conflict: onEmail ? 'email' : 'username',
                message: onEmail ? 'That email address is already registered' : 'Username already taken'
            });
        }
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
};

/**
 * Public — the link in the confirmation email lands here.
 * Consumes the token so a forwarded or leaked link can't be reused.
 */
exports.verifyEmail = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ success: false, message: 'This confirmation link is missing its token.' });
        }

        const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
        const conn = await pool.getConnection();
        let rows;
        try {
            [rows] = await conn.execute(
                'SELECT id, username, email, email_verified FROM users WHERE verify_token_hash = ? AND is_active = 1',
                [tokenHash]
            );
        } finally {
            conn.release();
        }

        if (!rows.length) {
            return res.status(400).json({
                success: false,
                message: 'This confirmation link is invalid or has already been used. Ask an administrator to send a new one.'
            });
        }

        const user = rows[0];

        // Expiry is checked after the row is found so an expired link can say so
        // precisely instead of looking indistinguishable from a bad token.
        const conn2 = await pool.getConnection();
        let fresh;
        try {
            [fresh] = await conn2.execute(
                'SELECT id FROM users WHERE id = ? AND verify_token_expires > NOW()',
                [user.id]
            );
            if (!fresh.length) {
                return res.status(400).json({
                    success: false,
                    message: 'This confirmation link has expired. Ask an administrator to send a new one.'
                });
            }
            await conn2.execute(
                'UPDATE users SET email_verified = 1, verify_token_hash = NULL, verify_token_expires = NULL WHERE id = ?',
                [user.id]
            );
        } finally {
            conn2.release();
        }

        logAudit(user.id, 'email_verified', 'users', user.id, null, { email: user.email }, req.ip);
        res.status(200).json({
            success: true,
            message: 'Email confirmed. You can now sign in to FETCH.',
            username: user.username
        });
    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({ success: false, message: 'Server error confirming email' });
    }
};

/**
 * Public — for someone stuck at the sign-in screen with an unconfirmed account.
 * Answers the same way regardless, so it can't be used to probe for accounts.
 */
exports.resendVerification = async (req, res) => {
    const genericResponse = {
        success: true,
        message: 'If that account exists and still needs confirming, a new link has been sent to its email address.'
    };
    try {
        const { username } = req.body;
        if (!username || !String(username).trim()) {
            return res.status(400).json({ success: false, message: 'Username or email is required' });
        }

        const input = String(username).trim();
        let user = await User.findByUsername(input);
        if (!user && isValidEmail(input)) user = await User.findByEmail(input);

        if (!user || !user.is_active || Number(user.email_verified) === 1 || !isValidEmail(user.email)) {
            return res.status(200).json(genericResponse);
        }

        await issueVerificationEmail(user);
        logAudit(user.id, 'verification_resent', 'users', user.id, null, null, req.ip);
        res.status(200).json(genericResponse);
    } catch (error) {
        console.error('Resend verification error:', error.message);
        res.status(200).json(genericResponse);
    }
};

/**
 * Admin-side resend from the Users page, where a real error is more useful
 * than the deliberately vague public answer.
 */
exports.adminResendVerification = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findByIdWithPassword(id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (Number(user.email_verified) === 1) {
            return res.status(400).json({ success: false, message: 'That account is already confirmed.' });
        }
        if (!isValidEmail(user.email)) {
            return res.status(400).json({ success: false, message: 'That account has no valid email address on file. Edit the user and set one first.' });
        }

        await issueVerificationEmail(user);
        logAudit(req.user.id, 'verification_resent', 'users', user.id, null, { email: user.email }, req.ip);
        res.status(200).json({ success: true, message: `A new confirmation link was sent to ${user.email}.` });
    } catch (error) {
        console.error('Admin resend verification error:', error);
        res.status(500).json({ success: false, message: 'Could not send the confirmation email: ' + error.message });
    }
};

exports.verifyToken = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            user: user
        });

    } catch (error) {
        console.error('Verify token error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        // Opt-in, so the normal view stays the list of people who can sign in.
        const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
        const users = await User.getAll(includeInactive);
        res.status(200).json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving users'
        });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving user'
        });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        if (updateData.password) {
            const pwError = validatePassword(updateData.password);
            if (pwError) {
                return res.status(400).json({ success: false, message: pwError });
            }
        }

        const oldUser = await User.findById(id);

        // Changing the address undoes the proof we had, so the new one has to be
        // confirmed too — otherwise an edit is a way around verification.
        const newEmail = updateData.email !== undefined ? String(updateData.email).trim() : null;
        const emailChanged = !!(newEmail && oldUser && newEmail.toLowerCase() !== String(oldUser.email || '').toLowerCase());
        if (newEmail !== null && !isValidEmail(newEmail)) {
            return res.status(400).json({ success: false, message: 'A valid email address is required' });
        }
        if (emailChanged) {
            const emailOwner = await User.findAnyByEmail(newEmail);
            if (emailOwner && emailOwner.id !== parseInt(id)) {
                return res.status(400).json({
                    success: false,
                    message: emailOwner.is_active
                        ? `That email address is already used by ${emailOwner.username}.`
                        : `That email address belongs to a deactivated account (${emailOwner.username}).`
                });
            }
        }

        const user = await User.update(id, updateData);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // updateData is the raw request body: when an admin sets someone's
        // password it arrives here in the clear, and the audit row is kept
        // forever and copied into every nightly backup. Record that a password
        // was changed, never what it was.
        const auditedChanges = { ...updateData };
        if (auditedChanges.password) {
            auditedChanges.password = '[changed]';
            // An admin resetting someone's password ends that person's sessions.
            await bumpTokenVersion(parseInt(id));
        }

        logAudit(req.user.id, 'update', 'users', parseInt(id), oldUser, auditedChanges, req.ip);

        let message = 'User updated successfully';
        if (emailChanged) {
            try {
                await issueVerificationEmail({ id: user.id, email: newEmail, full_name: user.full_name });
                message = `User updated. ${newEmail} must be confirmed before they can sign in again — a link has been sent.`;
            } catch (e) {
                console.error('Verification email failed after email change:', e.message);
                message = `User updated, but the confirmation email to ${newEmail} failed (${e.message}). They cannot sign in until it is resent.`;
            }
        }

        res.status(200).json({
            success: true,
            emailChanged,
            message,
            data: user
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating user'
        });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role) {
            return res.status(400).json({
                success: false,
                message: 'Role is required'
            });
        }

        const validRoles = ['admin', 'manager', 'staff', 'viewer'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be one of: ' + validRoles.join(', ')
            });
        }

        const user = await User.update(id, { role });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // A demotion has to bite now, not whenever their token happens to expire.
        await bumpTokenVersion(parseInt(id));

        res.status(200).json({
            success: true,
            message: 'User role updated successfully',
            data: user
        });
    } catch (error) {
        console.error('Update user role error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating user role'
        });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        await User.delete(id);
        await bumpTokenVersion(parseInt(id));
        logAudit(req.user.id, 'delete', 'users', parseInt(id), null, null, req.ip);
        res.status(200).json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting user'
        });
    }
};

exports.toggleUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const updatedUser = await User.update(id, { is_active: !user.is_active });

        // Deactivation must not wait for the token to lapse. (The middleware
        // refuses inactive accounts outright too; this clears the token as well,
        // so re-activating them later does not revive the old session.)
        await bumpTokenVersion(parseInt(id));

        res.status(200).json({
            success: true,
            message: `User ${updatedUser.is_active ? 'activated' : 'deactivated'} successfully`,
            data: updatedUser
        });
    } catch (error) {
        console.error('Toggle user status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error toggling user status'
        });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { full_name, avatar, email } = req.body;

        if (!full_name || !full_name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Full name is required'
            });
        }

        const fields = { full_name: full_name.trim() };

        // Email is now editable from Profile; validate and keep it unique so a
        // password reset always reaches the right inbox.
        if (email !== undefined) {
            const trimmed = String(email).trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
            }
            const existing = await User.findByEmail(trimmed);
            if (existing && existing.id !== userId) {
                return res.status(400).json({ success: false, message: 'That email is already used by another account' });
            }
            fields.email = trimmed;
        }

        // avatar: a resized data URL (or null to clear); ignore if undefined
        if (avatar !== undefined) fields.avatar = avatar || null;

        let user;
        try {
            user = await User.update(userId, fields);
        } catch (e) {
            if (e && e.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ success: false, message: 'That email is already used by another account' });
            }
            throw e;
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: user
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating profile'
        });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required'
            });
        }

        const pwError = validatePassword(newPassword);
        if (pwError) {
            return res.status(400).json({ success: false, message: pwError });
        }

        const user = await User.findByIdWithPassword(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const isValid = await User.verifyPassword(currentPassword, user.password);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        await User.update(userId, { password: newPassword });

        /* Changing a password retires every session that password opened —
           including any an attacker is sitting in. That would sign this user
           out mid-action, so mint them a replacement token carrying the new
           version and hand it back for the client to store. Every OTHER token
           for this account stops working immediately. */
        await bumpTokenVersion(userId);
        const refreshed = await User.findById(userId);
        const token = refreshed ? generateToken({ ...refreshed, token_version: Number(refreshed.token_version) || 0 }) : null;
        if (token) {
            res.cookie('token', token, {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000,
                path: '/'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Password changed successfully',
            token
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Error changing password'
        });
    }
};
