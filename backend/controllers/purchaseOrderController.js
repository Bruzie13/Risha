const pool = require('../config/database');
const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const Notification = require('../models/Notification');
const { sendPOEmail, sendTrackingLinkEmail } = require('../utils/mailer');
const logAudit = require('../services/audit');
const { notifyPOStatusChanged, notifyPOGenerated } = require('../services/notifier');

exports.getAllPOs = async (req, res) => {
    try {
        const { status } = req.query;
        const filters = {};
        if (status) filters.status = status;
        const orders = await PurchaseOrder.getAll(filters);
        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Get purchase orders error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving purchase orders'
        });
    }
};

exports.getPOById = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await PurchaseOrder.findById(id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        const items = await PurchaseOrder.getPOItems(id);
        res.status(200).json({
            success: true,
            data: { ...order, items }
        });
    } catch (error) {
        console.error('Get purchase order error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving purchase order'
        });
    }
};

exports.createPO = async (req, res) => {
    try {
        const { supplier_id, items, notes, expected_date } = req.body;
        const created_by = req.user.id;

        if (!supplier_id || !items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Supplier and at least one item are required'
            });
        }

        let total_amount = 0;
        for (const item of items) {
            total_amount += item.total_price || (item.unit_cost * item.quantity);
        }

        const orderData = {
            supplier_id,
            total_amount,
            notes: notes || null,
            expected_date: expected_date || null,
            created_by,
            items
        };

        const order = await PurchaseOrder.create(orderData);
        const supplier = await Supplier.findById(order.supplier_id);
        logAudit(req.user.id, 'create', 'purchase_orders', order.id, null, {
            po_number: order.po_number,
            supplier_name: supplier ? supplier.name : 'Unknown',
            total_amount: order.total_amount,
            items_count: orderData.items.length,
            status: order.status
        }, req.ip);

        notifyPOGenerated(order, req.user.id).catch(e => console.error('Notif error:', e.message));

        res.status(201).json({
            success: true,
            message: 'Purchase order created successfully',
            data: order
        });
    } catch (error) {
        console.error('Create purchase order error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating purchase order'
        });
    }
};

