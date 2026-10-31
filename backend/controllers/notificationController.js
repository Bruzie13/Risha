const Notification = require('../models/Notification');
const pool = require('../config/database');

exports.getAllNotifications = async (req, res) => {
    try {
        const { limit, offset, type, status } = req.query;
        const filters = { user_id: req.user.id };
        if (type) filters.type = String(type);
        if (status === 'read' || status === 'unread') filters.status = status;
        // Paginated only when a limit is given; otherwise the full list (kept
        // for any caller that still relies on it).
        const paginated = limit !== undefined;
        if (paginated) {
            filters.limit = parseInt(limit);
            if (offset !== undefined) filters.offset = parseInt(offset);
        }
        const notifications = await Notification.getAll(filters);
        const total = paginated ? await Notification.countAll(filters) : notifications.length;
        res.status(200).json({ success: true, data: notifications, total });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving notifications' });
    }
};

exports.getSummary = async (req, res) => {
    try {
        const summary = await Notification.getSummary(req.user.id);
        res.status(200).json({ success: true, data: summary });
    } catch (error) {
        console.error('Get notification summary error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving notification summary' });
    }
};

exports.clearRead = async (req, res) => {
    try {
        const deleted = await Notification.deleteRead(req.user.id);
        res.status(200).json({ success: true, message: `Cleared ${deleted} read notification(s)`, deleted });
    } catch (error) {
        console.error('Clear read notifications error:', error);
        res.status(500).json({ success: false, message: 'Error clearing notifications' });
    }
};

exports.getNotificationCount = async (req, res) => {
    try {
        const count = await Notification.getUnreadCount(req.user.id);
        res.status(200).json({ success: true, data: { count } });
    } catch (error) {
        console.error('Get notification count error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving notification count' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.markAsRead(id);
        res.status(200).json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ success: false, message: 'Error marking notification as read' });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.markAllAsRead(req.user.id);
        res.status(200).json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({ success: false, message: 'Error marking all as read' });
    }
};

/* ---------- A notification, opened (UAT, 31 Oct) ----------
   What it is about, looked up when it is opened, so every notice (old ones
   too) shows its details: the sale and who asked to void it, the cash taken
   out, the order and the emails that went with it, the product. Each comes
   with a link to where it is handled. Returned as rows of [label, value],
   an optional list of items and an optional link; the page formats them. */
const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = v => v ? new Date(v).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const day = v => v ? new Date(v).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : '—';

async function saleDetails(id) {
    const [[s]] = await pool.query(
        `SELECT s.id, s.sale_number, s.final_amount, s.customer_name, s.payment_status, s.created_at,
                s.void_requested_at, s.void_request_reason, u.full_name AS cashier
         FROM sales s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ?`, [id]);
    if (!s) return { rows: [['Sale', `#${id} (no longer on record)`]] };
    const [items] = await pool.query(
        `SELECT si.quantity, p.name FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`, [id]);
    const status = s.payment_status === 'voided' ? 'Voided: its items went back to stock'
        : s.void_requested_at ? 'Waiting for a manager to decide' : 'Completed';
    const rows = [['Sale', `#${s.id}`], ['Cashier', s.cashier || '—'], ['Customer', s.customer_name || 'Walk-in'],
        ['Total', peso(s.final_amount)], ['Sold', when(s.created_at)], ['Status', status]];
    if (s.void_requested_at) rows.push(['Void asked', when(s.void_requested_at)], ['Reason given', s.void_request_reason || '—']);
    return {
        rows, items: items.map(i => `${Number(i.quantity)} × ${i.name || 'a deleted product'}`),
        link: s.void_requested_at ? { label: 'Open Void requests', href: 'reports.html?tab=voids' } : { label: 'Open Sales history', href: 'sales.html?search=' + s.id }
    };
}

async function cashMoveDetails(id) {
    const [[m]] = await pool.query(
        `SELECT m.kind, m.amount, m.reason, m.created_at, u.full_name AS cashier
         FROM till_cash_moves m LEFT JOIN users u ON u.id = m.cashier_id WHERE m.id = ?`, [id]);
    if (!m) return { rows: [] };
    return {
        rows: [['Cash', m.kind === 'out' ? 'Taken out of the drawer' : 'Put into the drawer'], ['Amount', peso(m.amount)],
            ['Cashier', m.cashier || '—'], ['Who and why', m.reason || '—'], ['When', when(m.created_at)]],
        link: { label: 'Open End of day', href: 'sales.html?do=eod' }
    };
}

