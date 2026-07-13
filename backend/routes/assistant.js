const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { askAssistant } = require('../utils/assistant');

// Any signed-in user can ask the assistant. Rate-limited lightly per user to
// stay well inside the free Gemini tier.
const recent = new Map();
function rateLimit(userId) {
    const now = Date.now();
    const hits = (recent.get(userId) || []).filter(t => now - t < 60000);
    hits.push(now);
    recent.set(userId, hits);
    return hits.length <= 15; // 15 questions/minute/user
}

router.get('/status', authenticateToken, (req, res) => {
    res.json({ success: true, enabled: !!process.env.GEMINI_API_KEY });
});

router.post('/', authenticateToken, async (req, res) => {
    try {
        if (!rateLimit(req.user.id)) {
            return res.status(429).json({ success: false, message: 'You are asking very quickly — give it a few seconds.' });
        }
        const question = (req.body && typeof req.body.question === 'string') ? req.body.question.slice(0, 600) : '';
        const result = await askAssistant(question);
        if (result.ok) {
            res.json({ success: true, answer: result.answer });
        } else {
            res.status(result.reason === 'no_key' ? 503 : 400).json({ success: false, message: result.message, reason: result.reason });
        }
    } catch (e) {
        console.error('Assistant route error:', e.message);
        res.status(500).json({ success: false, message: 'Assistant error' });
    }
});

module.exports = router;
