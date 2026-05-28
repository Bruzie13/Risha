const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/product/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT si.product_id, p.name, si.quantity, s.created_at as sale_date
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE si.product_id = ? AND s.payment_status = 'completed'
            ORDER BY s.created_at ASC
        `, [req.params.id]);

        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'No sales data' });
        }

        const dailyMap = {};
        rows.forEach(r => {
            const date = new Date(r.sale_date).toISOString().split('T')[0];
            dailyMap[date] = (dailyMap[date] || 0) + Number(r.quantity);
        });

        const daily = Object.entries(dailyMap).sort((a, b) => a[0].localeCompare(b[0]));
        const quantities = daily.map(d => d[1]);
        const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        const predictions = Array.from({ length: 30 }, () => Math.max(0, (avg + (Math.random() - 0.5) * avg * 0.3)));

        return res.json({
            success: true,
            data: {
                product_id: Number(req.params.id),
                product_name: rows[0].name,
                historical_data: daily.map(d => ({ date: d[0], quantity: d[1] })),
                predictions: predictions.map((v, i) => ({
                    date: new Date(Date.now() + (i + 1) * 86400000).toISOString().split('T')[0],
                    predicted_quantity: Math.round(v * 100) / 100,
                    day: i + 1
                })),
                next_month_prediction: Math.round(predictions.reduce((a, b) => a + b, 0) * 100) / 100,
                confidence_score: Math.min(85, Math.round(quantities.length / 30 * 100)),
                trend: predictions[predictions.length - 1] > predictions[0] ? 'up' : predictions[predictions.length - 1] < predictions[0] ? 'down' : 'stable'
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/all', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT si.product_id, p.name, si.quantity, s.created_at as sale_date
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            WHERE s.payment_status = 'completed'
            ORDER BY s.created_at ASC
        `);

        const byProduct = {};
        rows.forEach(r => {
            const pid = r.product_id;
            if (!byProduct[pid]) byProduct[pid] = { name: r.name, dates: {} };
            const date = new Date(r.sale_date).toISOString().split('T')[0];
            byProduct[pid].dates[date] = (byProduct[pid].dates[date] || 0) + Number(r.quantity);
        });

        const result = Object.entries(byProduct).map(([pid, data]) => {
            const qty = Object.values(data.dates);
            const avg = qty.reduce((a, b) => a + b, 0) / qty.length;
            return {
                product_id: Number(pid),
                product_name: data.name,
                next_month_prediction: Math.round(avg * 30 * 100) / 100,
                trend: 'stable',
                confidence_score: Math.min(85, Math.round(qty.length / 30 * 100))
            };
        });

        result.sort((a, b) => b.next_month_prediction - a.next_month_prediction);
        res.json({ success: true, data: { total_products: result.length, predictions: result } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/summary', async (req, res) => {
    try {
        const [products] = await pool.query(
            'SELECT id, name, stock_quantity, reorder_level FROM products WHERE is_active = TRUE'
        );
        const recommendations = products.filter(p => Number(p.stock_quantity) <= Number(p.reorder_level))
            .map(p => ({
                product_name: p.name,
                current_stock: Number(p.stock_quantity),
                reorder_level: Number(p.reorder_level),
                recommended_qty: Number(p.reorder_level) * 2 - Number(p.stock_quantity),
                priority: Number(p.stock_quantity) <= Number(p.reorder_level) / 2 ? 'High' : 'Medium'
            }));
        res.json({ success: true, data: { seasonal_trends: [], reorder_recommendations: recommendations.slice(0, 20) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/trends', async (req, res) => {
    res.json({ success: true, data: { product_id: req.query.product_id || null, seasonality: { monthly_patterns: [], day_of_week_patterns: [], seasonal_peaks: [] }, trend_summary: {} } });
});

module.exports = router;
