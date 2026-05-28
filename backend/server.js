const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
require('dotenv').config({ path: __dirname + '/.env', override: true });

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const saleRoutes = require('./routes/sales');
const supplierRoutes = require('./routes/suppliers');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const auditRoutes = require('./routes/audit');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit-logs', auditRoutes);

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5002';
const mlUrl = new URL(ML_SERVICE_URL);

app.use('/api/predictions', (req, res) => {
    const options = {
        hostname: mlUrl.hostname,
        port: mlUrl.port,
        path: req.originalUrl,
        method: req.method,
        headers: { ...req.headers, host: 'localhost:5002' }
    };
    delete options.headers['connection'];

    const proxyReq = http.request(options, proxyRes => {
        res.status(proxyRes.statusCode);
        proxyRes.headers && Object.keys(proxyRes.headers).forEach(k => {
            if (!['connection', 'transfer-encoding'].includes(k)) {
                res.setHeader(k, proxyRes.headers[k]);
            }
        });
        proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
        res.status(502).json({ success: false, message: 'ML service unavailable' });
    });
    if (req.body && Object.keys(req.body).length) {
        proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, '..', 'src'), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res, filePath) => {
        if (filePath.match(/\.(js|css|html)$/)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
    }
}));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'src', 'login.html'));
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

const scheduler = require('./utils/scheduler');

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    scheduler.start();
});
