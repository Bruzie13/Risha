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

/* ── Email layout ────────────────────────────────────────────────────────
   Mail clients are not browsers: Gmail strips <style> blocks, Outlook has no
   flexbox or border-radius on containers, and images are blocked until the
   reader allows them. So everything below is table-based with inline styles,
   and every message has to still read correctly with no images at all.

   The colours are the shop sign's, the same as the system itself: the blue of
   its disc across the top, a strip of its yellow under that, its red for the
   one thing to press, on the pale-yellow paper the pages sit on.

   Every email goes through emailShell(), has a preheader (the grey snippet
   beside the subject in the inbox) and carries a plain-text twin: filters
   score an HTML-only message as something a script threw together. Subjects
   are plain sentences — no emoji, no capitals for emphasis. Anything that came
   from a person or the database is escaped before it is put into HTML. */

const BRAND = {
    app: 'FETCH',
    org: 'Risha Pet Supplies',
    primary: '#E3202B',     // the button: the red of the R
    primaryEdge: '#B5141D',
    sky: '#0A78C5',         // the band across the top
    sun: '#FFD23F',         // the strip under it, and notices
    sunSoft: '#FFF0B8',
    sunInk: '#4E3C00',
    link: '#0969AD',
    ink: '#10283F',
    body: '#37506A',
    muted: '#5A6E82',
    line: '#EDDDA2',
    lineSoft: '#F6ECC6',
    raised: '#FFF9E3',
    page: '#FFF5D1',
    ok: '#107A45',
    danger: '#D11A26'
};
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const esc = escapeAttr;

/** ₱1,234.50 — the same on every email. */
function money(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Wrap a message body in the shared branded shell.
 * `preheader` is the grey snippet Gmail shows beside the subject in the inbox
 * list — without one, clients scrape the first visible text, which reads badly.
 */
function emailShell({ preheader, title, contentHtml, footerNote, trailer = '' }) {
    return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-text-size-adjust:100%;">
<span style="display:none;font-size:1px;color:${BRAND.page};max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.page}" style="background:${BRAND.page};padding:28px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;font-family:${FONT};">
        <tr>
          <td bgcolor="${BRAND.sky}" style="background:${BRAND.sky};padding:18px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:14px;">
                  <img src="${BASE_URL}/images/favicon-192.png" width="48" height="48" alt=""
                       style="display:block;border:3px solid #FFFFFF;border-radius:50%;background:#FFFFFF;" />
                </td>
                <td style="vertical-align:middle;">
                  <div style="font-size:19px;line-height:1.2;font-weight:bold;color:#FFFFFF;">${BRAND.org}</div>
                  <div style="font-size:13px;line-height:1.4;color:#FFFFFF;">${BRAND.app} inventory and sales</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td bgcolor="${BRAND.sun}" height="6" style="background:${BRAND.sun};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:30px 28px 26px;">
            ${contentHtml}
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.raised}" style="background:${BRAND.raised};border-top:1px solid ${BRAND.line};padding:16px 28px 20px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted};">${footerNote}</p>
            <p style="margin:8px 0 0;font-size:13px;font-weight:bold;color:${BRAND.ink};">${BRAND.org}</p>
          </td>
        </tr>
      </table>
      <p style="margin:14px 0 0;font-size:12px;color:${BRAND.muted};font-family:${FONT};">
        Sent automatically by the ${BRAND.app} system. Replies to this address are not read.
      </p>
    </td>
  </tr>
</table>
${trailer}
</body>
</html>`;
}

function paragraph(html) {
    return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.body};">${html}</p>`;
}

function heading(text) {
    return `<h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;font-weight:bold;color:${BRAND.ink};">${text}</h1>`;
}

/** The one thing to press. A table cell, because Outlook ignores padding on links. */
function ctaButton(url, label) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 8px;">
      <tr><td align="center" bgcolor="${BRAND.primary}" style="background:${BRAND.primary};border-radius:10px;border-bottom:3px solid ${BRAND.primaryEdge};">
        <a href="${esc(url)}" style="display:inline-block;padding:13px 32px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;font-family:${FONT};">${label}</a>
      </td></tr>
    </table>`;
}

/** Small print under a button. */
function fine(html, align = 'center') {
    return `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${BRAND.muted};text-align:${align};">${html}</p>`;
}

