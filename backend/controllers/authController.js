const User = require('../models/User');
const jwt = require('jsonwebtoken');
const logAudit = require('../services/audit');
const { notifyUserLogin } = require('../services/notifier');
const { validatePassword } = require('../utils/passwordPolicy');

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

const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

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

        loginAttempts.delete(key);

        const token = generateToken(user);

        logAudit(user.id, 'login', 'users', user.id, null, null, req.ip);

        notifyUserLogin(user, req.ip).catch(e => console.error('Notif error:', e.message));

        // HttpOnly cookie for the server-side page guard (not readable by JS)
        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });

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

        const { username, email, password, full_name, phone, address, role } = req.body;

        if (!username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, and full name are required'
            });
        }

        const pwError = validatePassword(password);
        if (pwError) {
            return res.status(400).json({ success: false, message: pwError });
        }

        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username already taken'
            });
        }

        const newUser = await User.create({
            username,
            email: email || username + '@risha.local',
            password,
            full_name,
            phone,
            address,
            role: role || 'staff'
        });

        logAudit(req.user.id, 'create', 'users', newUser.id, null, newUser, req.ip);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: newUser
        });

    } catch (error) {
        // DB unique constraint — e.g. two admins creating the same username at once
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Username already taken' });
        }
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
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
        const users = await User.getAll();
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
        const user = await User.update(id, updateData);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        logAudit(req.user.id, 'update', 'users', parseInt(id), oldUser, updateData, req.ip);

        res.status(200).json({
            success: true,
            message: 'User updated successfully',
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

        const validRoles = ['admin', 'manager', 'staff'];
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
        const { full_name, avatar } = req.body;

        if (!full_name || !full_name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Full name is required'
            });
        }

        const fields = { full_name: full_name.trim() };
        // avatar: a resized data URL (or null to clear); ignore if undefined
        if (avatar !== undefined) fields.avatar = avatar || null;
        const user = await User.update(userId, fields);

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

        res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Error changing password'
        });
    }
};
