const AuditLog = require('../models/AuditLog');

async function logAudit(userId, action, tableName, recordId, oldValue, newValue, ipAddress) {
    try {
        await AuditLog.create({
            user_id: userId,
            action,
            table_name: tableName,
            record_id: recordId,
            old_value: oldValue || null,
            new_value: newValue || null,
            ip_address: ipAddress || null
        });
    } catch (error) {
        console.error('Failed to log audit:', error.message);
    }
}

module.exports = logAudit;
