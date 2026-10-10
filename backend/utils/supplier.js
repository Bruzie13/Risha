/* What a supplier needs before it can be saved.

   A supplier is who an order is addressed to and emailed to, so the name has
   to be there and be the only one of its kind, and an email or phone number
   that is given has to be one. The page checks the same things; these are the
   checks that hold whatever sends the request. */

const LIMITS = { name: 255, contact_person: 255, email: 255, phone: 20, city: 100, payment_terms: 100 };
const LABELS = { name: 'Supplier name', contact_person: 'Contact person', email: 'Email', phone: 'Phone number', city: 'City', payment_terms: 'Payment terms' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\-\s]+$/;

const blank = v => v == null || String(v).trim() === '';

/** A name as it is compared: no outer spaces, single spaces inside, small letters. */
function nameKey(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * `adding` is true for a new supplier: the name must be there. On an edit only
 * the fields the edit carries are judged. Returns why it cannot be saved, or null.
 */
function supplierProblem(data, adding) {
    const d = data || {};
    const sent = k => Object.prototype.hasOwnProperty.call(d, k);
    if ((adding || sent('name')) && blank(d.name)) return 'Supplier name is required.';
    for (const [field, max] of Object.entries(LIMITS)) {
        if (sent(field) && !blank(d[field]) && String(d[field]).length > max) return `${LABELS[field]} is too long (${max} characters at most).`;
    }
    if (sent('email') && !blank(d.email) && !EMAIL.test(String(d.email).trim())) return 'Enter the email address in full, like name@example.com.';
    if (sent('phone') && !blank(d.phone)) {
        const phone = String(d.phone).trim();
        if (!PHONE.test(phone) || phone.replace(/\D/g, '').length < 7) return 'Enter the phone number in digits (at least 7).';
    }
    return null;
}

module.exports = { supplierProblem, nameKey, LIMITS };
