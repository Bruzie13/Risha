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
// Security headers on every response
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');   // no MIME sniffing
    res.setHeader('X-Frame-Options', 'DENY');             // no clickjacking via iframes
    res.setHeader('Referrer-Policy', 'same-origin');
    // geolocation must stay enabled for our own origin: the driver's delivery
    // tracking page calls navigator.geolocation. A bare geolocation=() blocks
    // it for us too, and the browser rejects it before the driver is even asked.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (process.env.NODE_ENV === 'production') {
        // force HTTPS for 180 days once a browser has seen the site over HTTPS
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

function authPageGuard(req, res, next) {
    // track-delivery.html is opened by a supplier's driver, who has no account;
    // its unguessable, expiring token is the credential.
    const publicPages = ['/login.html', '/reset-password.html', '/verify-email.html', '/track-delivery.html', '/', ''];
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

const assistantRoutes = require('./routes/assistant');
app.use('/api/assistant', assistantRoutes);

// Email tracking
const pool = require('./config/database');
const crypto = require('crypto');

const { zipSingleFile } = require('./utils/zip');

// Full-database dump as a ZIP holding one JSON file. Used by the admin
// download button and the daily scheduled backup email. Restore with
// scripts/restore-backup.js.
//
// ZIP rather than gzip for two reasons: Brevo refuses .gz attachments outright
// ("Unsupported file format: gz"), which meant the daily backup email failed
// every night; and .zip opens with a double-click on the Windows machines the
// shop uses, where .gz needs extra software.
async function buildBackup() {
    const conn = await pool.getConnection();
    try {
        const [tables] = await conn.query('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        const dump = { created_at: new Date().toISOString(), database: 'risha', tables: {} };
        for (const t of tableNames) {
            const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
            dump.tables[t] = rows;
        }
        const json = Buffer.from(JSON.stringify(dump));
        const day = new Date().toISOString().slice(0, 10);
        return {
            zip: zipSingleFile(`risha-backup-${day}.json`, json),
            filename: `risha-backup-${day}.zip`,
            tables: tableNames.length,
            rows: Object.values(dump.tables).reduce((a, r) => a + r.length, 0),
        };
    } finally {
        conn.release();
    }
}

const backupAuth = require('./middleware/auth');
app.get('/api/backup', backupAuth.authenticateToken, backupAuth.authorizeRole('admin'), async (req, res) => {
    try {
        const b = await buildBackup();
        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${b.filename}"`
        });
        res.send(b.zip);
    } catch (e) {
        console.error('Backup error:', e.message);
        res.status(500).json({ success: false, message: 'Backup failed' });
    }
});

async function ensureOpsTables() {
    try {
        const conn = await pool.getConnection();
        // sales.payment_status gains 'voided' (safe to re-run)
        await conn.execute(
            "ALTER TABLE sales MODIFY payment_status ENUM('pending','completed','failed','voided') DEFAULT 'completed'");
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS cash_reconciliations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                business_date DATE NOT NULL UNIQUE,
                expected_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
                counted_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
                discrepancy DECIMAL(12,2) NOT NULL DEFAULT 0,
                notes VARCHAR(500) NULL,
                counted_by INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);
        conn.release();
        console.log('[DB] ops tables ready (voided status, cash_reconciliations)');
    } catch (e) {
        console.error('[DB] ops table migration error:', e.message);
    }
}

async function ensurePasswordResetColumns() {
    try {
        const conn = await pool.getConnection();
        try { await conn.execute('ALTER TABLE users ADD COLUMN reset_token_hash VARCHAR(64) NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL'); } catch (e) { /* column exists */ }
        conn.release();
        console.log('[DB] password reset columns ready');
    } catch (e) {
        console.error('[DB] password reset migration error:', e.message);
    }
}

async function ensureEmailVerificationColumns() {
    try {
        const conn = await pool.getConnection();
        try {
            await conn.execute('ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0');
            // The ALTER only succeeds on the first run. Everyone already using
            // the system is grandfathered in here — otherwise this migration
            // would lock out every existing account, the only admin included.
            await conn.execute('UPDATE users SET email_verified = 1');
            console.log('[DB] existing accounts grandfathered as verified');
        } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE users ADD COLUMN verify_token_hash VARCHAR(64) NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE users ADD COLUMN verify_token_expires DATETIME NULL'); } catch (e) { /* column exists */ }
        conn.release();
        console.log('[DB] email verification columns ready');
    } catch (e) {
        console.error('[DB] email verification migration error:', e.message);
    }
}

