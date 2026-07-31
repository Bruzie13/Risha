const crypto = require('crypto');
const pool = require('../config/database');

/* Live delivery tracking.

   A tracking row is a *permission slip*: the shop issues a link, the supplier's
   driver decides whether to open it and share their position. Nothing here can
   pull a location on its own — every point in delivery_positions was pushed by
   a device whose owner tapped "Allow". Links expire on their own and can be
   revoked at any time from either end. */
class DeliveryTracking {
    // 3 days is longer than any delivery here but short enough that a
    // forgotten link stops working on its own.
    static DEFAULT_TTL_HOURS = 72;

    static async createForPO(poId, userId, ttlHours = DeliveryTracking.DEFAULT_TTL_HOURS) {
        const connection = await pool.getConnection();
        try {
            // Only one live link per order — issuing a new one retires the old.
            await connection.execute(
                'UPDATE delivery_tracking SET revoked = 1 WHERE po_id = ? AND revoked = 0',
                [poId]
            );
            const token = crypto.randomBytes(24).toString('base64url');
            const [result] = await connection.execute(
                `INSERT INTO delivery_tracking (po_id, token, created_by, expires_at)
                 VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
                [poId, token, userId || null, ttlHours]
            );
            return { id: result.insertId, token, po_id: poId };
        } finally {
            connection.release();
        }
    }

    static async revokeForPO(poId) {
        const connection = await pool.getConnection();
        try {
            const [r] = await connection.execute(
                'UPDATE delivery_tracking SET revoked = 1 WHERE po_id = ? AND revoked = 0',
                [poId]
            );
            return r.affectedRows;
        } finally {
            connection.release();
        }
    }

    // Resolve a token from the public driver page. Returns null for anything
    // unknown, revoked or expired — the page can't tell those apart, on purpose.
    static async findLiveByToken(token) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT dt.id, dt.po_id, dt.expires_at, dt.first_shared_at,
                        po.po_number, po.status, po.expected_delivery_date,
                        s.name AS supplier_name
                 FROM delivery_tracking dt
                 JOIN purchase_orders po ON po.id = dt.po_id
                 LEFT JOIN suppliers s ON s.id = po.supplier_id
                 WHERE dt.token = ? AND dt.revoked = 0 AND dt.expires_at > NOW()`,
                [token]
            );
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    static async addPosition(trackingId, lat, lng, accuracy) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(
                `INSERT INTO delivery_positions (tracking_id, latitude, longitude, accuracy_m)
                 VALUES (?, ?, ?, ?)`,
                [trackingId, lat, lng, accuracy == null ? null : Math.round(accuracy)]
            );
            await connection.execute(
                `UPDATE delivery_tracking
                 SET last_seen_at = NOW(), first_shared_at = COALESCE(first_shared_at, NOW())
                 WHERE id = ?`,
                [trackingId]
            );
            await connection.commit();
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    }

    // What the shop sees: the active link for an order, its latest fix, and a
    // short trail to draw the route travelled.
    static async getStatusForPO(poId, trailLimit = 60) {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT id, token, expires_at, revoked, first_shared_at, last_seen_at,
                        (expires_at <= NOW()) AS expired
                 FROM delivery_tracking
                 WHERE po_id = ?
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [poId]
            );
            if (!rows.length) return null;
            const tracking = rows[0];

            const [points] = await connection.execute(
                `SELECT latitude, longitude, accuracy_m,
                        UNIX_TIMESTAMP(recorded_at) * 1000 AS recorded_at
                 FROM delivery_positions
                 WHERE tracking_id = ?
                 ORDER BY recorded_at DESC
                 LIMIT ${Number(trailLimit) || 60}`,
                [tracking.id]
            );

            return {
                token: tracking.token,
                revoked: !!tracking.revoked,
                expired: !!Number(tracking.expired),
                expires_at: tracking.expires_at,
                first_shared_at: tracking.first_shared_at,
                last_seen_at: tracking.last_seen_at,
                // oldest → newest, so the map can draw it as a path
                trail: points.reverse().map(p => ({
                    latitude: Number(p.latitude),
                    longitude: Number(p.longitude),
                    accuracy_m: p.accuracy_m,
                    recorded_at: p.recorded_at
                }))
            };
        } finally {
            connection.release();
        }
    }

    // Every in-flight order in one query, for the deliveries board.
    static async getActiveDeliveries() {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_delivery_date,
                        po.total_amount,
                        UNIX_TIMESTAMP(po.created_at) * 1000 AS created_at,
                        UNIX_TIMESTAMP(po.confirmed_at) * 1000 AS confirmed_at,
                        UNIX_TIMESTAMP(po.shipped_at) * 1000 AS shipped_at,
                        UNIX_TIMESTAMP(po.received_at) * 1000 AS received_at,
                        s.id AS supplier_id, s.name AS supplier_name,
                        -- An order can outlive its supplier being switched off.
                        -- The board still has to show it (it is money owed and
                        -- goods expected), but staff need to know why they
                        -- cannot find that supplier in the list.
                        s.is_active AS supplier_active,
                        s.phone AS supplier_phone, s.email AS supplier_email,
                        s.latitude AS supplier_lat, s.longitude AS supplier_lng,
                        (SELECT COUNT(*) FROM po_items pi WHERE pi.po_id = po.id) AS item_count,
                        dt.id AS tracking_id, dt.revoked AS tracking_revoked,
                        (dt.expires_at <= NOW()) AS tracking_expired,
                        UNIX_TIMESTAMP(dt.last_seen_at) * 1000 AS last_seen_at,
                        dp.latitude AS live_lat, dp.longitude AS live_lng,
                        UNIX_TIMESTAMP(dp.recorded_at) * 1000 AS live_at
                 FROM purchase_orders po
                 LEFT JOIN suppliers s ON s.id = po.supplier_id
                 LEFT JOIN delivery_tracking dt
                        ON dt.id = (SELECT id FROM delivery_tracking d
                                    WHERE d.po_id = po.id ORDER BY d.created_at DESC LIMIT 1)
                 LEFT JOIN delivery_positions dp
                        ON dp.id = (SELECT id FROM delivery_positions p
                                    WHERE p.tracking_id = dt.id ORDER BY p.recorded_at DESC LIMIT 1)
                 WHERE po.status IN ('pending', 'confirmed', 'shipped')
                 ORDER BY FIELD(po.status, 'shipped', 'confirmed', 'pending'), po.expected_delivery_date IS NULL, po.expected_delivery_date`
            );
            return rows;
        } finally {
            connection.release();
        }
    }
}

module.exports = DeliveryTracking;