function fallbackLink(url) {
    return fine(`If the button does not work, copy this into your browser:<br /><a href="${esc(url)}" style="color:${BRAND.link};word-break:break-all;">${esc(url)}</a>`, 'left');
}

/** A yellow panel for the one fact that must not be missed. */
function notice(html) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">
      <tr><td bgcolor="${BRAND.sunSoft}" style="background:${BRAND.sunSoft};border:1px solid ${BRAND.sun};border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.55;color:${BRAND.sunInk};">${html}</td></tr>
    </table>`;
}

/** Label / value pairs in a ruled box: [['Username', 'ana'], ...]. Values are escaped here. */
function facts(pairs) {
    const rows = pairs.map(([k, v], i) => `<tr>
        <td style="font-size:13px;color:${BRAND.muted};padding:${i ? 8 : 0}px 0 0;">${esc(k)}</td>
        <td align="right" style="font-size:14px;font-weight:bold;color:${BRAND.ink};padding:${i ? 8 : 0}px 0 0;">${esc(v)}</td>
      </tr>`).join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;border:1px solid ${BRAND.line};border-radius:12px;">
      <tr><td style="padding:16px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr>
    </table>`;
}

/**
 * A data table. columns: [{ label, align }]; rows: arrays of cells, each a
 * string (escaped here) or { html } for a cell this file built itself.
 */
function dataTable(columns, rows) {
    const th = columns.map(c => `<th align="${c.align || 'left'}" style="padding:9px 10px;font-size:12.5px;font-weight:bold;color:${BRAND.body};background:${BRAND.raised};border-bottom:1px solid ${BRAND.line};">${esc(c.label)}</th>`).join('');
    const tr = rows.map(r => '<tr>' + r.map((cell, i) => {
        const html = cell && typeof cell === 'object' ? cell.html : esc(cell);
        return `<td align="${columns[i].align || 'left'}" style="padding:9px 10px;font-size:14px;line-height:1.45;color:${BRAND.ink};border-bottom:1px solid ${BRAND.lineSoft};">${html}</td>`;
    }).join('') + '</tr>').join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;border:1px solid ${BRAND.line};border-radius:12px;border-collapse:separate;overflow:hidden;">
      <thead><tr>${th}</tr></thead><tbody>${tr}</tbody>
    </table>`;
}

function tag(text, colour) {
    return { html: `<span style="font-size:12.5px;font-weight:bold;color:${colour};">${esc(text)}</span>` };
}

/**
 * Load email config. DB settings (app_settings) take priority, .env is the fallback.
 */
async function getEmailConfig(forceRefresh = false) {
    if (cachedConfig && !forceRefresh) return cachedConfig;

    const config = {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || '',
        fromName: BRAND.org,
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

// Railway blocks outbound SMTP on its free plan, so production sends over
// Brevo's HTTPS API when BREVO_API_KEY is set. The sender address must be a
// verified sender in the Brevo account.
async function sendViaBrevo(config, mailOptions) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            sender: { email: config.user, name: config.fromName },
            to: [{ email: mailOptions.to }],
            subject: mailOptions.subject,
            htmlContent: mailOptions.html,
            // A text part is what separates real mail from something a script
            // threw together; filters weigh HTML-only messages more harshly.
            ...(mailOptions.text ? { textContent: mailOptions.text } : {})
        })
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Brevo API ${res.status}: ${body.slice(0, 200)}`);
    }
}

async function sendMessage(config, mailOptions) {
    if (process.env.BREVO_API_KEY) {
        await sendViaBrevo(config, mailOptions);
        return;
    }
    const transporter = buildTransporter(config);
    if (!transporter) throw new Error('Email credentials not configured');
    await transporter.sendMail(mailOptions);
}

/**
 * Verify credentials actually work by connecting to Gmail SMTP.
 */
