# FETCH: QA test run, 9 October 2026 (part 1)

Tested on `http://localhost:8000` against the three forms: System Test Plan (Admin and Users), System Test Plan (Supplier), and the Unit Test Plan (UAT). "System Testing Form.pdf" is the first two combined, so it is covered by them.

Every case and its result is in `qa-results.csv` (492 rows). Open it in Excel and copy Status and Comment into the forms.

## Where the run stands

| Form | Passed | Failed | In progress | Open |
| --- | --- | --- | --- | --- |
| System test: Admin and Users (174) | 24 | 0 | 1 | 149 |
| System test: Supplier (22) | 6 | 0 | 0 | 16 |
| Unit test plan, UAT (296) | 48 | 3 | 1 | 244 |

Tested so far: the login module and everything a Staff (cashier) account can do. The administrator and supplier modules are still Open because the tester had no sign-in for them. The supplier test password no longer works, and there is no administrator password to test with.

Separately, all 159 of the exact messages quoted in the UAT form that can be checked against the code were found word for word, apart from the three listed under "Failed" below.

## Defects found

1. **Sign-in lockout counted successful sign-ins (fixed).** The limit of five attempts per 15 minutes counted every sign-in from the same network address, not only wrong ones, and choosing a new password shared the same counter. In a shop where everyone is on one connection, the sixth person to sign in within 15 minutes was refused with "Too many login attempts". It now counts refused attempts only, and password reset has its own counter. Verified: seven correct sign-ins in a row succeed; five wrong ones still lock.
2. **"Sale completed" message had lost its punctuation (fixed).** It read "Sale completed Change: ₱12.00". Restored to "Sale completed! Change: ₱12.00", as the form expects.

## Results that differ from the forms (the system is right, the form needs updating)

- **UAT 3-04**: the message after "Ask for a reset" was reworded today, when administrators were given a direct email link.
- **UAT 15-04, 15-05**: expired and sold-out products can no longer be clicked on the POS. They are greyed and tagged; no message appears. This was a requested change.
- **System 83-01**: the cashier's end-of-day form does not show the expected cash before the count is saved. That is the blind count, also a requested change.
- **Button and window names**: the forms write them in Title Case ("Save Product", "Add New Product", "Confirm Cash Sale"). The system now uses sentence case ("Save product", "Add new product", "Confirm cash sale"). Same words, different capitals.
- **"Ask to void"** in the forms is **"Ask for void"** on the button.

## Feedback (not defects)

- **Expired products fill the first screen of the POS.** Eight of the first ten tiles are expired and cannot be sold, so the cashier has to scroll or search for almost everything. Suggest listing sellable products first.
- **Void reason dialog closes on a too-short reason.** The message "Say briefly what went wrong" appears, but the dialog has gone and the cashier must press "Ask for void" again. Suggest keeping it open.
- **The lockout is per network address, not per account.** Five wrong passwords by one person lock sign-in for everyone on the same connection for 15 minutes. It matches the form, but consider locking the account name instead.
- **The print dialog blocks the page** until it is answered. Expected for a browser print, worth knowing when demonstrating without a printer.

## Not run, and why

- Saving the end-of-day count (System 83-02, UAT 16-18, 17-01, 17-02): it would close today's till on the live database.
- USB thermal printer (System 80-01, UAT 16-13): needs the device.
- Email confirmation of a new account (System 4-01, UAT 3-07, 4-01, 4-02): needs a new or deactivated account.

## Left behind by the test

- **Sale #2578**, customer "QA TEST", ₱38.00, one PEDIGREE POUCH ADULT. A void request is waiting under Reports > Void requests; voiding it returns the item to stock.