exports.updatePOStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'confirmed', 'shipped', 'received', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Valid status is required: ' + validStatuses.join(', ')
            });
        }

        const order = await PurchaseOrder.findById(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        const allowedTransitions = {
            pending: ['confirmed', 'cancelled'],
            confirmed: ['shipped', 'cancelled'],
            shipped: ['received'],
            received: [],
            cancelled: []
        };
        if (!allowedTransitions[order.status] || !allowedTransitions[order.status].includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot change status from "${order.status}" to "${status}". Allowed: ${allowedTransitions[order.status]?.join(', ') || 'none'}`
            });
        }

        const updatedOrder = await PurchaseOrder.updateStatus(id, status, { expiration_date: req.body.expiration_date });
        const supp = await Supplier.findById(order.supplier_id);
        logAudit(req.user.id, 'update', 'purchase_orders', parseInt(id),
            { po_number: order.po_number, supplier_name: supp ? supp.name : 'Unknown', status: order.status },
            { po_number: order.po_number, supplier_name: supp ? supp.name : 'Unknown', status },
            req.ip);

        notifyPOStatusChanged(order, order.status, status, req.user.id).catch(e => console.error('Notif error:', e.message));

        res.status(200).json({
            success: true,
            message: `Purchase order status updated to ${status}`,
            data: updatedOrder
        });
    } catch (error) {
        console.error('Update PO status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating purchase order status'
        });
    }
};

exports.deletePO = async (req, res) => {
    try {
        const { id } = req.params;
        await PurchaseOrder.delete(id);

        logAudit(req.user.id, 'delete', 'purchase_orders', parseInt(id), null, null, req.ip);

        res.status(200).json({
            success: true,
            message: 'Purchase order deleted successfully'
        });
    } catch (error) {
        console.error('Delete purchase order error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting purchase order'
        });
    }
};

exports.autoGeneratePO = async (req, res) => {
    try {
        const { product_ids } = req.body;
        let lowStockProducts = await Product.getLowStock();

        if (Array.isArray(product_ids) && product_ids.length > 0) {
            const idSet = new Set(product_ids.map(Number));
            lowStockProducts = lowStockProducts.filter(p => idSet.has(p.id));
            if (lowStockProducts.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: 'None of the selected products are below reorder level',
                    data: null,
                    count: 0,
                    warnings: []
                });
            }
        }

        const warnings = [];

        // Expired products can still be reordered — the new batch replaces the
        // expired one. Expired units are unusable, so size the order as if
        // on-hand stock were zero, and remind staff to pull the old batch.
        const now = new Date();
        for (const p of lowStockProducts) {
            if (p.expiration_date && new Date(p.expiration_date) <= now) {
                warnings.push(`"${p.name}" is expired — ordering a fresh batch; remove the expired units from shelves`);
                p.stock_quantity = 0;
            }
        }

        if (!lowStockProducts || lowStockProducts.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No products below reorder level',
                data: null,
                count: 0,
                warnings
            });
        }

        const conn = await pool.getConnection();
        const [salesVelocity] = await conn.execute(
            `SELECT si.product_id, SUM(si.quantity) as units_sold
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY si.product_id`
        );
        conn.release();
        const velocityMap = {};
        for (const v of salesVelocity) velocityMap[v.product_id] = v.units_sold;
        const hasSalesData = salesVelocity.length > 0;

        const supplierGroups = {};
        for (const product of lowStockProducts) {
            if (!product.supplier_id) {
                warnings.push(`"${product.name}" skipped: no supplier assigned`);
                continue;
            }

            let reorderQuantity;
            const unitsSold30d = velocityMap[product.id] || 0;
            const dailyAvg = unitsSold30d / 30;
            if (!hasSalesData || dailyAvg < 0.5) {
                if (hasSalesData && dailyAvg < 0.5) {
                    warnings.push(`"${product.name}" has low sales velocity (${dailyAvg.toFixed(2)} units/day), ordering minimum quantity`);
                }
                reorderQuantity = Math.max(product.reorder_level * 2 - product.stock_quantity, product.reorder_level);
            } else if (dailyAvg < 2) {
                reorderQuantity = Math.max(product.reorder_level - product.stock_quantity, product.reorder_level);
            } else {
                const target = product.max_stock_level || product.reorder_level * 3;
                reorderQuantity = Math.min(target - product.stock_quantity, target);
                reorderQuantity = Math.max(reorderQuantity, product.reorder_level);
            }

            if (!supplierGroups[product.supplier_id]) {
                supplierGroups[product.supplier_id] = [];
            }
            supplierGroups[product.supplier_id].push({
                product_id: product.id,
                // product_name/sku are ignored by the po_items insert but are
                // what the supplier's email lists — without them every line
                // reads "Product".
                product_name: product.name,
                sku: product.sku,
                quantity: reorderQuantity,
                unit_price: product.cost_price || product.unit_price || 0,
                total_price: (product.cost_price || product.unit_price || 0) * reorderQuantity
            });
        }

        const createdOrders = [];
        const emailResults = [];
        for (const [supplierId, items] of Object.entries(supplierGroups)) {
            const total_amount = items.reduce((sum, item) => sum + item.total_price, 0);
            const orderData = {
                supplier_id: parseInt(supplierId),
                total_amount,
                notes: 'Auto-generated purchase order for low stock products',
                created_by: req.user.id,
                items
            };
            const order = await PurchaseOrder.create(orderData);
            createdOrders.push(order);
            const supplier = await Supplier.findById(parseInt(supplierId));
            logAudit(req.user.id, 'create', 'purchase_orders', order.id, null, {
                po_number: order.po_number,
                supplier_name: supplier ? supplier.name : 'Unknown',
                total_amount: order.total_amount,
                items_count: items.length,
                status: order.status
            }, req.ip);

            // Send each order to the supplier it belongs to. A failure here is
            // reported per order rather than thrown — one supplier missing an
            // email address must not lose the other orders that did go out.
            const emailResult = { po_number: order.po_number, supplier_name: supplier ? supplier.name : 'Unknown' };
            if (!supplier || !supplier.email) {
                emailResult.sent = false;
                emailResult.reason = 'no email address on file';
                warnings.push(`${order.po_number} for ${emailResult.supplier_name} was created but not emailed — no email address on file`);
            } else {
                try {
                    const ok = await sendPOEmail(
                        supplier.id, supplier.email, supplier.name,
                        order.po_number, items, order.total_amount
                    );
                    emailResult.sent = !!ok;
                    emailResult.email = supplier.email;
                    if (!ok) {
                        emailResult.reason = 'the mail server rejected it';
                        warnings.push(`${order.po_number} for ${supplier.name} was created but the email did not send — resend it from the supplier's Performance panel`);
                    }
                } catch (e) {
                    emailResult.sent = false;
                    emailResult.reason = e.message;
                    warnings.push(`${order.po_number} for ${supplier.name} was created but the email failed — resend it from the supplier's Performance panel`);
                }
            }
            emailResults.push(emailResult);
        }

        if (createdOrders.length > 0) {
            await Notification.create({
                title: 'Auto-Reorder Generated',
                message: `Auto-generated ${createdOrders.length} purchase order(s) for low-stock products`,
                type: 'reorder'
            });
        }

        const sentCount = emailResults.filter(e => e.sent).length;
        const failedCount = emailResults.length - sentCount;

        let message;
        if (createdOrders.length === 0) {
            message = 'No purchase orders generated. Check warnings for details.';
        } else if (failedCount === 0) {
            message = `Created ${createdOrders.length} purchase order(s) and emailed ${sentCount === 1 ? 'the supplier' : `all ${sentCount} suppliers`}.`;
        } else if (sentCount === 0) {
            message = `Created ${createdOrders.length} purchase order(s), but none could be emailed. Send them from the supplier's Performance panel.`;
        } else {
            message = `Created ${createdOrders.length} purchase order(s). ${sentCount} emailed, ${failedCount} could not be sent — see the details below.`;
        }

        res.status(201).json({
            success: true,
            message,
            data: createdOrders,
            count: createdOrders.length,
            emails: emailResults,
            emailed: sentCount,
            email_failed: failedCount,
            warnings
        });
    } catch (error) {
        console.error('Auto-generate PO error:', error);
        res.status(500).json({
            success: false,
            message: 'Error auto-generating purchase orders'
        });
    }
};