async function verifyEmailConfig(user, pass) {
    if (!isValidEmail(user)) return { ok: false, error: 'Sender email address is not a valid email' };
    // Sends go over Brevo's HTTPS API — Gmail SMTP is unused and can't be
    // verified from hosts that block SMTP, so accept the settings as-is.
    if (process.env.BREVO_API_KEY) return { ok: true };
    if (!user || !pass) return { ok: false, error: 'Email and app password are required' };
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
 * The button in a supplier email. Pressing it marks the email as read in
 * email_logs (which works even when the mail client blocks images and so
 * defeats the tracking pixel) and lands on a page that points to the supplier
 * portal.
 */
function confirmButton(trackingId, label) {
    if (!trackingId) return '';
    return ctaButton(`${BASE_URL}/track/click/${trackingId}`, label) +
        fine(`Pressing it tells ${BRAND.org} you have seen this email.`);
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

    if (!process.env.BREVO_API_KEY && !buildTransporter(config)) {
        console.error(`[Email] ${context}: no email credentials configured (set them in Settings → Email or backend/.env) — email not sent`);
        await updateEmailStatus(trackingId, 'failed', 'Email credentials not configured');
        return false;
    }

    mailOptions.from = `"${config.fromName}" <${config.user}>`;

    try {
        await sendMessage(config, mailOptions);
        console.log(`[Email] ${context}: sent to ${recipientEmail}`);
        await updateEmailStatus(trackingId, 'sent');
        return true;
    } catch (error) {
        console.error(`[Email] ${context}: send failed to ${recipientEmail} — ${error.message}`);
        await updateEmailStatus(trackingId, 'failed', error.message);
        return false;
    }
}

/* ── The messages ────────────────────────────────────────────────────────
   Each one is built by a pure function in `templates` that returns
   { subject, html, text }, so it can be previewed and tested without sending. */
const templates = {};

templates.purchaseOrder = function ({ supplierName, poNumber, items, totalAmount, trackingId }) {
    const list = Array.isArray(items) ? items : [];
    const lineTotal = i => Number(i.total_price || i.subtotal || (Number(i.quantity || 0) * Number(i.unit_price || 0)) || 0);
    const count = `${list.length} item${list.length === 1 ? '' : 's'}`;
    const contentHtml =
        heading(`Purchase order ${esc(poNumber)}`) +
        paragraph(`Dear <strong>${esc(supplierName || 'supplier')}</strong>,`) +
        paragraph(`${BRAND.org} would like to order the items below. Please confirm the quantities you can supply and when you can deliver.`) +
        dataTable(
            [{ label: 'Item' }, { label: 'Qty', align: 'right' }, { label: 'Unit price', align: 'right' }, { label: 'Amount', align: 'right' }],
            list.map(i => [i.product_name || 'Product', String(i.quantity ?? ''), money(i.unit_price), money(lineTotal(i))])
        ) +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
           <td style="font-size:14px;color:${BRAND.muted};">${count}</td>
           <td align="right" style="font-size:20px;font-weight:bold;color:${BRAND.ink};">Total ${money(totalAmount)}</td>
         </tr></table>` +
        confirmButton(trackingId, 'Confirm you received this order');
    const text = [
        `Purchase order ${poNumber}`, '',
        `Dear ${supplierName || 'supplier'},`, '',
        `${BRAND.org} would like to order the items below. Please confirm the quantities you can supply and when you can deliver.`, '',
        ...list.map(i => `- ${i.product_name || 'Product'}: ${i.quantity} x ${money(i.unit_price)} = ${money(lineTotal(i))}`), '',
        `Total: ${money(totalAmount)} (${count})`, '',
        trackingId ? `Confirm you received this order: ${BASE_URL}/track/click/${trackingId}` : '',
        '', BRAND.org
    ].join('\n');
    return {
        subject: `Purchase order ${poNumber} from ${BRAND.org}`,
        text,
        html: emailShell({
            preheader: `${count}, total ${money(totalAmount)}. Please confirm what you can supply and when.`,
            title: `Purchase order ${poNumber}`,
            contentHtml,
            footerNote: `You received this because ${BRAND.org} lists you as the supplier for these products. If something in the order is wrong, contact the shop before delivering.`,
            trailer: trackingPixel(trackingId)
        })
    };
};

async function sendPOEmail(supplierId, supplierEmail, supplierName, poNumber, items, totalAmount) {
    const trackingId = await logEmail(supplierId, supplierEmail, `PO ${poNumber}`, 'po');
    const mail = templates.purchaseOrder({ supplierName, poNumber, items, totalAmount, trackingId });
    return deliver(trackingId, supplierEmail, { to: supplierEmail, ...mail }, `PO ${poNumber}`);
}

templates.lowStock = function ({ supplierName, items, trackingId }) {
    const list = Array.isArray(items) ? items : [];
    const out = list.filter(i => Number(i.stock_quantity) <= 0).length;
    const n = list.length;
    const summary = `${n} product${n === 1 ? ' is' : 's are'} running low` + (out ? `, ${out} already sold out` : '');
    const contentHtml =
        heading(`${n} product${n === 1 ? '' : 's'} you supply ${n === 1 ? 'is' : 'are'} running low`) +
        paragraph(`Dear <strong>${esc(supplierName || 'supplier')}</strong>,`) +
        (out ? notice(`<strong>${out}</strong> of these ${out === 1 ? 'is' : 'are'} already sold out at the shop.`) : '') +
        paragraph(`Stock of the products below has fallen to the level where ${BRAND.org} reorders. No order has been placed yet. This is advance notice so you can check what you have on hand.`) +
        dataTable(
            [{ label: 'Product' }, { label: 'SKU' }, { label: 'In stock', align: 'right' }, { label: 'Reorders at', align: 'right' }, { label: 'Status', align: 'right' }],
            list.map(i => [
                i.name || 'Product', i.sku || 'none', String(Number(i.stock_quantity) || 0), String(i.reorder_level ?? ''),
                Number(i.stock_quantity) <= 0 ? tag('Sold out', BRAND.danger) : tag('Low', BRAND.sunInk)
            ])
        ) +
        confirmButton(trackingId, 'Let the shop know you saw this');
    const text = [
        `${summary} at ${BRAND.org}`, '',
        `Dear ${supplierName || 'supplier'},`, '',
        `Stock of the products below has fallen to the level where ${BRAND.org} reorders. No order has been placed yet.`, '',
        ...list.map(i => `- ${i.name || 'Product'} (${i.sku || 'no SKU'}): ${Number(i.stock_quantity) || 0} in stock, reorders at ${i.reorder_level}`), '',
        trackingId ? `Let the shop know you saw this: ${BASE_URL}/track/click/${trackingId}` : '',
        '', BRAND.org
    ].join('\n');
    return {
        subject: `${summary} at ${BRAND.org}`,
        text,
        html: emailShell({
            preheader: 'No order has been placed yet. This is advance notice of what the shop is likely to need.',
            title: 'Products running low',
            contentHtml,
            footerNote: `You received this because ${BRAND.org} lists you as the supplier for these products.`,
            trailer: trackingPixel(trackingId)
        })
    };
};

async function sendLowStockAlert(supplierId, supplierEmail, supplierName, items) {
    const trackingId = await logEmail(supplierId, supplierEmail, `Low stock: ${items.length} products`, 'low_stock');
    const mail = templates.lowStock({ supplierName, items, trackingId });
    return deliver(trackingId, supplierEmail, { to: supplierEmail, ...mail }, 'Low stock alert');
}

function requireSender(config) {
    if (!process.env.BREVO_API_KEY && !buildTransporter(config)) {
        throw new Error('Email credentials not configured');
    }
}
const fromLine = config => `"${config.fromName}" <${config.user}>`;

templates.passwordReset = function ({ fullName, resetUrl, lasts }) {
    const contentHtml =
        heading('Choose a new password') +
        paragraph(`Hi <strong>${esc(fullName || 'there')}</strong>,`) +
        paragraph(`A password reset was requested for your <strong>${BRAND.app}</strong> account at ${BRAND.org}. Press the button to choose a new one.`) +
        ctaButton(resetUrl, 'Choose a new password') +
        fine(`This link works for <strong>${esc(lasts)}</strong>, and only once.`) +
        fallbackLink(resetUrl);
    const text = [
        'Choose a new password', '',
        `Hi ${fullName || 'there'},`, '',
        `A password reset was requested for your ${BRAND.app} account at ${BRAND.org}. Open this link to choose a new one:`, '',
        resetUrl, '',
        `The link works for ${lasts}, and only once.`, '',
        `If you didn't ask for this, ignore this email. Your password will not change.`, '',
        BRAND.org
    ].join('\n');
    return {
        subject: `Reset your ${BRAND.app} password`,
        text,
        html: emailShell({
            preheader: `Choose a new password for your ${BRAND.app} account. The link works for ${lasts}.`,
            title: `Reset your ${BRAND.app} password`,
            contentHtml,
            footerNote: `You received this because a password reset was requested for the ${BRAND.app} account on this address. If that wasn't you, ignore this email. Your password will not change.`
        })
    };
};

