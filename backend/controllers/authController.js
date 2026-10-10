const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const logAudit = require('../services/audit');
const { notifyUserLogin, notifyPasswordResetRequested, notifyAdminResetLinkSent, notifyPasswordChangedByLink } = require('../services/notifier');
const { validatePassword } = require('../utils/passwordPolicy');
const { adminRemovalProblem } = require('../utils/accounts');
const { ROLES } = require('../utils/roles');
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

/* How long a sign-in lasts. Without "Keep me signed in" the tab forgets the
   token when the browser closes, and the token itself dies after a day. With
   it, the browser keeps the session for a week. */
const SESSION_HOURS = 24;
const REMEMBER_DAYS = 7;

const generateToken = (user, remember = false) => {
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
        { expiresIn: remember ? `${REMEMBER_DAYS}d` : `${SESSION_HOURS}h` }
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

        const token = generateToken(user, !!remember);

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
        if (remember) cookieOpts.maxAge = REMEMBER_DAYS * 24 * 60 * 60 * 1000;
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
// A link sent after an administrator's approval lasts longer: the person who
// asked may not be looking at their inbox at the moment it is approved.
const APPROVED_RESET_TTL_MS = 60 * 60 * 1000;
// A request nobody acts on stops being offered for approval after a day.
const RESET_REQUEST_LIFE_HOURS = 24;

async function issueResetLink(user, ttlMs) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + ttlMs);
    await pool.query(
        'UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?',
        [tokenHash, expires, user.id]
    );
    await sendPasswordResetEmail(user.email, user.full_name, token, Math.round(ttlMs / 60000));
}

/* Forgotten password.

   Nobody gets a reset link just by typing a username any more. The request
   goes to the administrators first; the link is only emailed once one of
   them approves it on the Users page. The link still goes to the address on
   the account, so approval is a second lock, not a replacement for the first.

   The one exception is an administrator's own account: with a single admin
   there would be nobody left to approve it, and the shop would be locked out
   of its own system. An administrator is emailed the link directly (it works
   for 30 minutes), and every administrator gets a notification that it was
   sent and another when the password is actually changed. If the
   administrator has also lost the mailbox, scripts/reset-admin-password.js
   resets it from the server.

   Always answers with the same generic message so the endpoint can't be used
   to probe which usernames/emails exist. */
exports.forgotPassword = async (req, res) => {
    const genericResponse = {
        success: true,
        message: 'If that account exists: an administrator account is emailed a reset link straight away. Any other account waits for an administrator to approve it, and is then emailed the link.'
    };
    try {
        const { username } = req.body;
        if (!username || !String(username).trim()) {
            return res.status(400).json({ success: false, message: 'Username or email is required' });
        }

        const input = String(username).trim().slice(0, 150);
        let user = await User.findByUsername(input);
        if (!user && isValidEmail(input)) user = await User.findByEmail(input);

        if (!user || !user.is_active || !isValidEmail(user.email)) {
            return res.status(200).json(genericResponse);
        }

        if (user.role === 'admin') {
            await issueResetLink(user, RESET_TOKEN_TTL_MS);
            // Nobody approves an administrator's reset, so the other
            // administrators are at least told it happened.
            await notifyAdminResetLinkSent(user).catch(() => {});
            logAudit(user.id, 'password_reset_requested', 'users', user.id, null, null, req.ip);
            return res.status(200).json(genericResponse);
        }

        // One open request per account: asking again does not stack them up
        // or send the administrators a second notification.
        const [open] = await pool.query(
            `SELECT id FROM password_reset_requests
              WHERE user_id = ? AND status = 'pending'
                AND requested_at > NOW() - INTERVAL ${RESET_REQUEST_LIFE_HOURS} HOUR
              LIMIT 1`,
            [user.id]
        );
        if (!open.length) {
            const [ins] = await pool.query(
                'INSERT INTO password_reset_requests (user_id, requested_ip) VALUES (?, ?)',
                [user.id, String(req.ip || '').slice(0, 64)]
            );
            await notifyPasswordResetRequested(user, ins.insertId);
            logAudit(user.id, 'password_reset_requested', 'users', user.id, null, null, req.ip);
        }

        res.status(200).json(genericResponse);
    } catch (error) {
        console.error('Forgot password error:', error.message);
        // Same generic answer on failure — details go to the server log only
        res.status(200).json(genericResponse);
    }
};