// Manually (re)send an existing purchase order to its supplier. Reorders email
// on creation, so this is for resending — after a bounce, or once a supplier
// who had no address on file has one.
exports.emailPO = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await PurchaseOrder.findById(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Purchase order not found' });
        }
        const supplier = await Supplier.findById(order.supplier_id);
        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found for this order' });
        }
        if (!supplier.email) {
            return res.status(400).json({ success: false, message: 'This supplier has no email address on file' });
        }
        const poItems = await PurchaseOrder.getPOItems(order.id);
        const sent = await sendPOEmail(
            supplier.id,
            supplier.email,
            supplier.name,
            order.po_number,
            poItems.map(i => ({
                product_name: i.product_name,
                quantity: i.quantity,
                unit_price: i.unit_price,
                total_price: i.subtotal
            })),
            order.total_amount
        );
        if (!sent) {
            return res.status(502).json({ success: false, message: 'The email could not be sent. Please try again.' });
        }
        logAudit(req.user.id, 'email', 'purchase_orders', order.id, null, {
            po_number: order.po_number,
            supplier_name: supplier.name,
            email: supplier.email
        }, req.ip);
        res.json({ success: true, message: `Purchase order ${order.po_number} emailed to ${supplier.name}` });
    } catch (error) {
        console.error('Send PO email error:', error);
        res.status(500).json({ success: false, message: 'Error sending purchase order email' });
    }
};

/* ── Live delivery tracking ───────────────────────────────────────────────
   The shop issues a link; the supplier's driver decides whether to open it
   and share their position. Nothing here can read a location on its own.   */
const DeliveryTracking = require('../models/DeliveryTracking');

// The whole deliveries board: every order not yet received or cancelled.
exports.getActiveDeliveries = async (req, res) => {
    try {
        const rows = await DeliveryTracking.getActiveDeliveries();
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('Get active deliveries error:', error);
        res.status(500).json({ success: false, message: 'Error loading deliveries' });
    }
};

