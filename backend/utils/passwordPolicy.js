// Shared password policy: at least 6 characters with an uppercase letter,
// a lowercase letter, a number, and a special character.
// Returns null when the password passes, or a human-readable reason.
function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < 6) {
        return 'Password must be at least 6 characters long';
    }
    if (!/[A-Z]/.test(pw)) {
        return 'Password must contain at least one uppercase letter (A–Z)';
    }
    if (!/[a-z]/.test(pw)) {
        return 'Password must contain at least one lowercase letter (a–z)';
    }
    if (!/[0-9]/.test(pw)) {
        return 'Password must contain at least one number (0–9)';
    }
    if (!/[^A-Za-z0-9]/.test(pw)) {
        return 'Password must contain at least one special character (e.g. !@#$%)';
    }
    return null;
}

module.exports = { validatePassword };
