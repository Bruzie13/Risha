const Notification = require('../models/Notification');

exports.getAllNotifications = async (req, res) => {
    try {
        const notifications = await Notification.getAll();
        res.status(200).json({
            success: true,
            data: notifications
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving notifications'
        });
    }
};

exports.getUnreadNotifications = async (req, res) => {
    try {
        const notifications = await Notification.getUnread();
        res.status(200).json({
            success: true,
            data: notifications
        });
    } catch (error) {
        console.error('Get unread notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving unread notifications'
        });
    }
};

exports.createNotification = async (req, res) => {
    try {
        const { title, message, type, related_id, related_type } = req.body;

        if (!title || !message) {
            return res.status(400).json({
                success: false,
                message: 'Title and message are required'
            });
        }

        const notification = await Notification.create({
            title,
            message,
            type: type || 'info',
            related_id: related_id || null,
            related_type: related_type || null
        });

        res.status(201).json({
            success: true,
            message: 'Notification created successfully',
            data: notification
        });
    } catch (error) {
        console.error('Create notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating notification'
        });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.markAsRead(id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Notification marked as read',
            data: notification
        });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking notification as read'
        });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.markAllAsRead();
        res.status(200).json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking all notifications as read'
        });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.delete(id);

        res.status(200).json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting notification'
        });
    }
};
