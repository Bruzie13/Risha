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

module.exports = { adminRemovalProblem };
