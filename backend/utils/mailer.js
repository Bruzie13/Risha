const nodemailer = require('nodemailer');
const crypto = require('crypto');
const pool = require('../config/database');

// Ensure env is loaded
require('dotenv').config({ path: __dirname + '/../.env', override: true });

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cached email config (DB settings override .env)
let cachedConfig = null;

function isValidEmail(email) {
    return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

/**
 * Load email config. DB settings (app_settings) take priority, .env is the fallback.
 */
async function getEmailConfig(forceRefresh = false) {
    if (cachedConfig && !forceRefresh) return cachedConfig;

    const config = {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || '',
        fromName: 'RISHA Pet Supplies',
        enabled: true,
        source: 'env'
    };

    try {
        const conn = await pool.getConnection();
        try {
            const [rows] = await conn.execute(
                "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('email_user', 'email_pass', 'email_from_name', 'email_enabled')"
            );
            for (const row of rows) {
                if (row.setting_key === 'email_user' && row.setting_value) { config.user = row.setting_value; config.source = 'db'; }
                if (row.setting_key === 'email_pass' && row.setting_value) { config.pass = row.setting_value; config.source = 'db'; }
                if (row.setting_key === 'email_from_name' && row.setting_value) config.fromName = row.setting_value;
                if (row.setting_key === 'email_enabled') config.enabled = row.setting_value !== 'false';
            }
        } finally {
            conn.release();
        }
    } catch (e) {
        console.warn('[Email] Could not load settings from DB, using .env fallback:', e.message);
    }

    cachedConfig = config;
    return config;
}

function invalidateEmailConfigCache() {
    cachedConfig = null;
}

function buildTransporter(config) {
    if (!config.user || !config.pass || config.pass === 'your_gmail_app_password_here') return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: config.user, pass: config.pass.replace(/\s+/g, '') }
    });
}

/**
 * Verify credentials actually work by connecting to Gmail SMTP.
 */
