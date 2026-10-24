const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { askAssistant } = require('../utils/assistant');

// Back-office users can ask the assistant (till and supplier accounts are fenced
// out by authenticateToken). Rate-limited per user: every question is a paid
// Claude request.
const recent = new Map();
function rateLimit(userId) {
    const now = Date.now();
    const hits = (recent.get(userId) || []).filter(t => now - t < 60000);
    hits.push(now);
    recent.set(userId, hits);
    return hits.length <= 15; // 15 questions/minute/user
}

router.get('/status', authenticateToken, (req, res) => {
    res.json({ success: true, enabled: !!process.env.ANTHROPIC_API_KEY, can_change: ['admin', 'manager'].includes(req.user.role) });
});

router.post('/', authenticateToken, async (req, res) => {
    try {
        if (!rateLimit(req.user.id)) {
            return res.status(429).json({ success: false, message: 'You are asking very quickly — give it a few seconds.' });
        }
        const question = (req.body && typeof req.body.question === 'string') ? req.body.question.slice(0, 600) : '';
        const history = Array.isArray(req.body && req.body.history) ? req.body.history : [];
        // only accounts that may change stock are given the tools that propose a change
        const canChange = ['admin', 'manager'].includes(req.user.role);
        const result = await askAssistant(question, { history, canChange });
        if (result.ok) {
            res.json({ success: true, answer: result.answer, proposals: result.proposals || [] });
        } else {
            res.status(result.reason === 'no_key' || result.reason === 'bad_key' ? 503 : result.reason === 'busy' ? 429 : 400).json({ success: false, message: result.message, reason: result.reason });
        }
    } catch (e) {
        console.error('Assistant route error:', e.message);
        res.status(500).json({ success: false, message: 'Assistant error' });
    }
});

module.exports = router;
