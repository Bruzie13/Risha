const Supplier = require('../models/Supplier');
const SupplierPerformance = require('../models/SupplierPerformance');
const PurchaseOrder = require('../models/PurchaseOrder');
const logAudit = require('../services/audit');
const pool = require('../config/database');

exports.getAllSuppliers = async (req, res) => {
    try {
        const suppliers = await Supplier.getAll();
        res.status(200).json({
            success: true,
            data: suppliers
        });
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving suppliers'
        });
    }
};

exports.getSupplierById = async (req, res) => {
    try {
        const { id } = req.params;
        const supplier = await Supplier.findById(id);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        res.status(200).json({
            success: true,
            data: supplier
        });
    } catch (error) {
        console.error('Get supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving supplier'
        });
    }
};

// Map pins are optional, but a stored pin has to be a real point on Earth —
// otherwise one bad value drags the whole map off to null island.
function normaliseCoords(body) {
    const out = {};
    for (const [key, range] of [['latitude', 90], ['longitude', 180]]) {
        if (body[key] === undefined) continue;
        if (body[key] === null || body[key] === '') { out[key] = null; continue; }
        const n = Number(body[key]);
        if (!Number.isFinite(n) || Math.abs(n) > range) {
            return { error: `${key} must be a number between -${range} and ${range}` };
        }
        out[key] = n;
    }
    // a pin needs both halves to mean anything
    if (out.latitude != null && out.longitude === null) return { error: 'longitude is required when latitude is set' };
    if (out.longitude != null && out.latitude === null) return { error: 'latitude is required when longitude is set' };
    return { value: out };
}

exports.createSupplier = async (req, res) => {
    try {
        const { name, contact_person, email, phone, address, city, payment_terms } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required'
            });
        }

        const coords = normaliseCoords(req.body);
        if (coords.error) {
            return res.status(400).json({ success: false, message: coords.error });
        }

        const supplier = await Supplier.create({
            name,
            contact_person,
            email,
            phone,
            address,
            city,
            payment_terms,
            ...coords.value
        });

        logAudit(req.user.id, 'create', 'suppliers', supplier.id, null, supplier, req.ip);

        res.status(201).json({
            success: true,
            message: 'Supplier created successfully',
            data: supplier
        });
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating supplier'
        });
    }
};

exports.updateSupplier = async (req, res) => {
    try {
        const { id } = req.params;

        const coords = normaliseCoords(req.body);
        if (coords.error) {
            return res.status(400).json({ success: false, message: coords.error });
        }
        const updateData = { ...req.body, ...coords.value };

        const oldSupplier = await Supplier.findById(id);
        const supplier = await Supplier.update(id, updateData);

        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found'
            });
        }

        logAudit(req.user.id, 'update', 'suppliers', parseInt(id), oldSupplier, updateData, req.ip);

        res.status(200).json({
            success: true,
            message: 'Supplier updated successfully',
            data: supplier
        });
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating supplier'
        });
    }
};

exports.deleteSupplier = async (req, res) => {
    try {
        const { id } = req.params;
        await Supplier.delete(id);

        logAudit(req.user.id, 'delete', 'suppliers', parseInt(id), null, null, req.ip);

        res.status(200).json({
            success: true,
            message: 'Supplier deleted successfully'
        });
    } catch (error) {
        console.error('Delete supplier error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting supplier'
        });
    }
};

exports.getSupplierPerformance = async (req, res) => {
    try {
        const { id } = req.params;
        const [records, rating] = await Promise.all([
            SupplierPerformance.getBySupplier(id),
            SupplierPerformance.getSupplierRating(id)
        ]);

        res.status(200).json({
            success: true,
            data: {
                records,
                rating
            }
        });
    } catch (error) {
        console.error('Get supplier performance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving supplier performance'
        });
    }
};

exports.recordDeliveryMetric = async (req, res) => {
    try {
        const { id } = req.params;
        const { order_id, delivery_date } = req.body;

        if (!order_id) {
            return res.status(400).json({
                success: false,
                message: 'order_id is required'
            });
        }

        const po = await PurchaseOrder.findById(order_id);
        if (!po) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }

        const actualDelivery = delivery_date ? new Date(delivery_date) : new Date();
        const expected = new Date(po.expected_delivery_date);
        const diffDays = Math.max(0, Math.ceil((actualDelivery - expected) / (1000 * 60 * 60 * 24)));
        const onTime = actualDelivery <= expected ? 1 : 0;

        await SupplierPerformance.addMetric(id, order_id, 'delivery_time', diffDays, `Delivered on ${actualDelivery.toISOString().split('T')[0]}`);
        await SupplierPerformance.addMetric(id, order_id, 'on_time_delivery', onTime, onTime ? 'On-time delivery' : `Late by ${diffDays} day(s)`);

        logAudit(req.user.id, 'create', 'supplier_performance', null, null, { supplier_id: id, order_id, on_time: !!onTime }, req.ip);

        res.status(201).json({
            success: true,
            message: onTime ? 'On-time delivery recorded' : `Late delivery recorded (${diffDays} day(s) late)`,
            data: { delivery_days: diffDays, on_time: !!onTime }
        });
    } catch (error) {
        console.error('Record delivery metric error:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording delivery metric'
        });
    }
};

