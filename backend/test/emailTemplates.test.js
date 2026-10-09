const test = require('node:test');
const assert = require('node:assert');
const { templates } = require('../utils/mailer');

/* Every email is built by a pure function, so what goes out can be checked
   without sending anything. */
const samples = {
    purchaseOrder: { supplierName: 'Happy Paws <b>Inc</b>', poNumber: 'PO-0042', totalAmount: 12345.5, trackingId: 'a'.repeat(64),
        items: [{ product_name: 'AOZI <script>alert(1)</script>', quantity: 3, unit_price: 1660, total_price: 4980 }] },
    lowStock: { supplierName: "O'Brien & Sons", trackingId: 'b'.repeat(64),
        items: [{ name: 'PEDIGREE "PUPPY"', sku: 'DRY-<1>', stock_quantity: 0, reorder_level: 10 }, { name: 'TOP BREED', sku: null, stock_quantity: 4, reorder_level: 10 }] },
    passwordReset: { fullName: 'Ana <i>Cruz</i>', resetUrl: 'https://example.test/reset-password.html?token=abc', lasts: '1 hour' },
    verifyAddress: { fullName: 'Ana', verifyUrl: 'https://example.test/verify-email.html?token=abc' },
    emailCode: { code: '482913' },
    welcome: { toEmail: 'ana@example.test', fullName: 'Ana Cruz', username: 'ana<1>', role: 'cashier' },
    test: { sender: 'shop@example.test', sentAt: 'Oct 9, 2026, 3:00 PM' },
    backup: { tables: 18, rows: 9000, kb: '63', day: '2026-10-09' }
};

for (const [name, data] of Object.entries(samples)) {
    test(`${name}: has a subject, an HTML body and a plain-text twin`, () => {
        const mail = templates[name](data);
        assert.ok(mail.subject && mail.subject.length < 90, 'subject present and short');
        assert.ok(mail.html.includes('Risha Pet Supplies'), 'uses the shared shell');
        assert.ok(mail.text && mail.text.length > 40, 'plain-text part present');
        // plain text shows typed names as typed; what must not leak in is the layout's own markup
        assert.ok(!/<\/?(p|table|td|tr|a|div|span|h1|strong|br|img)\b/i.test(mail.text), 'none of the layout markup in the text part');
    });

    test(`${name}: subject is a plain sentence`, () => {
        const { subject } = templates[name](data);
        assert.ok(!/\p{Extended_Pictographic}/u.test(subject), 'no emoji');
        assert.ok(!/\b[A-Z]{5,}\b/.test(subject.replace('FETCH', '')), 'no shouting');
        assert.ok(!subject.includes('!'), 'no exclamation mark');
    });
}

test('what a person typed never reaches the HTML unescaped', () => {
    const po = templates.purchaseOrder(samples.purchaseOrder).html;
    assert.ok(!po.includes('<script>alert(1)</script>'));
    assert.ok(po.includes('&lt;script&gt;'));
    assert.ok(!po.includes('<b>Inc</b>'));
    const low = templates.lowStock(samples.lowStock).html;
    assert.ok(!low.includes('DRY-<1>'));
    assert.ok(low.includes('O&#39;Brien &amp; Sons'));
    assert.ok(!templates.passwordReset(samples.passwordReset).html.includes('<i>Cruz</i>'));
    assert.ok(!templates.welcome(samples.welcome).html.includes('ana<1>'));
});

test('the reset email states the real lifetime of the link everywhere', () => {
    const mail = templates.passwordReset(samples.passwordReset);
    assert.ok(mail.html.includes('1 hour') && mail.text.includes('1 hour'));
    assert.ok(!mail.html.includes('30 minutes') && !mail.text.includes('30 minutes'));
});

test('a purchase order shows money with separators and the right total', () => {
    const mail = templates.purchaseOrder(samples.purchaseOrder);
    assert.ok(mail.html.includes('₱12,345.50'));
    assert.ok(mail.text.includes('₱4,980.00'));
});

test('a low-stock notice says how many are sold out', () => {
    const mail = templates.lowStock(samples.lowStock);
    assert.ok(mail.subject.startsWith('2 products are running low, 1 already sold out'));
});
