const AuditLog = require('../models/AuditLog');

exports.getAuditLogs = async (req, res) => {
    try {
        const { action, table_name, page, limit } = req.query;

        const filters = {};
        if (action) filters.action = action;
        if (table_name) filters.table_name = table_name;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(limit) || 20));
        const offset = (pageNum - 1) * perPage;

        const [logs, total] = await Promise.all([
            AuditLog.getByFilters(filters, perPage, offset),
            AuditLog.count(filters)
        ]);

        res.status(200).json({
            success: true,
            data: logs,
            total,
            page: pageNum,
            per_page: perPage
        });
    } catch (error) {
        console.error('Get audit logs error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving audit logs'
        });
    }
};
