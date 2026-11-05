/* The live sales simulation (Simulation screen). Open to the simulation
   account and administrators; see services/simulation/live.js. */
const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const live = require('../services/simulation/live');

const watchers = authorizeRole('simulation', 'admin');

router.get('/live', authenticateToken, watchers, async (req, res) => {
    try {
        res.json({ success: true, data: await live.snapshot(Number(req.query.after) || 0) });
    } catch (e) {
        console.error('[Simulation] snapshot error:', e.message);
        res.status(500).json({ success: false, message: 'Could not read the simulation status. Check the database connection and try again.' });
    }
});

router.post('/live/start', authenticateToken, watchers, async (req, res) => {
    const minutes = Number(req.body && req.body.minutes);
    if (req.body && req.body.minutes != null && !(minutes >= 5 && minutes <= 240)) {
        return res.status(400).json({ success: false, message: 'Choose how long to run, from 5 to 240 minutes.' });
    }
    const r = await live.start({ minutes: minutes || 120, user: req.user && req.user.username });
    res.status(r.ok ? 200 : 400).json({ success: r.ok, message: r.message || 'Started.' });
});

router.post('/live/stop', authenticateToken, watchers, (req, res) => {
    const r = live.stop();
    res.status(r.ok ? 200 : 400).json({ success: r.ok, message: r.message || 'Stopped.' });
});

module.exports = router;