async function ensureEmailCodesTable() {
    try {
        const conn = await pool.getConnection();
        // One pending code per address — requesting a new one replaces the old.
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS email_verification_codes (
                email VARCHAR(255) NOT NULL PRIMARY KEY,
                code_hash VARCHAR(64) NOT NULL,
                expires_at DATETIME NOT NULL,
                attempts INT NOT NULL DEFAULT 0,
                requested_by INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        conn.release();
        console.log('[DB] email verification codes table ready');
    } catch (e) {
        console.error('[DB] email codes migration error:', e.message);
    }
}

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
        // Supplier map pins (added 2026-07). Older installs get the columns here.
        try { await conn.execute('ALTER TABLE suppliers ADD COLUMN latitude DECIMAL(10, 7) NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE suppliers ADD COLUMN longitude DECIMAL(10, 7) NULL'); } catch (e) { /* column exists */ }

        // Delivery tracking. Stage timestamps answer "how long has this order
        // been sitting at this step?" — updated_at alone can't, since any edit
        // moves it.
        try { await conn.execute('ALTER TABLE purchase_orders ADD COLUMN confirmed_at DATETIME NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE purchase_orders ADD COLUMN shipped_at DATETIME NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE purchase_orders ADD COLUMN received_at DATETIME NULL'); } catch (e) { /* column exists */ }
        // Best-effort backfill for orders received before this feature existed:
        // updated_at is when the row last changed, which for a received order is
        // almost always the moment it was marked received. Approximate, and only
        // ever applied where we have nothing better.
        try {
            await conn.execute(
                "UPDATE purchase_orders SET received_at = updated_at WHERE status = 'received' AND received_at IS NULL"
            );
        } catch (e) { /* nothing to backfill */ }

        // A live-location link the supplier's driver may choose to open. One
        // row per issued link; positions land in delivery_positions.
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS delivery_tracking (
                id INT PRIMARY KEY AUTO_INCREMENT,
                po_id INT NOT NULL,
                token VARCHAR(64) UNIQUE NOT NULL,
                created_by INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                revoked TINYINT(1) DEFAULT 0,
                first_shared_at DATETIME NULL,
                last_seen_at DATETIME NULL,
                INDEX idx_dt_po (po_id),
                INDEX idx_dt_token (token)
            )
        `);
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS delivery_positions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                tracking_id INT NOT NULL,
                latitude DECIMAL(10, 7) NOT NULL,
                longitude DECIMAL(10, 7) NOT NULL,
                accuracy_m INT NULL,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_dp_tracking (tracking_id, recorded_at)
            )
        `);
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

/* Rate limit for the delivery-tracking routes. A driver sharing their position
   posts roughly every 15s, so the ceiling is higher than the pixel's — but it
   still caps how much a leaked token could write. Replies in JSON, unlike the
   pixel limiter above. */
const posHits = new Map();
function rateLimitPositions(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const rec = posHits.get(ip);
    if (!rec || now - rec.windowStart > 60000) {
        posHits.set(ip, { count: 1, windowStart: now });
        return next();
    }
    if (rec.count >= 120) {
        return res.status(429).json({ success: false, message: 'Too many updates — slow down.' });
    }
    rec.count++;
    next();
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of posHits) {
        if (now - rec.windowStart > 60000) posHits.delete(ip);
    }
}, 5 * 60000).unref();