/**
 * Password reset email. `ttlMinutes` is how long the link works: 30 minutes
 * for a direct link, longer when an administrator approved the request. No
 * tracking pixel — this is an account-security email.
 */
async function sendPasswordResetEmail(toEmail, fullName, resetToken, ttlMinutes = 30) {
    const lasts = ttlMinutes >= 60 && ttlMinutes % 60 === 0
        ? `${ttlMinutes / 60} hour${ttlMinutes === 60 ? '' : 's'}`
        : `${ttlMinutes} minutes`;
    const config = await getEmailConfig();
    requireSender(config);
    const mail = templates.passwordReset({ fullName, resetUrl: `${BASE_URL}/reset-password.html?token=${resetToken}`, lasts });
    await sendMessage(config, { from: fromLine(config), to: toEmail, ...mail });
}

templates.verifyAddress = function ({ fullName, verifyUrl }) {
    const contentHtml =
        heading('Confirm your email address') +
        paragraph(`Hi <strong>${esc(fullName || 'there')}</strong>,`) +
        paragraph(`This address was set on your <strong>${BRAND.app}</strong> account at ${BRAND.org}. Confirm it to switch your sign-in on.`) +
        ctaButton(verifyUrl, 'Confirm this address') +
        fine('This link works for <strong>24 hours</strong>.') +
        fallbackLink(verifyUrl);
    const text = [
        'Confirm your email address', '',
        `Hi ${fullName || 'there'},`, '',
        `This address was set on your ${BRAND.app} account at ${BRAND.org}. Open this link to confirm it and switch your sign-in on:`, '',
        verifyUrl, '',
        'The link works for 24 hours.', '',
        `If you weren't expecting this, ignore it. The account stays locked until someone confirms.`, '',
        BRAND.org
    ].join('\n');
    return {
        subject: `Confirm your email address for ${BRAND.app}`,
        text,
        html: emailShell({
            preheader: `Confirm this address to switch your ${BRAND.app} sign-in on. The link works for 24 hours.`,
            title: `Confirm your ${BRAND.app} email address`,
            contentHtml,
            footerNote: `You received this because this address was set on a ${BRAND.app} account at ${BRAND.org}. If that wasn't expected, ignore this email. The account stays locked until someone confirms it.`
        })
    };
};

