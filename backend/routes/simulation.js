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

router.post('/live/pause', authenticateToken, watchers, (req, res) => {
    const r = live.pause();
    res.status(r.ok ? 200 : 400).json({ success: r.ok, message: r.message || 'Paused.' });
});

router.post('/live/resume', authenticateToken, watchers, (req, res) => {
    const r = live.resume();
    res.status(r.ok ? 200 : 400).json({ success: r.ok, message: r.message || 'Resumed.' });
});

// Counts the cash and closes the drawer: the cashier cannot sell again today.
router.post('/live/end-day', authenticateToken, watchers, async (req, res) => {
    try {
        const r = await live.endDay();
        res.status(r.ok ? 200 : 400).json({ success: r.ok, message: r.message || 'Counted and closed.', data: r.results });
    } catch (e) {
        console.error('[Simulation] end of day error:', e.message);
        res.status(500).json({ success: false, message: 'The end-of-day count could not be saved. Check the database connection and try again.' });
    }
});

module.exports = router;
