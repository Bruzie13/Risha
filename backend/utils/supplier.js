/* What a supplier needs before it can be saved.

   A supplier is who an order is addressed to and emailed to, so the name has
   to be there and be the only one of its kind, and an email or phone number
   that is given has to be one. The page checks the same things; these are the
   checks that hold whatever sends the request. */

const LIMITS = { name: 100, contact_person: 100, email: 254, phone: 20, address: 255, city: 100, payment_terms: 100 };
const LABELS = { name: 'Supplier name', contact_person: 'Contact person', email: 'Email', phone: 'Phone number', address: 'Address', city: 'City', payment_terms: 'Payment terms' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\-\s]+$/;
// a company name: letters (ñ and accents too), numbers, spaces and . , & ' - ( ) /
const COMPANY = /^[\p{L}\p{M}0-9 .,&'()\/-]+$/u;
// a person's name or a city: letters, spaces and . ' - only
const PERSON = /^[\p{L}\p{M} .'-]+$/u;
const HAS_LETTER = /\p{L}/u;
// what a new supplier must have; on an edit these cannot be emptied
const REQUIRED = { name: 'Enter the supplier name.', contact_person: 'Enter the contact person.', email: 'Enter the email address.', phone: 'Enter the phone number.' };

const blank = v => v == null || String(v).trim() === '';

/** A name as it is compared: no outer spaces, single spaces inside, small letters. */
function nameKey(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/* What is wrong with one field as typed, or null. The page (suppliers.js
   supplierFieldProblem) gives the same answers. */
function fieldProblem(field, value) {
    const v = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    if (!v) return REQUIRED[field] || null;
    if (LIMITS[field] && v.length > LIMITS[field]) return `${LABELS[field]} is too long (${LIMITS[field]} characters at most).`;
    switch (field) {
        case 'name':
            if (v.length < 2) return 'The supplier name is too short: use at least 2 characters.';
            if (!HAS_LETTER.test(v)) return 'The supplier name needs at least one letter, not only numbers or symbols.';
            if (!COMPANY.test(v)) return "The supplier name can use letters, numbers, spaces and . , & ' - ( ) / only.";
            return null;
        case 'contact_person':
            if (v.length < 2) return "The contact person's name is too short: use at least 2 characters.";
            if (!PERSON.test(v) || !HAS_LETTER.test(v)) return "The contact person's name can use letters, spaces and . ' - only, with no numbers.";
            return null;
        case 'email':
            return EMAIL.test(v) ? null : 'Enter the email address in full, like name@example.com.';
        case 'phone': {
            const digits = v.replace(/\D/g, '').length;
            if (!PHONE.test(v)) return 'Enter the phone number using digits, spaces and + ( ) - only.';
            if (digits < 7) return 'The phone number is too short: it needs at least 7 digits.';
            if (digits > 15) return 'The phone number has too many digits (15 at most).';
            return null;
        }
        case 'city':
            if (v.length < 2) return 'The city is too short: use at least 2 characters.';
            if (!PERSON.test(v) || !HAS_LETTER.test(v)) return "The city can use letters, spaces and . ' - only, with no numbers.";
            return null;
        default:
            return null;
    }
}

/**
 * `adding` is true for a new supplier: the name, contact person, email and
 * phone must be there. On an edit only the fields the edit carries are judged,
 * and `previous` (the supplier as it is now) lets a value saved before these
 * rules stay as it is. Returns why it cannot be saved, or null.
 */
function supplierProblem(data, adding, previous) {
    const d = data || {};
    const sent = k => Object.prototype.hasOwnProperty.call(d, k);
    for (const field of Object.keys(LABELS)) {
        if (!(adding || sent(field))) continue;
        const value = d[field];
        if (blank(value) && !REQUIRED[field]) continue;
        if (!blank(value) && previous && String(previous[field] ?? '').trim() === String(value).trim()) continue;
        const problem = fieldProblem(field, value);
        if (problem) return problem;
    }
    return null;
}

module.exports = { supplierProblem, fieldProblem, nameKey, LIMITS };
