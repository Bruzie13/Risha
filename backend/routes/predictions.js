const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function linearRegression(yValues) {
    const n = yValues.length;
    if (n < 2) return { slope: 0, intercept: yValues[0] || 0, r2: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += yValues[i];
        sumXY += i * yValues[i];
        sumX2 += i * i;
        sumY2 += yValues[i] * yValues[i];
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        const predicted = slope * i + intercept;
        ssRes += (yValues[i] - predicted) ** 2;
        ssTot += (yValues[i] - meanY) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2 };
}

function weightedMovingAverage(values, windowSize) {
    if (values.length === 0) return 0;
    const window = values.slice(-windowSize);
    let totalWeight = 0, weightedSum = 0;
    for (let i = 0; i < window.length; i++) {
        const weight = i + 1;
        weightedSum += window[i] * weight;
        totalWeight += weight;
    }
    return weightedSum / totalWeight;
}

function computeConfidence(dataPoints, r2) {
    const dataScore = Math.min(1, dataPoints / 30) * 40;
    const modelScore = r2 * 40;
    const stabilityScore = dataPoints >= 14 ? 20 : (dataPoints / 14) * 20;
    return Math.round(Math.min(95, dataScore + modelScore + stabilityScore));
}

router.get('/product/:id', authenticateToken, async (req, res) => {
    try {
        const stock = parseInt(req.query.stock) || 0;
        const reorderLevel = parseInt(req.query.reorder_level) || 10;
        const leadTime = parseInt(req.query.lead_time) || 7;

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

        const reg = linearRegression(quantities);
        const predictions = [];
        for (let i = 1; i <= 30; i++) {
            const trendVal = reg.slope * (quantities.length + i) + reg.intercept;
            const wma = weightedMovingAverage(quantities, Math.min(7, quantities.length));
            const combined = quantities.length >= 7
                ? trendVal * 0.6 + wma * 0.4
                : trendVal * 0.4 + wma * 0.6;
            predictions.push(Math.max(0, Math.round(combined * 100) / 100));
        }

        const nextMonthTotal = Math.round(predictions.reduce((a, b) => a + b, 0) * 100) / 100;
        const dailyAvg = predictions.reduce((a, b) => a + b, 0) / 30;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;
        const recommendedReorder = Math.ceil(dailyAvg * leadTime * 1.2);
        const confidence = computeConfidence(quantities.length, reg.r2);

        const trendSlope = reg.slope;
        const trend = trendSlope > avg * 0.02 ? 'up' : trendSlope < -avg * 0.02 ? 'down' : 'stable';

        const last7 = quantities.slice(-7);
        const prev7 = quantities.slice(-14, -7);
        const recentAvg = last7.reduce((a, b) => a + b, 0) / (last7.length || 1);
        const prevAvg = prev7.length ? prev7.reduce((a, b) => a + b, 0) / prev7.length : recentAvg;
        const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100).toFixed(1) : '0.0';

        return res.json({
            success: true,
            data: {
                product_id: Number(req.params.id),
                product_name: rows[0].name,
                historical_data: daily.map(d => ({ date: d[0], quantity: d[1] })),
                predictions: predictions.map((v, i) => ({
                    date: new Date(Date.now() + (i + 1) * 86400000).toISOString().split('T')[0],
                    predicted_quantity: v,
                    day: i + 1
                })),
                next_month_prediction: nextMonthTotal,
                daily_average: Math.round(dailyAvg * 100) / 100,
                confidence_score: confidence,
                trend: trend,
                trend_momentum: `${momentum}%`,
                days_until_stockout: daysUntilStockout,
                reorder_recommendation: {
                    recommended_reorder_point: reorderLevel,
                    recommended_order_quantity: recommendedReorder,
                    lead_time_days: leadTime
                }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/all', authenticateToken, async (req, res) => {
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
            if (!byProduct[pid]) byProduct[pid] = { name: r.name, dates: {}, quantities: [] };
            const date = new Date(r.sale_date).toISOString().split('T')[0];
            byProduct[pid].dates[date] = (byProduct[pid].dates[date] || 0) + Number(r.quantity);
            byProduct[pid].quantities.push(Number(r.quantity));
        });

        const result = Object.entries(byProduct).map(([pid, data]) => {
            const qty = Object.values(data.dates);
            const avg = qty.reduce((a, b) => a + b, 0) / qty.length;
            const reg = linearRegression(qty);
            const nextMonthPrediction = Math.round(avg * 30 * 100) / 100;
            const trendSlope = reg.slope;
            const trend = trendSlope > avg * 0.02 ? 'up' : trendSlope < -avg * 0.02 ? 'down' : 'stable';
            const confidence = computeConfidence(qty.length, reg.r2);

            return {
                product_id: Number(pid),
                product_name: data.name,
                next_month_prediction: nextMonthPrediction,
                daily_average: Math.round(avg * 100) / 100,
                trend: trend,
                confidence_score: confidence
            };
        });

        result.sort((a, b) => b.next_month_prediction - a.next_month_prediction);
        res.json({ success: true, data: { total_products: result.length, predictions: result } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/summary', authenticateToken, async (req, res) => {
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

        const [monthlyData] = await pool.query(`
            SELECT MONTH(s.created_at) as month,
                   SUM(si.quantity) as total_qty,
                   COUNT(DISTINCT DATE(s.created_at)) as active_days
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY MONTH(s.created_at)
            ORDER BY month
        `);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const seasonal_trends = monthlyData.map(m => ({
            month: monthNames[m.month - 1] || `Month ${m.month}`,
            month_number: m.month,
            avg_quantity: m.active_days > 0 ? Math.round((m.total_qty / m.active_days) * 100) / 100 : 0,
            total_sales: Number(m.total_qty)
        }));

        res.json({ success: true, data: { seasonal_trends, reorder_recommendations: recommendations.slice(0, 20) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/trends', authenticateToken, async (req, res) => {
    try {
        const [monthlyData] = await pool.query(`
            SELECT MONTH(s.created_at) as month,
                   SUM(si.quantity) as total_qty,
                   COUNT(DISTINCT DATE(s.created_at)) as active_days
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY MONTH(s.created_at)
            ORDER BY month
        `);

        const [dowData] = await pool.query(`
            SELECT DAYOFWEEK(s.created_at) as day_of_week,
                   SUM(si.quantity) as total_qty,
                   COUNT(DISTINCT DATE(s.created_at)) as active_days
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.payment_status = 'completed'
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DAYOFWEEK(s.created_at)
            ORDER BY day_of_week
        `);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        const monthly_patterns = monthlyData.map(m => ({
            month: monthNames[m.month - 1] || `Month ${m.month}`,
            avg_daily_sales: m.active_days > 0 ? Math.round((m.total_qty / m.active_days) * 100) / 100 : 0,
            total_sales: Number(m.total_qty)
        }));

        const day_of_week_patterns = dowData.map(d => ({
            day: dowNames[d.day_of_week - 1] || `Day ${d.day_of_week}`,
            avg_daily_sales: d.active_days > 0 ? Math.round((d.total_qty / d.active_days) * 100) / 100 : 0,
            total_sales: Number(d.total_qty)
        }));

        const allMonthlyAvg = monthly_patterns.map(m => m.avg_daily_sales);
        const peakMonth = monthly_patterns.reduce((a, b) => a.avg_daily_sales > b.avg_daily_sales ? a : b, { avg_daily_sales: 0 });
        const lowMonth = monthly_patterns.reduce((a, b) => a.avg_daily_sales < b.avg_daily_sales ? a : b, { avg_daily_sales: Infinity });

        const seasonal_peaks = [];
        if (peakMonth.avg_daily_sales > 0) seasonal_peaks.push({ type: 'peak', month: peakMonth.month, avg_sales: peakMonth.avg_daily_sales });
        if (lowMonth.avg_daily_sales < Infinity && lowMonth.avg_daily_sales >= 0) seasonal_peaks.push({ type: 'low', month: lowMonth.month, avg_sales: lowMonth.avg_daily_sales });

        const avgSales = allMonthlyAvg.reduce((a, b) => a + b, 0) / (allMonthlyAvg.length || 1);
        const trend_summary = {
            average_monthly_sales: Math.round(avgSales * 100) / 100,
            peak_month: peakMonth.month || 'N/A',
            low_month: lowMonth.month || 'N/A',
            seasonal_variance: peakMonth.avg_daily_sales > 0 && lowMonth.avg_daily_sales < Infinity
                ? Math.round(((peakMonth.avg_daily_sales - lowMonth.avg_daily_sales) / avgSales) * 100)
                : 0
        };

        res.json({
            success: true,
            data: { product_id: req.query.product_id || null, seasonality: { monthly_patterns, day_of_week_patterns, seasonal_peaks }, trend_summary }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
