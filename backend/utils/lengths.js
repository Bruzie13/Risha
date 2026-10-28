/* How long a typed value may be, for the boxes whose column alone would take
   far more than anyone needs (a 255-character name). The page sets the same
   limits on its boxes (maxlength) and counts down as the end nears; these
   are the checks that hold whatever sends the request. */

const LIMITS = {
    full_name: ['Full name', 100],
    username: ['Username', 30],
    email: ['Email', 254],
    customer_name: ['Customer name', 100],
    customer_phone: ['Customer phone', 20],
    stock_notes: ['The reason', 200]
};

/** The reason the value is too long, or null. `key` is one of LIMITS. */
function tooLong(key, value) {
    const [label, max] = LIMITS[key];
    if (value == null) return null;
    return String(value).trim().length > max ? `${label} is too long (${max} characters at most).` : null;
}

/** The first of several { key: value } pairs that is too long, or null. */
function firstTooLong(pairs) {
    for (const [key, value] of Object.entries(pairs)) {
        const problem = tooLong(key, value);
        if (problem) return problem;
    }
    return null;
}

module.exports = { LIMITS, tooLong, firstTooLong };