/**
 * Confirm an account's email address really exists and belongs to them.
 * Until the link is clicked the account cannot sign in, so a typo'd or made-up
 * address is caught on day one instead of the day someone needs a reset.
 */
async function sendVerificationEmail(toEmail, fullName, verifyToken) {
    const config = await getEmailConfig();
    requireSender(config);
    const mail = templates.verifyAddress({ fullName, verifyUrl: `${BASE_URL}/verify-email.html?token=${verifyToken}` });
    await sendMessage(config, { from: fromLine(config), to: toEmail, ...mail });
}

templates.emailCode = function ({ code }) {
    const contentHtml =
        heading('Your verification code') +
        paragraph(`An account is being set up for you on <strong>${BRAND.app}</strong>, the inventory and sales system used at ${BRAND.org}.`) +
        paragraph('Give this code to the person setting up your account:') +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
          <tr><td align="center" bgcolor="${BRAND.sunSoft}" style="background:${BRAND.sunSoft};border:1px solid ${BRAND.sun};border-radius:14px;padding:20px 16px;">
            <div style="font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:bold;letter-spacing:10px;color:${BRAND.ink};">${esc(code)}</div>
            <div style="font-size:13px;color:${BRAND.sunInk};margin-top:10px;">Works for 10 minutes</div>
          </td></tr>
        </table>` +
        paragraph(`Until this code is entered, <strong>no account exists</strong>. It is asked for so that nobody can register an address they do not own.`);
    const text = [
        'Your verification code', '',
        `An account is being set up for you on ${BRAND.app}, the inventory and sales system used at ${BRAND.org}.`, '',
        `Your code: ${code}`,
        'It works for 10 minutes.', '',
        'Give this code to the person setting up your account. Until it is entered, no account exists.', '',
        `If you were not expecting this, ignore this email. Nothing was created, and nobody can use your address without the code.`, '',
        BRAND.org
    ].join('\n');
    return {
        subject: `${code} is your ${BRAND.app} verification code`,
        text,
        html: emailShell({
            preheader: `${code} is your verification code for ${BRAND.app}. It works for 10 minutes.`,
            title: `Your ${BRAND.app} verification code`,
            contentHtml,
            footerNote: `You received this because someone at ${BRAND.org} entered this address when setting up an account. If that wasn't expected, ignore this email. No account is created without the code.`
        })
    };
};

