const Notification = require('../models/Notification');

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

exports.getUnreadNotifications = async (req, res) => {
    try {
        const notifications = await Notification.getUnread(req.user.id);
        res.status(200).json({ success: true, data: notifications });
    } catch (error) {
        console.error('Get unread notifications error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving unread notifications' });
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

exports.getAlerts = async (req, res) => {
    try {
        const alerts = await Notification.getAlerts(req.user.id);
        res.status(200).json({ success: true, data: alerts });
    } catch (error) {
        console.error('Get alerts error:', error);
        res.status(500).json({ success: false, message: 'Error retrieving alerts' });
    }
};

exports.createNotification = async (req, res) => {
    try {
        const { title, message, type, product_id, user_id, related_id, related_type } = req.body;

        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Title and message are required' });
        }

        const notification = await Notification.create({
            title,
            message,
            type: type || 'info',
            product_id: product_id || null,
            user_id: user_id || null,
            related_id: related_id || null,
            related_type: related_type || null
        });

        res.status(201).json({ success: true, message: 'Notification created', data: notification });
    } catch (error) {
        console.error('Create notification error:', error);
        res.status(500).json({ success: false, message: 'Error creating notification' });
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

exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.delete(id);
        res.status(200).json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ success: false, message: 'Error deleting notification' });
    }
};

exports.deleteOldNotifications = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const deleted = await Notification.deleteOld(days);
        res.status(200).json({ success: true, message: `Deleted ${deleted} old notifications` });
    } catch (error) {
        console.error('Delete old notifications error:', error);
        res.status(500).json({ success: false, message: 'Error deleting old notifications' });
    }
};
