const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const localPrinter = require('../utils/localPrinter');

// The receipt printer on the computer this server runs on (utils/localPrinter.js).
router.use(authenticateToken);

// Can this server print receipts itself? The POS page asks before offering to.
router.get('/status', async (req, res) => {
    const state = await localPrinter.status();
    res.json({ success: true, data: { available: state.available, printer: state.printer, reason: state.reason } });
});

// The body is the receipt's ESC/POS bytes, exactly as the page built them.
router.post('/print', express.raw({ type: 'application/octet-stream', limit: localPrinter.MAX_BYTES }), async (req, res) => {
    try {
        await localPrinter.print(req.body);
        res.json({ success: true });
    } catch (e) {
        console.error('Receipt print error:', e.message);
        res.status(503).json({ success: false, message: e.message });
    }
});

module.exports = router;
