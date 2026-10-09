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
/* Content-Security-Policy.

   The pages carry ~287 inline on* handlers, so script-src has to allow
   'unsafe-inline' until those are rewritten as listeners — this policy does
   NOT stop a script from running. What it does stop is that script talking to
   anyone: connect-src and img-src are restricted to our own origin and the few
   hosts we genuinely use, which is the step that turns a stolen token into a
   token the attacker cannot send anywhere. Tightening script-src is the
   follow-up work; the containment is worth having now.

   Origins allowed, and why: jsdelivr serves the Chart.js script, Google hosts
   the fonts, Cloudinary serves product images when CLOUDINARY_URL is
   configured (they are data: URIs otherwise). Nothing else: the supplier map
   and its tiles are gone, so no map host is allowed any more. */
const CSP = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://res.cloudinary.com",
    "connect-src 'self'"
].join('; ');

// Security headers on every response
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');   // no MIME sniffing
    res.setHeader('X-Frame-Options', 'DENY');             // no clickjacking via iframes
    res.setHeader('Referrer-Policy', 'same-origin');
    // Nothing in the app asks for a device's location any more (live delivery
    // tracking was removed), so no page — ours included — may request it.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
        // force HTTPS for 180 days once a browser has seen the site over HTTPS
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const { pageAllowed, homePage } = require('./utils/roles');
function authPageGuard(req, res, next) {
    const publicPages = ['/login.html', '/reset-password.html', '/verify-email.html', '/', ''];
    if (publicPages.includes(req.path)) return next();
    if (!req.path.endsWith('.html')) return next();

    // Only accept the auth cookie — never tokens in the URL (they leak into logs/history)
    const token = req.cookies?.token;
    if (token) {
        try {
            const claims = jwt.verify(token, process.env.JWT_SECRET);
            // Send an account to its own screen rather than serving it a page
            // it has no use for. This is navigation, not the security
            // boundary: the data behind every page is guarded by the API.
            if (!pageAllowed(claims.role, req.path)) return res.redirect(homePage(claims.role));
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

app.use('/api/supplier-portal', require('./routes/supplierPortal'));

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

async function ensureTokenVersionColumn() {
    try {
        const conn = await pool.getConnection();
        // Bumped whenever an account is deactivated, deleted, demoted, or has
        // its password changed. A JWT carries the version it was minted with,
        // so raising it makes every token issued before now stop verifying —
        // the piece stateless JWTs otherwise lack.
        try { await conn.execute('ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0'); } catch (e) { /* column exists */ }
        conn.release();
        console.log('[DB] token_version column ready');
    } catch (e) {
        console.error('[DB] token_version migration error:', e.message);
    }
}

/* Forgotten-password requests waiting for an administrator. Additive: a new
   table, nothing existing is altered. */
async function ensureResetRequestTable() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS password_reset_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                status ENUM('pending', 'approved', 'declined') NOT NULL DEFAULT 'pending',
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                requested_ip VARCHAR(64) NULL,
                decided_by INT NULL,
                decided_at DATETIME NULL,
                INDEX idx_prr_status (status, requested_at),
                INDEX idx_prr_user (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`);
        console.log('[DB] password reset request table ready');
    } catch (e) {
        console.error('[DB] password reset request migration error:', e.message);
    }
}

async function ensureAccountRoles() {
    try {
        const conn = await pool.getConnection();
        // Two fenced-in account types: the till (cashier) and an outside
        // supplier. A supplier login is tied to exactly one supplier record.
        // MODIFY only widens the list, so existing rows are untouched.
        try {
            await conn.execute("ALTER TABLE users MODIFY role ENUM('admin','manager','staff','viewer','cashier','supplier') DEFAULT 'staff'");
        } catch (e) { console.error('[DB] role list migration error:', e.message); }
        try { await conn.execute('ALTER TABLE users ADD COLUMN supplier_id INT NULL'); } catch (e) { /* column exists */ }
        // The staff role was retired in favour of cashier. Move anyone still
        // on it, and end their sessions so the change takes hold at once.
        // 'staff' stays in the column's list only so an older copy of the app
        // pointed at this database does not fail outright; this app no longer
        // offers or accepts it.
        try {
            const [moved] = await conn.execute(
                "UPDATE users SET role = 'cashier', token_version = token_version + 1 WHERE role = 'staff'");
            if (moved.affectedRows) console.log(`[DB] ${moved.affectedRows} staff account(s) became cashier`);
        } catch (e) { console.error('[DB] staff-to-cashier migration error:', e.message); }
        conn.release();
        console.log('[DB] cashier and supplier account roles ready');
    } catch (e) {
        console.error('[DB] account roles migration error:', e.message);
    }
}

async function ensureTillTables() {
    try {
        const conn = await pool.getConnection();
        // The cash each cashier's drawer starts the day with.
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS till_openings (
                business_date DATE NOT NULL,
                cashier_id INT NOT NULL,
                opening_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (business_date, cashier_id)
            )`);
        // A count per person per day instead of one for the whole shop, so a
        // second cashier no longer overwrites the first. The new key is added
        // before the old one is dropped, so there is never a moment with none.
        try { await conn.execute('ALTER TABLE cash_reconciliations ADD COLUMN opening_cash DECIMAL(12,2) NOT NULL DEFAULT 0'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE cash_reconciliations ADD UNIQUE KEY uq_count_per_person (business_date, counted_by)'); } catch (e) { /* key exists */ }
        try { await conn.execute('ALTER TABLE cash_reconciliations DROP INDEX business_date'); } catch (e) { /* already dropped */ }
        // A cashier's request for a manager to void a sale.
        try { await conn.execute('ALTER TABLE sales ADD COLUMN void_requested_at DATETIME NULL'); } catch (e) { /* column exists */ }
        try { await conn.execute('ALTER TABLE sales ADD COLUMN void_request_reason VARCHAR(300) NULL'); } catch (e) { /* column exists */ }
        conn.release();
        console.log('[DB] till tables ready (opening cash, per-cashier counts, void requests)');
    } catch (e) {
        console.error('[DB] till migration error:', e.message);
    }
}

async function ensureSupplyTables() {
    try {
        const conn = await pool.getConnection();
        const add = async sql => { try { await conn.execute(sql); } catch (e) { /* already there */ } };
        // What the supplier tells the shop about an order, in place of the old
        // live location link: when it will arrive, what is actually coming,
        // and the paperwork number to check it against.
        await add('ALTER TABLE purchase_orders ADD COLUMN promised_date DATE NULL');
        await add('ALTER TABLE purchase_orders ADD COLUMN promise_note VARCHAR(300) NULL');
        await add('ALTER TABLE purchase_orders ADD COLUMN delivery_ref VARCHAR(80) NULL');
        await add('ALTER TABLE po_items ADD COLUMN confirmed_quantity INT NULL');
        // Whether the shop has paid for it.
        await add('ALTER TABLE purchase_orders ADD COLUMN paid_at DATETIME NULL');
        // An order a supplier offered, waiting for the shop to accept.
        await add('ALTER TABLE purchase_orders ADD COLUMN proposed_by_supplier TINYINT(1) NOT NULL DEFAULT 0');
        try {
            await conn.execute("ALTER TABLE purchase_orders MODIFY status ENUM('pending','confirmed','shipped','received','cancelled','proposed') DEFAULT 'pending'");
        } catch (e) { console.error('[DB] order status list migration error:', e.message); }
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS po_messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                po_id INT NOT NULL,
                user_id INT NOT NULL,
                from_supplier TINYINT(1) NOT NULL DEFAULT 0,
                body VARCHAR(1000) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pom_po (po_id, created_at)
            )`);
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS price_proposals (
                id INT PRIMARY KEY AUTO_INCREMENT,
                supplier_id INT NOT NULL,
                product_id INT NOT NULL,
                current_price DECIMAL(10,2) NULL,
                proposed_price DECIMAL(10,2) NOT NULL,
                note VARCHAR(300) NULL,
                status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
                proposed_by INT NULL,
                decided_by INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                decided_at DATETIME NULL,
                INDEX idx_pp_supplier (supplier_id, status),
                INDEX idx_pp_status (status)
            )`);
        // Payment tracking starts the day it is switched on. Orders received
        // before then were never marked either way, and calling every one of
        // them "unpaid" would put a wall of false overdue notices in front of
        // the shop and its suppliers.
        await conn.execute(
            "INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('payment_tracking_since', DATE_FORMAT(CONVERT_TZ(NOW(),'+00:00','+08:00'), '%Y-%m-%d'))");
        conn.release();
        console.log('[DB] supplier portal tables ready (promises, confirmed quantities, payments, notes, price proposals)');
    } catch (e) {
        console.error('[DB] supplier portal migration error:', e.message);
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

// Tracking ids are crypto.randomBytes(32).toString('hex') — 64 hex characters,
// nothing else. Checking the shape before use keeps unvalidated path input out
// of both the database and the rendered page.
const TRACKING_ID_RE = /^[a-f0-9]{64}$/;

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
    // This id is interpolated into the inline script below, so it must be
    // proven to be an id before it is rendered. Tracking ids are
    // crypto.randomBytes(32).toString('hex') (see mailer.js), so the shape is
    // exact — anything else is not a link we ever sent.
    if (!TRACKING_ID_RE.test(trackingId)) {
        return res.status(404).type('text/plain').send('Not found');
    }
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
<title>Risha Pet Supplies: received</title>
<style>
    body { margin:0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:#FFD23F; color:#10283F; display:flex; align-items:center; justify-content:center; min-height:100vh; min-height:100dvh; }
    .card { background:#fff; border-radius:20px; box-shadow:0 6px 0 rgba(16,40,63,.14); padding:34px 36px 30px; max-width:420px; text-align:center; margin:20px; }
    .logo { width:84px; height:84px; border-radius:50%; border:4px solid #fff; box-shadow:0 0 0 2px #EDDDA2; display:block; margin:0 auto 16px; object-fit:cover; }
    h1 { font-size:22px; line-height:1.3; margin:0 0 8px; }
    p { font-size:15px; color:#37506A; line-height:1.6; margin:0; }
    .go { display:inline-block; margin-top:20px; padding:12px 26px; border-radius:10px; background:#E3202B; border-bottom:3px solid #B5141D; color:#fff; font-size:15px; font-weight:700; text-decoration:none; }
    .go:active { transform:translateY(2px); border-bottom-width:1px; }
    .brand { margin-top:20px; font-size:13px; font-weight:700; color:#10283F; }
</style>
</head>
<body>
    <div class="card">
        <img class="logo" src="/images/logo.jpeg" alt="">
        <h1>${known ? 'Thank you, received' : 'This link is no longer active'}</h1>
        <p>${known
            ? 'Risha Pet Supplies now knows you have seen the email. To confirm quantities, set a delivery date or update your prices, sign in to the supplier portal.'
            : 'It may have been used already or replaced by a newer email. You can still sign in to the supplier portal to see your orders.'}</p>
        <a class="go" href="/supplier.html">Open the supplier portal</a>
        <div class="brand">Risha Pet Supplies</div>
    </div>
    <script>
        // recorded only when a real browser runs this (bots don't)
        fetch('/track/confirm/${trackingId}', { method: 'POST' }).catch(function () {});
    </script>
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
    await ensureTokenVersionColumn();
    await ensureAccountRoles();
    await ensureResetRequestTable();
    await ensureTillTables();
    await ensureSupplyTables();
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
