const Notification = require('../models/Notification');

async function notifySaleCreated(sale, userId) {
    const itemsCount = (sale.items || []).length;
    await Notification.create({
        title: 'New Sale Completed',
        message: `Sale #${sale.sale_number || sale.id} — ₱${parseFloat(sale.final_amount || sale.total_amount || 0).toFixed(2)} (${itemsCount} item(s))`,
        type: 'info',
        related_id: sale.id,
        related_type: 'sale',
        user_id: userId
    });
}

async function notifyStockAdjusted(product, oldQty, newQty, userId) {
    const diff = newQty - oldQty;
    const direction = diff > 0 ? 'increased' : 'decreased';
    await Notification.create({
        title: 'Stock Adjusted',
        message: `${product.name}: stock ${direction} from ${oldQty} to ${newQty}`,
        type: 'info',
        product_id: product.id,
        related_type: 'stock_adjustment',
        user_id: userId
    });

    if (newQty <= 0) {
        await Notification.create({
            title: 'Product Out of Stock',
            message: `${product.name} (${product.sku}) is now out of stock`,
            type: 'stockout',
            product_id: product.id,
            user_id: userId
        });
    } else if (newQty <= product.reorder_level) {
        await Notification.create({
            title: 'Low Stock Alert',
            message: `${product.name} (${product.sku}) is low on stock: ${newQty} remaining (reorder at ${product.reorder_level})`,
            type: 'low_stock',
            product_id: product.id,
            user_id: userId
        });
    }
}

async function notifyLowStock(product) {
    await Notification.create({
        title: 'Low Stock Alert',
        message: `${product.name} (${product.sku}) — only ${product.stock_quantity} left, reorder at ${product.reorder_level}`,
        type: 'low_stock',
        product_id: product.id
    });
}

async function notifyStockout(product) {
    await Notification.create({
        title: 'Out of Stock',
        message: `${product.name} (${product.sku}) is out of stock`,
        type: 'stockout',
        product_id: product.id
    });
}

async function notifyExpiringSoon(product, daysLeft) {
    await Notification.create({
        title: 'Product Expiring Soon',
        message: `${product.name} (${product.sku}) expires in ${daysLeft} day(s) on ${product.expiration_date}`,
        type: 'expiration',
        product_id: product.id
    });
}

async function notifyOverstock(product) {
    await Notification.create({
        title: 'Overstock Warning',
        message: `${product.name} (${product.sku}) — ${product.stock_quantity} in stock exceeds max level of ${product.max_stock_level}`,
        type: 'overstock',
        product_id: product.id
    });
}

async function notifyPOStatusChanged(po, oldStatus, newStatus, userId) {
    const statusIcons = { pending: '⏳', confirmed: '✅', shipped: '🚚', received: '📦', cancelled: '❌' };
    await Notification.create({
        title: 'PO Status Updated',
        message: `${statusIcons[newStatus] || ''} ${po.po_number}: ${oldStatus} → ${newStatus}`,
        type: 'info',
        related_id: po.id,
        related_type: 'purchase_order',
        user_id: userId
    });
}

async function notifyPOGenerated(po, userId) {
    await Notification.create({
        title: 'Purchase Order Created',
        message: `${po.po_number} — ₱${parseFloat(po.total_amount || 0).toFixed(2)}`,
        type: 'reorder',
        related_id: po.id,
        related_type: 'purchase_order',
        user_id: userId
    });
}

async function notifyProductCreated(product, userId) {
    await Notification.create({
        title: 'New Product Added',
        message: `${product.name} (${product.sku}) added to inventory`,
        type: 'info',
        product_id: product.id,
        user_id: userId
    });
}

async function notifyUserLogin(user, ip) {
    await Notification.create({
        title: 'User Login',
        message: `${user.full_name || user.username} logged in from ${ip || 'unknown location'}`,
        type: 'info',
        user_id: user.id
    });
}

module.exports = {
    notifySaleCreated,
    notifyStockAdjusted,
    notifyLowStock,
    notifyStockout,
    notifyExpiringSoon,
    notifyOverstock,
    notifyPOStatusChanged,
    notifyPOGenerated,
    notifyProductCreated,
    notifyUserLogin
};
