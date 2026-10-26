/* Notes on a purchase order, from the shop or the supplier.

   A note is sent with one press of Send. Pressing it again and again (or a
   slow connection that makes it look stuck) used to save the same note many
   times. The page now locks Send while it is on its way; the server also
   refuses the same note again within a minute and more than NOTES_PER_MINUTE
   notes a minute from one person on one order. */

const NOTES_PER_MINUTE = 5;

/**
 * `recent` is this person's notes on this order from the last minute,
 * as [{ body }]. Returns why the note is refused, or null.
 */
function noteProblem(body, recent) {
    const list = recent || [];
    const same = String(body).trim();
    if (list.some(n => String(n.body).trim() === same)) return 'That note was just sent.';
    if (list.length >= NOTES_PER_MINUTE) return `That is ${NOTES_PER_MINUTE} notes in a minute. Wait a moment before sending another.`;
    return null;
}

const RECENT_NOTES_SQL = 'SELECT body FROM po_messages WHERE po_id = ? AND user_id = ? AND created_at > NOW() - INTERVAL 1 MINUTE';

module.exports = { NOTES_PER_MINUTE, noteProblem, RECENT_NOTES_SQL };
