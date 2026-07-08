const nodemailer = require('nodemailer');
const crypto = require('crypto');
const pool = require('../config/database');

// Ensure env is loaded
require('dotenv').config({ path: __dirname + '/../.env', override: true });

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

function getTransporter() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    if (!user || !pass || pass === 'your_gmail_app_password_here') return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass }
    });
}

async function logEmail(supplierId, supplierEmail, subject, emailType) {
    try {
        const trackingId = crypto.randomBytes(32).toString('hex');
        const conn = await pool.getConnection();
        await conn.execute(
            'INSERT INTO email_logs (supplier_id, supplier_email, subject, email_type, tracking_id) VALUES (?, ?, ?, ?, ?)',
            [supplierId, supplierEmail, subject, emailType, trackingId]
        );
        conn.release();
        return trackingId;
    } catch (e) {
        console.error('[Email] Log error:', e.message);
        return null;
    }
}

function trackingPixel(trackingId) {
    if (!trackingId) return '';
    return `<img src="${BASE_URL}/track/${trackingId}.gif" width="1" height="1" style="display:none" alt="">`;
}

async function sendPOEmail(supplierId, supplierEmail, supplierName, poNumber, items, totalAmount) {
    const transporter = getTransporter();
    const trackingId = await logEmail(supplierId, supplierEmail, `PO ${poNumber}`, 'po');
    if (!transporter) return false;

    const itemsHtml = items.map(i =>
        `<tr><td>${i.product_name || 'Product'}</td><td>${i.quantity}</td><td>₱${Number(i.unit_price || 0).toFixed(2)}</td><td>₱${Number(i.total_price || i.subtotal || 0).toFixed(2)}</td></tr>`
    ).join('');

    const mailOptions = {
        from: `"RISHA Pet Supplies" <${process.env.EMAIL_USER}>`,
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
                        Total: ₱${totalAmount.toFixed(2)}
                    </div>
                    <p style="color:#888;font-size:12px;margin-top:20px;">This is an auto-generated email. Please contact us if you have any questions.</p>
                </div>
            </div>
            ${trackingPixel(trackingId)}
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Email send error:', error.message);
        return false;
    }
}

async function sendLowStockAlert(supplierId, supplierEmail, supplierName, items) {
    const transporter = getTransporter();
    const trackingId = await logEmail(supplierId, supplierEmail, `Low Stock Alert - ${items.length} products`, 'low_stock');
    if (!transporter) return false;

    const itemsHtml = items.map(i =>
        `<tr>
            <td>${i.name}</td>
            <td>${i.sku || 'N/A'}</td>
            <td>${i.stock_quantity}</td>
            <td>${i.reorder_level}</td>
            <td style="color:${i.stock_quantity === 0 ? '#d32f2f' : '#e65100'};font-weight:700;">${i.stock_quantity === 0 ? 'OUT OF STOCK' : 'LOW'}</td>
        </tr>`
    ).join('');

    const mailOptions = {
        from: `"RISHA Pet Supplies" <${process.env.EMAIL_USER}>`,
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

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Low-stock email error:', error.message);
        return false;
    }
}

module.exports = { sendPOEmail, sendLowStockAlert };