// Administrators: the requests waiting for a decision.
exports.listResetRequests = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT r.id, r.requested_at, TIMESTAMPDIFF(MINUTE, r.requested_at, NOW()) AS minutes_ago,
                    u.id AS user_id, u.username, u.full_name, u.email, u.role
               FROM password_reset_requests r
               JOIN users u ON u.id = r.user_id
              WHERE r.status = 'pending'
                AND r.requested_at > NOW() - INTERVAL ${RESET_REQUEST_LIFE_HOURS} HOUR
              ORDER BY r.requested_at ASC`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('List reset requests error:', error.message);
        res.status(500).json({ success: false, message: 'Could not load password reset requests' });
    }
};

// Administrators: approve (emails the link) or decline one request.
exports.decideResetRequest = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const approve = req.params.decision === 'approve';
        if (!Number.isInteger(id) || id <= 0 || !['approve', 'decline'].includes(req.params.decision)) {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        }

        const [rows] = await pool.query(
            `SELECT r.id, r.status, u.id AS user_id, u.username, u.full_name, u.email, u.is_active, u.role
               FROM password_reset_requests r
               JOIN users u ON u.id = r.user_id
              WHERE r.id = ?
                AND r.requested_at > NOW() - INTERVAL ${RESET_REQUEST_LIFE_HOURS} HOUR`,
            [id]
        );
        const request = rows[0];
        if (!request || request.status !== 'pending') {
            return res.status(404).json({ success: false, message: 'This request has already been dealt with or has expired.' });
        }

        if (!approve) {
            await pool.query(
                `UPDATE password_reset_requests SET status = 'declined', decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'`,
                [req.user.id, id]
            );
            logAudit(req.user.id, 'password_reset_declined', 'users', request.user_id, null, null, req.ip);
            return res.json({ success: true, message: `Declined. ${request.full_name || request.username}'s password stays as it is.` });
        }

        if (!request.is_active || !isValidEmail(request.email)) {
            return res.status(400).json({ success: false, message: 'This account is deactivated or has no valid email address, so a link cannot be sent.' });
        }

        // Claim the request first, so two administrators clicking at once
        // cannot both send a link.
        const [claim] = await pool.query(
            `UPDATE password_reset_requests SET status = 'approved', decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'pending'`,
            [req.user.id, id]
        );
        if (!claim.affectedRows) {
            return res.status(404).json({ success: false, message: 'This request has already been dealt with.' });
        }

        try {
            await issueResetLink({ id: request.user_id, email: request.email, full_name: request.full_name }, APPROVED_RESET_TTL_MS);
        } catch (mailError) {
            // The link never left: put the request back so it can be approved again.
            console.error('Reset approval email error:', mailError.message);
            await pool.query(
                `UPDATE password_reset_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?`, [id]
            );
            await pool.query('UPDATE users SET reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?', [request.user_id]);
            return res.status(502).json({ success: false, message: 'The reset email could not be sent. Check the email settings and try again.' });
        }

        logAudit(req.user.id, 'password_reset_approved', 'users', request.user_id, null, null, req.ip);
        res.json({ success: true, message: `Approved. A reset link was emailed to ${request.full_name || request.username}; it works for 1 hour.` });
    } catch (error) {
        console.error('Decide reset request error:', error.message);
        res.status(500).json({ success: false, message: 'Could not update the request' });
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
        notifyPasswordChangedByLink(userId).catch(() => {});
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

/* A supplier login must point at one real, active supplier; every other role
   must point at none. Returns { supplier_id } to store, or { error }. */
async function resolveSupplierLink(role, supplierId) {
    if (role !== 'supplier') return { supplier_id: null };
    const id = Number(supplierId);
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Choose which supplier this account belongs to.' };
    }
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.execute('SELECT id FROM suppliers WHERE id = ? AND is_active = TRUE', [id]);
        if (!rows.length) return { error: 'That supplier does not exist or is no longer active.' };
    } finally {
        conn.release();
    }
    return { supplier_id: id };
}

exports.register = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only administrators can register new users'
            });
        }

        const { username, email, password, full_name, phone, address, role, emailCode, supplier_id } = req.body;

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

        if (role && !ROLES.includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role. Must be one of: ' + ROLES.join(', ') });
        }
        const link = await resolveSupplierLink(role || 'cashier', supplier_id);
        if (link.error) {
            return res.status(400).json({ success: false, message: link.error });
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
            role: role || 'cashier',
            supplier_id: link.supplier_id
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

        /* Pages are admitted by a cookie, API calls by the token the tab holds.
           The two can drift apart: signing out in one tab clears the shared
           cookie while another tab still holds a perfectly good token. That
           tab then bounced for ever between the sign-in page (token fine, go
           to your home page) and the page guard (no cookie, go and sign in).

           The token has just been verified against the database, so hand the
           page guard the same proof. It is a session cookie: it lasts no
           longer than the browser, whatever "keep me signed in" was. */
        const presented = (req.headers['authorization'] || '').split(' ')[1];
        if (presented && req.cookies?.token !== presented) {
            res.cookie('token', presented, {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/'
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

        // Role and supplier link are decided together: a supplier account
        // always carries a supplier, and no other role ever does.
        let roleChanged = false;
        if (oldUser && (updateData.role !== undefined || updateData.supplier_id !== undefined)) {
            const finalRole = updateData.role !== undefined ? updateData.role : oldUser.role;
            if (!ROLES.includes(finalRole)) {
                return res.status(400).json({ success: false, message: 'Invalid role. Must be one of: ' + ROLES.join(', ') });
            }
            const wantedSupplier = updateData.supplier_id !== undefined
                ? updateData.supplier_id
                : await User.getSupplierId(id);
            const link = await resolveSupplierLink(finalRole, wantedSupplier);
            if (link.error) {
                return res.status(400).json({ success: false, message: link.error });
            }
            updateData.supplier_id = link.supplier_id;
            roleChanged = finalRole !== oldUser.role;
            if (roleChanged && oldUser.role === 'admin') {
                const blocked = adminRemovalProblem(req.user.id, oldUser, await User.countActiveAdmins(), 'demote');
                if (blocked) {
                    return res.status(400).json({ success: false, message: blocked });
                }
            }
        }

        const user = await User.update(id, updateData);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // A change of role has to bite now, not whenever their token expires.
        if (roleChanged) await bumpTokenVersion(parseInt(id));

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

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const target = await User.findById(id);
        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const blocked = adminRemovalProblem(req.user.id, target, await User.countActiveAdmins(), 'delete');
        if (blocked) {
            return res.status(400).json({ success: false, message: blocked });
        }
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

        if (user.is_active) {
            const blocked = adminRemovalProblem(req.user.id, user, await User.countActiveAdmins(), 'deactivate');
            if (blocked) {
                return res.status(400).json({ success: false, message: blocked });
            }
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
