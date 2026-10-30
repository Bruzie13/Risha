/* Rules that stop the shop locking itself out of administration.

   Only an administrator can manage accounts, approve a password reset or
   restore a deactivated account. If the last one is deleted, deactivated or
   turned into another role, nobody is left who can undo it. And an
   administrator acting on their own account is one misplaced click from
   exactly that, so their own account is handled by another administrator. */

/**
 * May the account `actorId` do this to `target`?
 * `what` is 'delete', 'deactivate' or 'demote' (administrator to another role).
 * `activeAdmins` is how many active administrator accounts exist right now.
 * Returns the reason it may not, or null.
 */
function adminRemovalProblem(actorId, target, activeAdmins, what) {
    if (!target) return null;
    if (Number(actorId) === Number(target.id)) {
        return what === 'demote'
            ? 'You cannot change your own role. Ask another administrator to do it.'
            : 'You cannot remove your own account. Ask another administrator to do it.';
    }
    const isActiveAdmin = target.role === 'admin' && (target.is_active === undefined || !!Number(target.is_active) || target.is_active === true);
    if (isActiveAdmin && Number(activeAdmins) <= 1) {
        return 'This is the only administrator account. Create another administrator first.';
    }
    return null;
}

/* A person's full name: letters (ñ and accents too), spaces and . ' - only,
   no numbers, at least 2 characters. The same rule as a supplier's contact
   person (utils/supplier.js); the page checks it too (fullNameProblem in
   auth.js). `before` is the name already saved: an edit that leaves it as it
   was is not refused, so an older account can still be edited. */
const PERSON_NAME = /^[\p{L}\p{M} .'-]+$/u;
function fullNameProblem(name, before) {
    const v = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!v) return 'Enter the full name.';
    if (before != null && v === String(before).trim().replace(/\s+/g, ' ')) return null;
    if (v.length < 2) return 'The full name is too short: use at least 2 characters.';
    if (!PERSON_NAME.test(v) || !/\p{L}/u.test(v)) return "The full name can use letters, spaces and . ' - only, with no numbers.";
    return null;
}

module.exports = { adminRemovalProblem, fullNameProblem };
