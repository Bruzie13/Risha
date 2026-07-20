const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: process.env.DB_PORT || process.env.MYSQLPORT || 3306,
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Fail fast on a stalled TCP connect instead of hanging.
    connectTimeout: 20000,
    // Aiven's free tier drops idle connections; without keepalive the pool
    // later hands back a dead socket and the next query throws ETIMEDOUT.
    // Keepalive holds them open, and idleTimeout/maxIdle proactively close
    // ours before the server does.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    idleTimeout: 60000,
    maxIdle: 10,
    ssl: process.env.DB_SSL === 'true' || process.env.MYSQLSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

const { withRetry } = require('../utils/dbRetry');

// Retry connection acquisition (side-effect free) transparently.
const rawGetConnection = pool.getConnection.bind(pool);
pool.getConnection = () => withRetry(() => rawGetConnection());

// pool.query is only used for read-only analytics here, so retrying is safe.
const rawQuery = pool.query.bind(pool);
pool.query = (...args) => withRetry(() => rawQuery(...args));

module.exports = pool;