exports.createTrackingLink = async (req, res) => {
    try {
        const { id } = req.params;
        const po = await PurchaseOrder.findById(id);
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        if (po.status === 'received' || po.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `This order is already ${po.status} — there is nothing left to track.`
            });
        }

        const hours = Math.min(Math.max(parseInt(req.body.hours, 10) || DeliveryTracking.DEFAULT_TTL_HOURS, 1), 168);
        const link = await DeliveryTracking.createForPO(id, req.user.id, hours);

        logAudit(req.user.id, 'create', 'delivery_tracking', link.id, null, { po_id: Number(id), hours }, req.ip);

        // BASE_URL is the deployment's public address (already set on Render and
        // used for email tracking links). Falling back to the request host would
        // hand out a localhost URL nobody else can open.
        const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        res.status(201).json({
            success: true,
            message: 'Tracking link created',
            data: {
                url: `${base}/track/delivery/${link.token}`,
                expires_in_hours: hours,
                po_number: po.po_number
            }
        });
    } catch (error) {
        console.error('Create tracking link error:', error);
        res.status(500).json({ success: false, message: 'Error creating the tracking link' });
    }
};

/* Create a link (or reuse the live one) and email it to the supplier.

   A link nobody receives is useless, so this is the path that matters: one
   click issues it, mails it, and logs it alongside every other supplier
   email with the same read tracking. */
exports.emailTrackingLink = async (req, res) => {
    try {
        const { id } = req.params;
        const po = await PurchaseOrder.findById(id);
        if (!po) return res.status(404).json({ success: false, message: 'Purchase order not found' });
        if (po.status === 'received' || po.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `This order is already ${po.status} — there is nothing left to track.`
            });
        }

        const supplier = await Supplier.findById(po.supplier_id);
        if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
        if (!supplier.email) {
            return res.status(400).json({
                success: false,
                message: `${supplier.name} has no email address saved. Add one on the Suppliers page first.`
            });
        }

        // Reuse a link that is still good rather than invalidating one the
        // driver may already have open.
        let existing = await DeliveryTracking.getStatusForPO(id);
        let token, expiresAt;
        if (existing && !existing.revoked && !existing.expired) {
            token = existing.token;
            expiresAt = existing.expires_at;
        } else {
            const hours = Math.min(Math.max(parseInt(req.body.hours, 10) || DeliveryTracking.DEFAULT_TTL_HOURS, 1), 168);
            const link = await DeliveryTracking.createForPO(id, req.user.id, hours);
            token = link.token;
            expiresAt = new Date(Date.now() + hours * 3600000);
            logAudit(req.user.id, 'create', 'delivery_tracking', link.id, null, { po_id: Number(id), hours }, req.ip);
        }

        const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const url = `${base}/track/delivery/${token}`;

        const sent = await sendTrackingLinkEmail(
            supplier.id, supplier.email, supplier.name, po.po_number, url, expiresAt
        );

        if (!sent) {
            return res.status(502).json({
                success: false,
                message: `The link was created but the email to ${supplier.email} did not go out. Check Settings → Email, then use Copy link to send it yourself.`,
                data: { url }
            });
        }

        res.status(200).json({
            success: true,
            message: `Tracking link emailed to ${supplier.name} at ${supplier.email}.`,
            data: { url, emailed_to: supplier.email }
        });
    } catch (error) {
        console.error('Email tracking link error:', error);
        res.status(500).json({ success: false, message: 'Error emailing the tracking link' });
    }
};

exports.revokeTrackingLink = async (req, res) => {
    try {
        const { id } = req.params;
        const count = await DeliveryTracking.revokeForPO(id);
        logAudit(req.user.id, 'update', 'delivery_tracking', null, null, { po_id: Number(id), revoked: count }, req.ip);
        res.status(200).json({
            success: true,
            message: count ? 'Tracking link switched off' : 'There was no active link to switch off'
        });
    } catch (error) {
        console.error('Revoke tracking link error:', error);
        res.status(500).json({ success: false, message: 'Error switching off the tracking link' });
    }
};