app.get('/track/:trackingId.gif', rateLimitTracking, async (req, res) => {
    const { trackingId } = req.params;
    try {
        const conn = await pool.getConnection();
        // Mail scanners (Gmail especially) prefetch images seconds after
        // delivery — an "open" in the first minute is a robot, not a reader.
        await conn.execute(
            `UPDATE email_logs
             SET opened_at = IF(created_at < NOW() - INTERVAL 60 SECOND, COALESCE(opened_at, NOW()), opened_at),
                 opened_count = opened_count + 1
             WHERE tracking_id = ?`,
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
// The confirm page marks the email via a JS POST below — link-scanning bots
// follow GETs but don't execute JavaScript, so a bare GET no longer counts.
app.post('/track/confirm/:trackingId', rateLimitTracking, async (req, res) => {
    try {
        const conn = await pool.getConnection();
        await conn.execute(
            `UPDATE email_logs
             SET opened_at = COALESCE(opened_at, NOW()),
                 clicked_at = COALESCE(clicked_at, NOW()),
                 opened_count = opened_count + 1
             WHERE tracking_id = ?`,
            [req.params.trackingId]
        );
        conn.release();
    } catch (e) {}
    res.json({ ok: true });
});

app.get('/track/click/:trackingId', rateLimitTracking, async (req, res) => {
    const { trackingId } = req.params;
    let known = false;
    try {
        const conn = await pool.getConnection();
        const [rows] = await conn.execute(
            'SELECT id FROM email_logs WHERE tracking_id = ? LIMIT 1',
            [trackingId]
        );
        known = rows.length > 0;
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
    <script>
        // recorded only when a real browser runs this (bots don't)
        fetch('/track/confirm/${trackingId}', { method: 'POST' }).catch(function () {});
    </script>
</body>
</html>`);
});

/* ── Public delivery-tracking endpoints ───────────────────────────────────
   These are the only routes a supplier's driver touches. They are reachable
   without a login because the driver has no account — the unguessable token
   in the URL is the credential, and it expires on its own.

   Nothing here reads a location. The driver's browser pushes a position only
   after they tap "Allow", and only while they keep the page open.          */
const DeliveryTrackingModel = require('./models/DeliveryTracking');

// Serve the driver page for any live token. The page itself asks for consent.
app.get('/track/delivery/:token', rateLimitPositions, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'src', 'track-delivery.html'));
});

// What is this delivery? Shown to the driver so they know what they're sharing for.
app.get('/api/public/delivery/:token', rateLimitPositions, async (req, res) => {
    try {
        const t = await DeliveryTrackingModel.findLiveByToken(req.params.token);
        if (!t) return res.status(404).json({ success: false, message: 'This tracking link is no longer active.' });
        res.json({
            success: true,
            data: {
                po_number: t.po_number,
                supplier_name: t.supplier_name,
                expected_delivery_date: t.expected_delivery_date,
                expires_at: t.expires_at,
                already_sharing: !!t.first_shared_at
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not load this delivery.' });
    }
});

app.post('/api/public/delivery/:token/position', rateLimitPositions, async (req, res) => {
    try {
        const t = await DeliveryTrackingModel.findLiveByToken(req.params.token);
        if (!t) return res.status(404).json({ success: false, message: 'This tracking link is no longer active.' });

        const lat = Number(req.body.latitude);
        const lng = Number(req.body.longitude);
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
            return res.status(400).json({ success: false, message: 'Invalid position' });
        }
        const acc = Number(req.body.accuracy);

        await DeliveryTrackingModel.addPosition(t.id, lat, lng, Number.isFinite(acc) ? acc : null);
        res.json({ success: true });
    } catch (e) {
        console.error('Position update error:', e.message);
        res.status(500).json({ success: false, message: 'Could not record the position.' });
    }
});

// The driver can stop sharing from their own phone, not just the shop.
app.post('/api/public/delivery/:token/stop', rateLimitPositions, async (req, res) => {
    try {
        const t = await DeliveryTrackingModel.findLiveByToken(req.params.token);
        if (t) await DeliveryTrackingModel.revokeForPO(t.po_id);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: true });   // stopping should never fail loudly
    }
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

/* Schema migrations run one after another, never concurrently.

   They used to be fired off in parallel at module load, which raced two
   connections issuing DDL against the same tables — MySQL resolved that by
   deadlocking one of them, and whichever lost simply logged an error and left
   its migration unapplied. Sequential is slower by milliseconds and correct
   every time. */
async function runMigrations() {
    await ensureOpsTables();
    await ensurePasswordResetColumns();
    await ensureEmailVerificationColumns();
    await ensureEmailCodesTable();
    await ensureEmailLogsTable();
    await ensureIndexes();
    console.log('[DB] migrations complete');
}
runMigrations();

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

module.exports = { buildBackup };
