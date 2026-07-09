const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: __dirname + '/.env', override: true });

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const saleRoutes = require('./routes/sales');
const supplierRoutes = require('./routes/suppliers');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const auditRoutes = require('./routes/audit');

const scheduler = require('./utils/scheduler');

const app = express();

// Railway (and most PaaS) sit behind a reverse proxy — trust the first hop
// so req.ip reflects the real client IP (needed for the tracking rate limiter)
// and secure cookies work correctly behind HTTPS termination.
app.set('trust proxy', 1);

// CORS: frontend is served from this same server, so cross-origin access is only
// allowed for explicitly whitelisted origins (comma-separated CORS_ORIGIN) or localhost in dev.
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/];
app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

function authPageGuard(req, res, next) {
    const publicPages = ['/login.html', '/', ''];
    if (publicPages.includes(req.path)) return next();
    if (!req.path.endsWith('.html')) return next();

    // Only accept the auth cookie — never tokens in the URL (they leak into logs/history)
    const token = req.cookies?.token;
    if (token) {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            return next();
        } catch (e) {}
    }
    res.redirect('/login.html');
}

app.use(authPageGuard);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit-logs', auditRoutes);

const predictionRoutes = require('./routes/predictions');
app.use('/api/predictions', predictionRoutes);

const emailSettingsRoutes = require('./routes/emailSettings');
app.use('/api/email-settings', emailSettingsRoutes);

// Email tracking
const pool = require('./config/database');
const crypto = require('crypto');

async function ensureEmailLogsTable() {
    try {
        const conn = await pool.getConnection();
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS email_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                supplier_id INT,
                supplier_email VARCHAR(255),
                subject VARCHAR(500),
                email_type VARCHAR(50),
                tracking_id VARCHAR(64) UNIQUE,
                opened_at DATETIME NULL,
                opened_count INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Migrate older installs: add delivery status columns if missing
        try { await conn.execute("ALTER TABLE email_logs ADD COLUMN status VARCHAR(20) DEFAULT 'pending'"); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE email_logs ADD COLUMN error_message VARCHAR(500) NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE email_logs ADD COLUMN clicked_at DATETIME NULL'); } catch (e) { /* column exists */ }
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        conn.release();
        console.log('[Email] email_logs and app_settings tables ready');
    } catch (e) {
        console.error('[Email] Table init error:', e.message);
    }
}

async function ensureIndexes() {
    try {
        const conn = await pool.getConnection();
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock_quantity)',
            'CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id)',
            'CREATE INDEX IF NOT EXISTS idx_products_expiration ON products(expiration_date)',
            'CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id)',
            'CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)',
            'CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)',
            'CREATE INDEX IF NOT EXISTS idx_purchase_orders_date ON purchase_orders(order_date)',
            'CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id)',
            'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
        ];
        for (const sql of indexes) {
            try { await conn.execute(sql); } catch (e) { /* index may already exist */ }
        }
        conn.release();
        console.log('[DB] Indexes verified');
    } catch (e) {
        console.error('[DB] Index migration error:', e.message);
    }
}

// Tracking pixel — 1x1 transparent GIF
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Simple per-IP rate limit for the public tracking endpoint (max 60 hits/minute)
const trackHits = new Map();
function rateLimitTracking(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const rec = trackHits.get(ip);
    if (!rec || now - rec.windowStart > 60000) {
        trackHits.set(ip, { count: 1, windowStart: now });
        return next();
    }
    if (rec.count >= 60) {
        res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
        return res.send(TRACKING_PIXEL); // still serve pixel, just skip the DB write
    }
    rec.count++;
    next();
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of trackHits) {
        if (now - rec.windowStart > 60000) trackHits.delete(ip);
    }
}, 5 * 60000).unref();

