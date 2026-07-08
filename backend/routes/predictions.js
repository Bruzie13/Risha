const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const HISTORY_WINDOW_DAYS = 90; // analyze up to the last 90 calendar days
const FORECAST_DAYS = 30;
const DAY_MS = 86400000;

// ---------- Statistical helpers ----------

function linearRegression(yValues) {
    const n = yValues.length;
    if (n < 2) return { slope: 0, intercept: yValues[0] || 0, r2: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += yValues[i];
        sumXY += i * yValues[i];
        sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
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

// Holt's double exponential smoothing (level + trend).
// Robust for short, noisy retail series; reacts to recent shifts
// without overreacting to single-day spikes.
function holtSmoothing(values, alpha = 0.35, beta = 0.15) {
    if (!values.length) return { level: 0, trend: 0 };
    let level = values[0];
    let trend = values.length > 1 ? values[1] - values[0] : 0;
    for (let i = 1; i < values.length; i++) {
        const prevLevel = level;
        level = alpha * values[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
    return { level, trend };
}

function stdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

// Confidence blends data volume, model fit and demand stability
// (coefficient of variation). Capped at 95 — never claim certainty.
function computeConfidence(dataPoints, r2, cv) {
    const dataScore = Math.min(1, dataPoints / 30) * 35;
    const modelScore = r2 * 30;
    const stabilityScore = (1 - Math.min(1, (cv || 0) / 2)) * 35;
    return Math.round(Math.min(95, Math.max(5, dataScore + modelScore + stabilityScore)));
}

// Build a continuous calendar-day series (zero-filled for days without
// sales) from the first sale (capped at maxDays) through today.
// Without zero-fill, a product selling weekly looks like a daily seller
// and every downstream number (daily average, stockout, reorder) inflates.
function buildDailySeries(rows, maxDays = HISTORY_WINDOW_DAYS) {
    const dailyMap = {};
    rows.forEach(r => {
        const date = new Date(r.sale_date).toISOString().split('T')[0];
        dailyMap[date] = (dailyMap[date] || 0) + Number(r.quantity);
    });
    const dates = Object.keys(dailyMap).sort();
    if (!dates.length) return [];
    const now = new Date();
    const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const firstMs = Date.parse(dates[0] + 'T00:00:00Z');
    const startMs = Math.max(firstMs, endMs - (maxDays - 1) * DAY_MS);
    const series = [];
    for (let t = startMs; t <= endMs; t += DAY_MS) {
        const d = new Date(t).toISOString().split('T')[0];
        series.push({ date: d, quantity: dailyMap[d] || 0 });
    }
    return series;
}

// Multiplicative day-of-week indices (dampened 50%, clamped) so weekend
// peaks / midweek lulls shape the daily forecast.
function dayOfWeekIndices(series) {
    const sums = Array(7).fill(0), counts = Array(7).fill(0);
    series.forEach(pt => {
        const dow = new Date(pt.date + 'T00:00:00Z').getUTCDay();
        sums[dow] += pt.quantity;
        counts[dow]++;
    });
    const overallAvg = series.reduce((a, p) => a + p.quantity, 0) / (series.length || 1);
    if (overallAvg <= 0) return Array(7).fill(1);
    return sums.map((s, i) => {
        if (counts[i] < 2) return 1;
        const raw = (s / counts[i]) / overallAvg;
        const dampened = 1 + (raw - 1) * 0.5;
        return Math.min(2, Math.max(0.3, dampened));
    });
}

// Core forecaster shared by /product/:id and /all.
// Ensemble: Holt smoothing + linear regression + weighted moving average,
// weighted by how much history exists, then shaped by day-of-week indices.
function forecastSeries(series, days = FORECAST_DAYS) {
    const quantities = series.map(p => p.quantity);
    const n = quantities.length;
    const total = quantities.reduce((a, b) => a + b, 0);
    const avg = n > 0 ? total / n : 0;
    const reg = linearRegression(quantities);
    const holt = holtSmoothing(quantities);
    const wma = weightedMovingAverage(quantities, Math.min(7, n));
    const dowIdx = n >= 14 ? dayOfWeekIndices(series) : Array(7).fill(1);
    const sigma = stdDev(quantities);
    const lastMs = n ? Date.parse(series[n - 1].date + 'T00:00:00Z') : Date.now();

    const predictions = [];
    for (let i = 1; i <= days; i++) {
        const holtVal = holt.level + holt.trend * i;
        const regVal = reg.slope * (n - 1 + i) + reg.intercept;
        let base;
        if (n >= 14) {
            base = 0.5 * holtVal + 0.3 * regVal + 0.2 * wma;
        } else if (n >= 7) {
            base = 0.4 * holtVal + 0.2 * regVal + 0.4 * wma;
        } else {
            base = 0.5 * wma + 0.5 * avg;
        }
        const d = new Date(lastMs + i * DAY_MS);
        const val = Math.max(0, base * dowIdx[d.getUTCDay()]);
        predictions.push({
            date: d.toISOString().split('T')[0],
            predicted_quantity: Math.round(val * 100) / 100,
            lower_bound: Math.max(0, Math.round((val - 1.28 * sigma) * 100) / 100),
            upper_bound: Math.round((val + 1.28 * sigma) * 100) / 100,
            day: i
        });
    }

    const cv = avg > 0 ? sigma / avg : 0;
    const trend = reg.slope > avg * 0.02 ? 'up' : reg.slope < -avg * 0.02 ? 'down' : 'stable';

    const last7 = quantities.slice(-7);
    const prev7 = quantities.slice(-14, -7);
    const recentAvg = last7.reduce((a, b) => a + b, 0) / (last7.length || 1);
    const prevAvg = prev7.length ? prev7.reduce((a, b) => a + b, 0) / prev7.length : recentAvg;
    const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100).toFixed(1) : '0.0';

    return {
        predictions,
        sigma,
        trend,
        momentum,
        historyDays: n,
        historyAvg: avg,
        confidence: computeConfidence(n, reg.r2, cv)
    };
}

// ---------- Routes ----------

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

        const series = buildDailySeries(rows);
        const fc = forecastSeries(series);

        const nextMonthTotal = Math.round(fc.predictions.reduce((a, p) => a + p.predicted_quantity, 0) * 100) / 100;
        const dailyAvg = nextMonthTotal / FORECAST_DAYS;
        const daysUntilStockout = dailyAvg > 0 ? Math.floor(stock / dailyAvg) : 999;

        // Safety stock at ~95% service level: z * sigma_daily * sqrt(lead time)
        const safetyStock = Math.ceil(1.65 * fc.sigma * Math.sqrt(leadTime));
        const reorderPoint = Math.max(reorderLevel, Math.ceil(dailyAvg * leadTime) + safetyStock);
        const reorderTriggered = stock <= reorderPoint;
        const recommendedQty = Math.max(0, Math.ceil(nextMonthTotal + dailyAvg * leadTime - stock));

        return res.json({
            success: true,
            data: {
                product_id: Number(req.params.id),
                product_name: rows[0].name,
                model: 'Ensemble: Holt exponential smoothing + linear regression + weighted MA, day-of-week seasonality (90-day window)',
                historical_data: series,
                predictions: fc.predictions,
                next_month_prediction: nextMonthTotal,
                daily_average: Math.round(dailyAvg * 100) / 100,
                confidence_score: fc.confidence,
                trend: fc.trend,
                trend_momentum: `${fc.momentum}%`,
                days_until_stockout: daysUntilStockout,
                reorder_recommendation: {
                    recommended_reorder_point: reorderPoint,
                    recommended_order_quantity: recommendedQty,
                    safety_stock: safetyStock,
                    lead_time_days: leadTime,
                    reorder_triggered: reorderTriggered,
                    days_until_stockout: daysUntilStockout
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
              AND s.created_at >= DATE_SUB(NOW(), INTERVAL ${HISTORY_WINDOW_DAYS} DAY)
            ORDER BY s.created_at ASC
        `);

        const byProduct = {};
        rows.forEach(r => {
            const pid = r.product_id;
            if (!byProduct[pid]) byProduct[pid] = { name: r.name, rows: [] };
            byProduct[pid].rows.push(r);
        });

        const result = Object.entries(byProduct).map(([pid, data]) => {
            const series = buildDailySeries(data.rows);
            const fc = forecastSeries(series);
            const nextMonthTotal = Math.round(fc.predictions.reduce((a, p) => a + p.predicted_quantity, 0) * 100) / 100;
            return {
                product_id: Number(pid),
                product_name: data.name,
                next_month_prediction: nextMonthTotal,
                daily_average: Math.round((nextMonthTotal / FORECAST_DAYS) * 100) / 100,
                trend: fc.trend,
                trend_momentum: `${fc.momentum}%`,
                confidence_score: fc.confidence,
                days_of_history: fc.historyDays
            };
        });

        result.sort((a, b) => b.next_month_prediction - a.next_month_prediction);
        res.json({ success: true, data: { total_products: result.length, window_days: HISTORY_WINDOW_DAYS, predictions: result } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/summary', authenticateToken, async (req, res) => {
    try {
        // Products with 30-day sales velocity in one query, so reorder
        // recommendations reflect actual demand instead of a static 2x rule.
        const [products] = await pool.query(`
            SELECT p.id, p.name, p.stock_quantity, p.reorder_level,
                   COALESCE(SUM(CASE
                       WHEN s.payment_status = 'completed'
                        AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                       THEN si.quantity END), 0) AS qty_30d
            FROM products p
            LEFT JOIN sale_items si ON si.product_id = p.id
            LEFT JOIN sales s ON si.sale_id = s.id
            WHERE p.is_active = TRUE
            GROUP BY p.id, p.name, p.stock_quantity, p.reorder_level
        `);

        const LEAD_TIME = 7;
        const recommendations = products
            .filter(p => Number(p.stock_quantity) <= Number(p.reorder_level))
            .map(p => {
                const stock = Number(p.stock_quantity);
                const reorder = Number(p.reorder_level);
                const qty30 = Number(p.qty_30d);
                const dailyVelocity = qty30 / 30;
                const daysUntilStockout = dailyVelocity > 0 ? Math.floor(stock / dailyVelocity) : 999;
                const demandBasedQty = Math.ceil(qty30 + dailyVelocity * LEAD_TIME - stock);
                const recommendedQty = Math.max(reorder * 2 - stock, demandBasedQty, 0);
                const priority = (stock <= reorder / 2 || daysUntilStockout <= LEAD_TIME) ? 'High' : 'Medium';
                return {
                    product_name: p.name,
                    current_stock: stock,
                    reorder_level: reorder,
                    sales_last_30d: qty30,
                    days_until_stockout: daysUntilStockout,
                    recommended_qty: recommendedQty,
                    priority
                };
            })
            .sort((a, b) => {
                if (a.priority !== b.priority) return a.priority === 'High' ? -1 : 1;
                return a.days_until_stockout - b.days_until_stockout;
            });

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
