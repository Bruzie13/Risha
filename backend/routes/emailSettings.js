const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { sendTestEmail, verifyEmailConfig, getEmailConfig, invalidateEmailConfigCache, isValidEmail } = require('../utils/mailer');
const logAudit = require('../services/audit');

// All email settings endpoints are admin-only
router.use(authenticateToken, authorizeRole('admin'));

// Get current email settings (password is never returned, only whether it's set)
router.get('/', async (req, res) => {
    try {
        const config = await getEmailConfig(true);
        res.json({
            success: true,
            data: {
                email_user: config.user || '',
                email_pass_set: !!config.pass,
                email_from_name: config.fromName,
                email_enabled: config.enabled,
                source: config.source
            }
        });
    } catch (e) {
        console.error('Get email settings error:', e.message);
        res.status(500).json({ success: false, message: 'Error loading email settings' });
    }
});

// Save email settings
router.put('/', async (req, res) => {
    try {
        const { email_user, email_pass, email_from_name, email_enabled } = req.body;

        if (!email_user || !isValidEmail(email_user)) {
            return res.status(400).json({ success: false, message: 'A valid sender Gmail address is required' });
        }

        // If no new password provided, keep the existing one
        let passToUse = email_pass;
        if (!passToUse) {
            const current = await getEmailConfig(true);
            passToUse = current.pass;
        }
        if (!passToUse) {
            return res.status(400).json({ success: false, message: 'A Gmail app password is required' });
        }

        // Verify credentials against Gmail before saving
        const check = await verifyEmailConfig(email_user, passToUse);
        if (!check.ok) {
            return res.status(400).json({ success: false, message: 'Gmail rejected these credentials: ' + check.error });
        }

        const settings = {
            email_user: email_user.trim(),
            email_pass: passToUse,
            email_from_name: (email_from_name || 'RISHA Pet Supplies').trim(),
            email_enabled: email_enabled === false ? 'false' : 'true'
        };

        const conn = await pool.getConnection();
        try {
            for (const [key, value] of Object.entries(settings)) {
                await conn.execute(
                    'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
                    [key, value]
                );
            }
        } finally {
            conn.release();
        }

        invalidateEmailConfigCache();
        logAudit(req.user.id, 'update', 'settings', null, null, { email_user: settings.email_user, email_from_name: settings.email_from_name, email_enabled: settings.email_enabled }, req.ip);

        res.json({ success: true, message: 'Email settings saved and verified with Gmail' });
    } catch (e) {
        console.error('Save email settings error:', e.message);
        res.status(500).json({ success: false, message: 'Error saving email settings' });
    }
});

// Send a test email to confirm configuration works end-to-end
router.post('/test', async (req, res) => {
    try {
        const to = (req.body.to || req.user.email || '').trim();
        const result = await sendTestEmail(to);
        res.status(result.success ? 200 : 400).json(result);
    } catch (e) {
        console.error('Test email error:', e.message);
        res.status(500).json({ success: false, message: 'Error sending test email' });
    }
});

module.exports = router;