app.get('/track/:trackingId.gif', rateLimitTracking, async (req, res) => {
    const { trackingId } = req.params;
    try {
        const conn = await pool.getConnection();
        await conn.execute(
            'UPDATE email_logs SET opened_at = COALESCE(opened_at, NOW()), opened_count = opened_count + 1 WHERE tracking_id = ?',
            [trackingId]
        );
        conn.release();
    } catch (e) {}
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
    res.send(TRACKING_PIXEL);
});

// Click tracking — the "View / Confirm" button inside supplier emails points here.
// Clicking marks the email as read (even when the mail client blocks images)
// and shows the supplier a small branded confirmation page.
app.get('/track/click/:trackingId', rateLimitTracking, async (req, res) => {
    const { trackingId } = req.params;
    let known = false;
    try {
        const conn = await pool.getConnection();
        const [result] = await conn.execute(
            `UPDATE email_logs
             SET opened_at = COALESCE(opened_at, NOW()),
                 clicked_at = COALESCE(clicked_at, NOW()),
                 opened_count = opened_count + 1
             WHERE tracking_id = ?`,
            [trackingId]
        );
        known = result.affectedRows > 0;
        conn.release();
    } catch (e) {}
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RISHA Pet Supplies — Confirmed</title>
<style>
    body { margin:0; font-family:-apple-system,'Segoe UI',Arial,sans-serif; background:#F4F6FB; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#fff; border:1px solid #E9EDF4; border-radius:20px; box-shadow:0 16px 48px rgba(16,24,40,.10); padding:40px 44px; max-width:420px; text-align:center; margin:20px; }
    .tick { width:64px; height:64px; border-radius:50%; background:rgba(47,163,107,.12); color:#2FA36B; display:flex; align-items:center; justify-content:center; font-size:32px; margin:0 auto 18px; }
    h1 { font-size:20px; color:#1B2437; margin:0 0 8px; }
    p { font-size:14px; color:#5A6478; line-height:1.6; margin:0; }
    .brand { margin-top:22px; font-size:12px; color:#8A94A8; font-weight:600; letter-spacing:.4px; }
    .brand b { color:#E14C42; }
</style>
</head>
<body>
    <div class="card">
        <div class="tick">✓</div>
        <h1>${known ? 'Thank you — received!' : 'Link acknowledged'}</h1>
        <p>${known
            ? 'Your confirmation has been recorded and RISHA Pet Supplies has been notified that you viewed this email. No further action is needed.'
            : 'This confirmation link is no longer active, but you can reply to the original email if you have questions.'}</p>
        <div class="brand"><b>RISHA</b> PET SUPPLIES</div>
    </div>
</body>
</html>`);
});

// Get email logs for a supplier
const { authenticateToken } = require('./middleware/auth');
app.get('/api/email-logs/:supplierId', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            'SELECT * FROM email_logs WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.params.supplierId]
        );
        conn.release();
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

// Get all email logs
app.get('/api/email-logs', authenticateToken, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT el.*, s.name as supplier_name 
             FROM email_logs el 
             LEFT JOIN suppliers s ON el.supplier_id = s.id 
             ORDER BY el.created_at DESC LIMIT 100`
        );
        conn.release();
        res.json({ success: true, data: rows });
    } catch (e) {
        res.json({ success: true, data: [] });
    }
});

ensureEmailLogsTable();
ensureIndexes();

app.get('/api/health', (req, res) => {
    res.status(200).json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

// Trigger alert checks on demand (called by frontend when visiting notifications page)
app.post('/api/notifications/check-alerts', authenticateToken, async (req, res) => {
    try {
        await scheduler.checkLowStock();
        await scheduler.checkExpiringProducts();
        await scheduler.checkOverstock();
        res.json({ success: true, message: 'Alert checks completed' });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.use(express.static(path.join(__dirname, '..', 'src'), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res, filePath) => {
        if (filePath.match(/\.(js|css|html)$/)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
    }
}));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'src', 'login.html'));
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    scheduler.start();
});