async function orderDetails(id) {
    const [[o]] = await pool.query(
        `SELECT po.id, po.po_number, po.status, po.total_amount, po.order_date, po.promised_date, po.delivery_ref,
                s.name AS supplier, s.email
         FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`, [id]);
    if (!o) return { rows: [['Order', `#${id} (no longer on record)`]] };
    const [items] = await pool.query(
        `SELECT poi.quantity, poi.unit_price, p.name FROM po_items poi LEFT JOIN products p ON p.id = poi.product_id
         WHERE poi.po_id = ? ORDER BY poi.id`, [id]);
    const [mails] = await pool.query(
        `SELECT subject, status, created_at, opened_at FROM email_logs
         WHERE subject LIKE ? ORDER BY created_at DESC LIMIT 5`, [`%${o.po_number}%`]);
    const STATUS = { proposed: 'Offered by the supplier', pending: 'Ordered', confirmed: 'Confirmed by the supplier', shipped: 'Shipped', received: 'Received', cancelled: 'Cancelled' };
    const rows = [['Order', o.po_number], ['Supplier', o.supplier ? `${o.supplier}${o.email ? ' (' + o.email + ')' : ''}` : '—'],
        ['Status', STATUS[o.status] || o.status], ['Total', peso(o.total_amount)], ['Ordered', day(o.order_date)]];
    if (o.promised_date) rows.push(['Delivery promised', day(o.promised_date)]);
    if (o.delivery_ref) rows.push(['Delivery receipt', o.delivery_ref]);
    mails.forEach(m => rows.push(['Email', `${m.subject}: ${m.status === 'failed' ? 'did not send' : m.opened_at ? 'opened ' + when(m.opened_at) : 'sent ' + when(m.created_at)}`]));
    return {
        rows, items: items.map(i => `${Number(i.quantity)} × ${i.name || 'a deleted product'} at ${peso(i.unit_price)}`),
        link: { label: 'Open Orders', href: 'suppliers.html?view=orders' }
    };
}

async function productDetails(id) {
    const [[p]] = await pool.query(
        `SELECT p.name, p.sku, p.stock_quantity, p.reorder_level, p.unit_type, DATE_FORMAT(p.expiration_date, '%Y-%m-%d') AS expires,
                s.name AS supplier
         FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`, [id]);
    if (!p) return { rows: [] };
    const rows = [['Product', p.name], ['SKU', p.sku || '—'], ['In stock now', `${Number(p.stock_quantity)} ${p.unit_type || 'piece'}`],
        ['Reorder level', String(Number(p.reorder_level))], ['Supplier', p.supplier || 'None']];
    if (p.expires) rows.push(['Expires', day(p.expires + 'T00:00:00+08:00')]);
    return { rows, link: { label: 'Open in Inventory', href: 'inventory.html?search=' + encodeURIComponent(p.sku || p.name) } };
}

exports.getDetails = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const [[n]] = await pool.query(
            `SELECT id, type, title, message, product_id, user_id, related_id, related_type, details, created_at
             FROM notifications WHERE id = ? AND (user_id IS NULL OR user_id = ?)`, [id, req.user.id]);
        if (!n) return res.status(404).json({ success: false, message: 'Notification not found' });
        let more = { rows: [] };
        if (n.related_type === 'sale' && n.related_id) more = await saleDetails(n.related_id);
        else if (n.related_type === 'till_cash_move' && n.related_id) more = await cashMoveDetails(n.related_id);
        else if (n.related_type === 'purchase_order' && n.related_id) more = await orderDetails(n.related_id);
        else if (n.product_id) more = await productDetails(n.product_id);
        // what the notice itself recorded when it was made (what an email listed)
        let own = null;
        try { own = n.details ? JSON.parse(n.details) : null; } catch (e) { own = null; }
        if (own) more = { rows: [...(own.rows || []), ...(more.rows || [])], items: own.items || more.items, link: more.link };
        if (n.related_type === 'supplier' && !more.link) more.link = { label: 'Open Suppliers', href: 'suppliers.html' };
        res.json({ success: true, data: { id: n.id, type: n.type, title: n.title, message: n.message, at: when(n.created_at), ...more } });
    } catch (error) {
        console.error('Notification details error:', error);
        res.status(500).json({ success: false, message: 'Error loading the notification' });
    }
};
exports._details = { saleDetails, cashMoveDetails, orderDetails, productDetails };