/**
 * Send the 6-digit code an admin must type back before an account is created.
 * Proving the inbox exists up front means a typo'd Gmail never becomes a user.
 */
async function sendEmailCode(toEmail, code) {
    const config = await getEmailConfig();
    requireSender(config);
    await sendMessage(config, { from: fromLine(config), to: toEmail, ...templates.emailCode({ code }) });
}

const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', viewer: 'Viewer', cashier: 'Staff (point of sale)', supplier: 'Supplier' };

templates.welcome = function ({ toEmail, fullName, username, role }) {
    const roleLabel = ROLE_LABELS[role] || ROLE_LABELS.cashier;
    const loginUrl = `${BASE_URL}/login.html`;
    const first = (fullName || '').split(' ')[0] || 'there';
    const contentHtml =
        heading(`Welcome, ${esc(first)}`) +
        paragraph(`Your account at <strong>${BRAND.org}</strong> is ready. ${BRAND.app} is where the shop's stock, sales and suppliers are kept.`) +
        facts([['Username', username], ['Email', toEmail], ['Access', roleLabel]]) +
        paragraph('Sign in with the password you agreed with your administrator, then change it from Settings.') +
        ctaButton(loginUrl, `Sign in to ${BRAND.app}`) +
        fine(`Or open <a href="${esc(loginUrl)}" style="color:${BRAND.link};">${esc(loginUrl)}</a>`);
    const text = [
        `Welcome, ${first}`, '',
        `Your account at ${BRAND.org} is ready.`, '',
        `Username: ${username}`,
        `Email: ${toEmail}`,
        `Access: ${roleLabel}`, '',
        `Sign in at ${loginUrl} with the password you agreed with your administrator, then change it from Settings.`, '',
        BRAND.org
    ].join('\n');
    return {
        subject: `Your ${BRAND.app} account is ready`,
        text,
        html: emailShell({
            preheader: `Your account at ${BRAND.org} is ready. Here is your username and where to sign in.`,
            title: `Your ${BRAND.app} account is ready`,
            contentHtml,
            footerNote: `An administrator at ${BRAND.org} created this account after confirming your email address. If you did not expect it, contact them before signing in.`
        })
    };
};

/**
 * The "you're in" email sent once the account actually exists: what it is,
 * who they are on it, and where to sign in.
 */
async function sendWelcomeEmail(toEmail, fullName, username, role) {
    const config = await getEmailConfig();
    requireSender(config);
    await sendMessage(config, { from: fromLine(config), to: toEmail, ...templates.welcome({ toEmail, fullName, username, role }) });
}

templates.test = function ({ sender, sentAt }) {
    const contentHtml =
        heading('Your email settings work') +
        paragraph(`This is a test from the ${BRAND.app} system at ${BRAND.org}. If you are reading it, the system can send email.`) +
        facts([['Sent from', sender], ['Sent at', sentAt]]) +
        paragraph('Purchase orders, password resets and low-stock notices will come from this address.');
    const text = [
        'Your email settings work', '',
        `This is a test from the ${BRAND.app} system at ${BRAND.org}. If you are reading it, the system can send email.`, '',
        `Sent from: ${sender}`, `Sent at: ${sentAt}`, '', BRAND.org
    ].join('\n');
    return {
        subject: `Test email from ${BRAND.app}: your settings work`,
        text,
        html: emailShell({
            preheader: 'If you are reading this, the system can send email.',
            title: `${BRAND.app} test email`,
            contentHtml,
            footerNote: `An administrator pressed "Send test email" in ${BRAND.app} Settings.`
        })
    };
};