async function verifyEmailConfig(user, pass) {
    if (!user || !pass) return { ok: false, error: 'Email and app password are required' };
    if (!isValidEmail(user)) return { ok: false, error: 'Sender email address is not a valid email' };
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: pass.replace(/\s+/g, '') }
    });
    try {
        await transporter.verify();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function logEmail(supplierId, supplierEmail, subject, emailType) {
    try {
        const trackingId = crypto.randomBytes(32).toString('hex');
        const conn = await pool.getConnection();
        try {
            await conn.execute(
                'INSERT INTO email_logs (supplier_id, supplier_email, subject, email_type, tracking_id) VALUES (?, ?, ?, ?, ?)',
                [supplierId, supplierEmail, subject, emailType, trackingId]
            );
        } finally {
            conn.release();
        }
        return trackingId;
    } catch (e) {
        console.error('[Email] Log error:', e.message);
        return null;
    }
}

async function updateEmailStatus(trackingId, status, errorMessage = null) {
    if (!trackingId) return;
    try {
        const conn = await pool.getConnection();
        try {
            await conn.execute(
                'UPDATE email_logs SET status = ?, error_message = ? WHERE tracking_id = ?',
                [status, errorMessage, trackingId]
            );
        } finally {
            conn.release();
        }
    } catch (e) {
        console.error('[Email] Status update error:', e.message);
    }
}

function trackingPixel(trackingId) {
    if (!trackingId) return '';
    return `<img src="${BASE_URL}/track/${trackingId}.gif" width="1" height="1" style="display:none" alt="">`;
}

/**
 * Shared send helper: validates recipient, builds transporter from config,
 * sends, and records delivery status in email_logs.
 */
async function deliver(trackingId, recipientEmail, mailOptions, context) {
    if (!isValidEmail(recipientEmail)) {
        console.error(`[Email] ${context}: invalid recipient email "${recipientEmail}" — email not sent`);
        await updateEmailStatus(trackingId, 'failed', 'Invalid recipient email address');
        return false;
    }

    const config = await getEmailConfig();
    if (!config.enabled) {
        console.warn(`[Email] ${context}: email sending is disabled in settings — skipped`);
        await updateEmailStatus(trackingId, 'skipped', 'Email sending disabled in settings');
        return false;
    }

    const transporter = buildTransporter(config);
    if (!transporter) {
        console.error(`[Email] ${context}: no email credentials configured (set them in Settings → Email or backend/.env) — email not sent`);
        await updateEmailStatus(trackingId, 'failed', 'Email credentials not configured');
        return false;
    }

    mailOptions.from = `"${config.fromName}" <${config.user}>`;

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[Email] ${context}: sent to ${recipientEmail}`);
        await updateEmailStatus(trackingId, 'sent');
        return true;
    } catch (error) {
        console.error(`[Email] ${context}: send failed to ${recipientEmail} — ${error.message}`);
        await updateEmailStatus(trackingId, 'failed', error.message);
        return false;
    }
}

async function sendPOEmail(supplierId, supplierEmail, supplierName, poNumber, items, totalAmount) {
    const trackingId = await logEmail(supplierId, supplierEmail, `PO ${poNumber}`, 'po');

    const itemsHtml = items.map(i =>
        `<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;">${i.product_name || 'Product'}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">₱${Number(i.unit_price || 0).toFixed(2)}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">₱${Number(i.total_price || i.subtotal || 0).toFixed(2)}</td></tr>`
    ).join('');

    const mailOptions = {
        to: supplierEmail,
        subject: `Purchase Order ${poNumber} from RISHA Pet Supplies`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
                <div style="background:#2d6a4f;padding:20px;border-radius:10px 10px 0 0;">
                    <h1 style="color:white;margin:0;font-size:22px;">RISHA Pet Supplies</h1>
                </div>
                <div style="padding:25px;border:1px solid #e0e0e0;border-top:0;">
                    <p style="font-size:16px;color:#333;">Dear <strong>${supplierName}</strong>,</p>
                    <p style="color:#555;">We have generated a new purchase order. Please process at your earliest convenience.</p>
                    <p style="font-size:14px;color:#333;"><strong>PO Number:</strong> ${poNumber}</p>
                    <table style="width:100%;border-collapse:collapse;margin:15px 0;">
                        <thead>
                            <tr style="background:#f5f5f5;">
                                <th style="padding:10px;text-align:left;font-size:13px;color:#2d6a4f;">Item</th>
                                <th style="padding:10px;text-align:center;font-size:13px;color:#2d6a4f;">Qty</th>
                                <th style="padding:10px;text-align:right;font-size:13px;color:#2d6a4f;">Unit Price</th>
                                <th style="padding:10px;text-align:right;font-size:13px;color:#2d6a4f;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                    <div style="text-align:right;padding:15px;font-size:18px;font-weight:700;color:#2d6a4f;border-top:2px solid #2d6a4f;">
                        Total: ₱${Number(totalAmount || 0).toFixed(2)}
                    </div>
                    <p style="color:#888;font-size:12px;margin-top:20px;">This is an auto-generated email. Please contact us if you have any questions.</p>
                </div>
            </div>
            ${trackingPixel(trackingId)}
        `
    };

    return deliver(trackingId, supplierEmail, mailOptions, `PO ${poNumber}`);
}

async function sendLowStockAlert(supplierId, supplierEmail, supplierName, items) {
    const trackingId = await logEmail(supplierId, supplierEmail, `Low Stock Alert - ${items.length} products`, 'low_stock');

    const itemsHtml = items.map(i =>
        `<tr>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;">${i.name}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;">${i.sku || 'N/A'}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${i.stock_quantity}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${i.reorder_level}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;color:${i.stock_quantity === 0 ? '#d32f2f' : '#e65100'};font-weight:700;">${i.stock_quantity === 0 ? 'OUT OF STOCK' : 'LOW'}</td>
        </tr>`
    ).join('');

    const mailOptions = {
        to: supplierEmail,
        subject: `⚠️ LOW STOCK ALERT - ${items.length} product(s) need restocking`,
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
                <div style="background:#d32f2f;padding:20px;border-radius:10px 10px 0 0;">
                    <h1 style="color:white;margin:0;font-size:22px;">⚠️ Low Stock Alert</h1>
                </div>
                <div style="padding:25px;border:1px solid #e0e0e0;border-top:0;">
                    <p style="font-size:16px;color:#333;">Dear <strong>${supplierName}</strong>,</p>
                    <p style="color:#555;">The following products from your supply are running low and need restocking:</p>
                    <table style="width:100%;border-collapse:collapse;margin:15px 0;">
                        <thead>
                            <tr style="background:#fff3e0;">
                                <th style="padding:10px;text-align:left;font-size:13px;color:#e65100;">Product</th>
                                <th style="padding:10px;text-align:left;font-size:13px;color:#e65100;">SKU</th>
                                <th style="padding:10px;text-align:center;font-size:13px;color:#e65100;">Current Stock</th>
                                <th style="padding:10px;text-align:center;font-size:13px;color:#e65100;">Reorder Level</th>
                                <th style="padding:10px;text-align:center;font-size:13px;color:#e65100;">Status</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                    <p style="color:#888;font-size:12px;margin-top:20px;">This is an automated alert from RISHA Pet Supplies. Please arrange restock at your earliest convenience.</p>
                </div>
            </div>
            ${trackingPixel(trackingId)}
        `
    };

    return deliver(trackingId, supplierEmail, mailOptions, 'Low stock alert');
}

/**
 * Send a test email so admins can verify their configuration from Settings.
 */
async function sendTestEmail(toEmail) {
    if (!isValidEmail(toEmail)) {
        return { success: false, message: 'Recipient is not a valid email address' };
    }

    const config = await getEmailConfig(true);
    const transporter = buildTransporter(config);
    if (!transporter) {
        return { success: false, message: 'Email credentials are not configured yet' };
    }

    const mailOptions = {
        from: `"${config.fromName}" <${config.user}>`,
        to: toEmail,
        subject: '✅ RISHA Test Email — Configuration Works',
        html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
                <div style="background:#2d6a4f;padding:20px;border-radius:10px 10px 0 0;">
                    <h1 style="color:white;margin:0;font-size:22px;">RISHA Pet Supplies</h1>
                </div>
                <div style="padding:25px;border:1px solid #e0e0e0;border-top:0;">
                    <p style="font-size:16px;color:#333;">This is a test email from your RISHA inventory system.</p>
                    <p style="color:#555;">If you received this, your Gmail sender configuration is working correctly. Purchase orders and low-stock alerts will be delivered from <strong>${config.user}</strong>.</p>
                    <p style="color:#888;font-size:12px;margin-top:20px;">Sent at ${new Date().toLocaleString()}</p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return { success: true, message: `Test email sent to ${toEmail}` };
    } catch (error) {
        console.error('[Email] Test email failed:', error.message);
        return { success: false, message: `Send failed: ${error.message}` };
    }
}

module.exports = {
    sendPOEmail,
    sendLowStockAlert,
    sendTestEmail,
    verifyEmailConfig,
    getEmailConfig,
    invalidateEmailConfigCache,
    isValidEmail
};