/* ── Geocoding ────────────────────────────────────────────────────────────
   Turns a typed address into a first-guess map pin. We proxy OpenStreetMap's
   Nominatim from the server rather than the browser so we can identify
   ourselves properly and hold to their usage policy: one request per second,
   no bulk runs, and cache what we already asked for. The user always gets to
   drag the pin afterwards, so a rough answer is still useful.               */
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_UA = 'FETCH-RishaPetSupplies/1.0 (pet shop inventory system; +local deployment)';
const geocodeCache = new Map();
const GEOCODE_CACHE_MAX = 200;
let geocodeGate = Promise.resolve();
let lastGeocodeAt = 0;

// Serialise upstream calls and keep >=1.1s between them.
function throttledGeocode(task) {
    const run = geocodeGate.then(async () => {
        const wait = 1100 - (Date.now() - lastGeocodeAt);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastGeocodeAt = Date.now();
        return task();
    });
    // keep the chain alive even if this call blows up
    geocodeGate = run.then(() => {}, () => {});
    return run;
}

exports.geocodeAddress = async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 3) {
        return res.status(400).json({ success: false, message: 'Enter at least 3 characters to search for a location' });
    }

    const key = query.toLowerCase();
    if (geocodeCache.has(key)) {
        return res.status(200).json({ success: true, cached: true, data: geocodeCache.get(key) });
    }

    try {
        const url = `${GEOCODE_URL}?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
        const results = await throttledGeocode(async () => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            try {
                const upstream = await fetch(url, {
                    headers: { 'User-Agent': GEOCODE_UA, 'Accept': 'application/json' },
                    signal: ctrl.signal
                });
                if (!upstream.ok) throw new Error(`Nominatim responded ${upstream.status}`);
                return await upstream.json();
            } finally {
                clearTimeout(timer);
            }
        });

        const data = (Array.isArray(results) ? results : []).map(r => ({
            label: r.display_name,
            latitude: Number(r.lat),
            longitude: Number(r.lon),
            type: r.type || null
        })).filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));

        if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
            geocodeCache.delete(geocodeCache.keys().next().value);
        }
        geocodeCache.set(key, data);

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Geocode error:', error.message);
        res.status(502).json({
            success: false,
            message: error.name === 'AbortError'
                ? 'The map service took too long to answer. Drop the pin manually instead.'
                : 'Could not reach the map service. Drop the pin manually instead.'
        });
    }
};

/* ── Shop location ────────────────────────────────────────────────────────
   Where the shop itself sits, so the map can say how far each supplier is.
   Stored once in app_settings; readable by everyone, writable by admins.    */
exports.getShopLocation = async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('shop_lat', 'shop_lng', 'shop_label')"
        );
        const map = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
        const lat = map.shop_lat != null ? Number(map.shop_lat) : null;
        const lng = map.shop_lng != null ? Number(map.shop_lng) : null;
        res.status(200).json({
            success: true,
            data: Number.isFinite(lat) && Number.isFinite(lng)
                ? { latitude: lat, longitude: lng, label: map.shop_label || 'Risha Pet Supplies' }
                : null
        });
    } catch (error) {
        console.error('Get shop location error:', error);
        res.status(500).json({ success: false, message: 'Error reading the shop location' });
    }
};

exports.setShopLocation = async (req, res) => {
    try {
        const coords = normaliseCoords(req.body);
        if (coords.error) return res.status(400).json({ success: false, message: coords.error });
        const { latitude, longitude } = coords.value;
        if (latitude == null || longitude == null) {
            return res.status(400).json({ success: false, message: 'Both latitude and longitude are required' });
        }
        const label = String(req.body.label || 'Risha Pet Supplies').slice(0, 120);

        // pool.query auto-retries and is reserved for reads — take a
        // connection for the write.
        const rows = [['shop_lat', String(latitude)], ['shop_lng', String(longitude)], ['shop_label', label]];
        const conn = await pool.getConnection();
        try {
            for (const [k, v] of rows) {
                await conn.execute(
                    'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
                    [k, v]
                );
            }
        } finally {
            conn.release();
        }

        logAudit(req.user.id, 'update', 'app_settings', null, null, { shop_lat: latitude, shop_lng: longitude }, req.ip);

        res.status(200).json({ success: true, message: 'Shop location saved', data: { latitude, longitude, label } });
    } catch (error) {
        console.error('Set shop location error:', error);
        res.status(500).json({ success: false, message: 'Error saving the shop location' });
    }
};