exports.getTracking = async (req, res) => {
    try {
        const status = await DeliveryTracking.getStatusForPO(req.params.id);
        res.status(200).json({ success: true, data: status });
    } catch (error) {
        console.error('Get tracking error:', error);
        res.status(500).json({ success: false, message: 'Error loading tracking data' });
    }
};

/* ── Road routing ─────────────────────────────────────────────────────────
   A straight line between a driver and the shop is not how anyone actually
   travels, and dividing it by GPS speed is not an arrival time. OSRM gives
   the real road geometry and a driving duration.

   Public demo server, so: short timeout, cache by rounded coordinates (a van
   moving a few metres does not need a fresh route), and if it is slow or
   down the caller falls back to the straight-line estimate rather than
   showing nothing. */
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const routeCache = new Map();
const ROUTE_CACHE_MAX = 120;
const ROUTE_TTL_MS = 60000;

exports.getRoute = async (req, res) => {
    const parse = v => {
        const parts = String(v || '').split(',').map(Number);
        return parts.length === 2 && parts.every(Number.isFinite) ? parts : null;
    };
    const from = parse(req.query.from);
    const to = parse(req.query.to);
    if (!from || !to) {
        return res.status(400).json({ success: false, message: 'from and to must be "lat,lng"' });
    }

    // ~3 decimal places is roughly 100m — fine granularity for a road route,
    // and it stops every GPS twitch becoming an upstream request.
    const key = [from[0].toFixed(3), from[1].toFixed(3), to[0].toFixed(3), to[1].toFixed(3)].join(',');
    const hit = routeCache.get(key);
    if (hit && Date.now() - hit.at < ROUTE_TTL_MS) {
        return res.status(200).json({ success: true, cached: true, data: hit.data });
    }

    try {
        const url = `${OSRM_URL}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        let json;
        try {
            const upstream = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
            if (!upstream.ok) throw new Error(`OSRM responded ${upstream.status}`);
            json = await upstream.json();
        } finally {
            clearTimeout(timer);
        }

        const route = json && Array.isArray(json.routes) ? json.routes[0] : null;
        if (!route) {
            return res.status(200).json({ success: false, message: 'No road route found between these points' });
        }

        /* Sanity-check the answer before trusting it.

           OSRM snaps each input to the nearest routable road with no distance
           limit. Away from mapped roads — which includes the shop's own area —
           both ends can snap to the *same* faraway node, and it cheerfully
           returns a 0 m / 0 s route. Believing that put "Arriving now" on
           screen while the driver was still a kilometre out.

           Two guards: reject when either end was dragged unreasonably far, and
           reject when the road distance is shorter than the straight line,
           which is geometrically impossible. Either way the caller falls back
           to the straight-line estimate, which is rough but never a lie. */
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const dLat = toRad(to[0] - from[0]);
        const dLng = toRad(to[1] - from[1]);
        const h = Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(from[0])) * Math.cos(toRad(to[0])) * Math.sin(dLng / 2) ** 2;
        const straightM = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

        const MAX_SNAP_M = 1500;
        const snapped = (json.waypoints || []).map(w => Number(w.distance) || 0);
        const worstSnap = snapped.length ? Math.max.apply(null, snapped) : 0;

        if (worstSnap > MAX_SNAP_M) {
            return res.status(200).json({
                success: false,
                message: `Nearest road is ${Math.round(worstSnap)} m from one of these points — a road route would not describe this journey`
            });
        }
        // 0.75 leaves room for the curvature/rounding slop, nothing more.
        if (straightM > 200 && route.distance < straightM * 0.75) {
            return res.status(200).json({
                success: false,
                message: 'Routing returned an impossible distance for these points'
            });
        }

        const data = {
            // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]
            geometry: (route.geometry.coordinates || []).map(c => [c[1], c[0]]),
            distance_m: Math.round(route.distance),
            duration_s: Math.round(route.duration)
        };

        if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
        routeCache.set(key, { at: Date.now(), data });

        res.status(200).json({ success: true, data });
    } catch (error) {
        // Never fatal — the live view degrades to its straight-line estimate.
        res.status(200).json({ success: false, message: 'Routing service unavailable' });
    }
};