/**
 * Send a test email so admins can verify their configuration from Settings.
 */
async function sendTestEmail(toEmail) {
    if (!isValidEmail(toEmail)) {
        return { success: false, message: 'Recipient is not a valid email address' };
    }

    const config = await getEmailConfig(true);
    if (!process.env.BREVO_API_KEY && !buildTransporter(config)) {
        return { success: false, message: 'Email credentials are not configured yet' };
    }

    const mail = templates.test({
        sender: config.user,
        sentAt: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
    });
    try {
        await sendMessage(config, { from: fromLine(config), to: toEmail, ...mail });
        return { success: true, message: `Test email sent to ${toEmail}` };
    } catch (error) {
        console.error('[Email] Test email failed:', error.message);
        return { success: false, message: `Send failed: ${error.message}` };
    }
}

templates.backup = function ({ tables, rows, kb, day }) {
    const contentHtml =
        heading(`Database backup for ${esc(day)}`) +
        paragraph(`Today's full backup of the ${BRAND.app} database is attached.`) +
        facts([['Tables', String(tables)], ['Rows', Number(rows || 0).toLocaleString('en-PH')], ['Size', `${kb} KB (zipped)`]]) +
        paragraph('Keep at least the last seven of these. To restore one, run <code>scripts/restore-backup.js</code> with the attached file.');
    const text = [
        `Database backup for ${day}`, '',
        `Today's full backup of the ${BRAND.app} database is attached.`, '',
        `Tables: ${tables}`, `Rows: ${rows}`, `Size: ${kb} KB (zipped)`, '',
        'Keep at least the last seven of these. To restore one, run scripts/restore-backup.js with the attached file.', '',
        BRAND.org
    ].join('\n');
    return {
        subject: `${BRAND.app} backup, ${day}`,
        text,
        html: emailShell({
            preheader: `${tables} tables, ${kb} KB. Keep at least the last seven.`,
            title: `${BRAND.app} backup`,
            contentHtml,
            footerNote: 'Sent every day to the address the system sends from, so a copy of the data always exists outside the server.'
        })
    };
};

// Daily database backup, attached as a .zip. Sent to the configured sender
// address (the shop's own inbox acts as offsite storage).
//
// The attachment must be a .zip: Brevo rejects .gz with "Unsupported file
// format", which silently killed this email every night until it was changed.
async function sendBackupEmail(zipBuffer, meta) {
    const config = await getEmailConfig();
    if (!config.enabled) return false;
    const to = config.user;
    const filename = meta.filename || ('risha-backup-' + new Date().toISOString().slice(0, 10) + '.zip');
    const day = new Date().toISOString().slice(0, 10);
    const mail = templates.backup({ tables: meta.tables, rows: meta.rows, kb: (zipBuffer.length / 1024).toFixed(0), day });
    const html = mail.html;
    try {
        if (process.env.BREVO_API_KEY) {
            const res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    sender: { email: config.user, name: config.fromName },
                    to: [{ email: to }],
                    subject: mail.subject,
                    htmlContent: html,
                    textContent: mail.text,
                    attachment: [{ name: filename, content: zipBuffer.toString('base64') }]
                })
            });
            if (!res.ok) throw new Error('Brevo ' + res.status + ': ' + (await res.text()).slice(0, 150));
        } else {
            const transporter = buildTransporter(config);
            if (!transporter) return false;
            await transporter.sendMail({
                from: `"${config.fromName}" <${config.user}>`,
                to,
                subject: mail.subject,
                html,
                text: mail.text,
                attachments: [{ filename, content: zipBuffer }]
            });
        }
        console.log(`[Backup] emailed ${filename} to ${to} (${(zipBuffer.length / 1024).toFixed(0)} KB)`);
        return true;
    } catch (e) {
        console.error('[Backup] email failed:', e.message);
        return false;
    }
}

module.exports = {
    sendPOEmail,
    sendPasswordResetEmail,
    sendVerificationEmail,
    sendEmailCode,
    sendWelcomeEmail,
    sendBackupEmail,
    sendLowStockAlert,
    sendTestEmail,
    verifyEmailConfig,
    getEmailConfig,
    invalidateEmailConfigCache,
    isValidEmail,
    templates          // pure builders: { subject, html, text } — for previews and tests
};
