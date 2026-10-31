# UAT notes, part 3 (31 Oct 2026)

From `UAT NOTES PART 3.pdf`. **All done 31 Oct** (not yet committed or deployed). Each note is numbered so it can be referred to; ✓ = already done by the 30 Oct update.

## System — all accounts
- ✓ **S1** Buttons follow the chosen theme: with a blue theme, the outlined buttons (example: End of day, Export Excel) are filled with that colour too, not only white.
- ✓ **S2** Dark mode moves to Settings; the dark-mode button at the bottom of the sidebar (under the profile) becomes a **Trash** button.

## Supplier account
- ✓ **SA1** Payments: every payment in the system gets a receipt.
- ✓ **SA2** A payment past due, or close to its due date, notifies the supplier, so Payments does something.
- ✓ **SA3** **My details** tab: remove it, or move it into the profile (lower-left).

## Cashier account
- ✓ **C1** Barcode search and product search: pick one way, either search while typing or search on Enter.
- ✓ **C2** Current sale: "Customer (optional)" becomes **"Customer Name (optional)"**.
- ✓ **C3** Cash received: add **+1, +5, +10** buttons.
- ✓ **C4** A void request can be **cancelled**.
- ✓ **C5** Taken out, Put in and End of day show how much cash is in the drawer now.
- ✓ **C6** My sales window has both × and Close: keep one.

## Admin account
- ✓ **A1** Dashboard → Expiring products: the list scrolls even when there is room for it.
- ✓ **A2** Receiving an order: move the sentence "Leave it blank…" under the date box.
- ✓ **A3** Reorder and everything else that sends an email: the notification says what was emailed (details).
- ✓ **A4** Trash:
  - a **Delete permanently** button, asking "Are you sure you want to permanently delete …?"
  - a setting for how many days before items are deleted automatically (example 20 or 30)
  - after deleting something: a **Go to Trash** button
  - after restoring: a link to where it went back to
- ✓ **A5** Notifications do something: click one to open its details, formatted neatly (like Facebook or email). Example, a void request: who asked, sale number, which cashier. A void notification links to Reports.
- ✓ **A6** Sales history: a sale with a void request still shows status "Completed"; the status should say the request.
- ✓ **A7** Suppliers: **Send thanks** and **Send cancellation** can be sent again and again with no sign it was already sent.
- ✓ **A8** Reports: put the graphs together ("pagsamahin yung mga graphs").
- ✓ **A9** Stock planning → Expiry: label "At risk", and colour the rows (example red) so the ones about to expire stand out.
- ✓ **A10** Notifications get extra details the way the Activity log entries do.

## Supplier test plan
- **SU1** Order confirmation 1: says "red" button — ✓ already removed (30 Oct plan).
- ✓ **SU2** Order confirmation 2: add the limits: date not more than a year ahead, quantity greater than 0.
- **SU3** Shipping 1: says "red" — ✓ already removed.
- ✓ **SU4** Change delivery date: add the date limits.

## Cashier test plan
- ✓ **CU1** Product search 2: "press Enter" or "type", whichever C1 ends up being.
- ✓ **CU2** Current sale: "Customer Name", and add an example phone number.

## Admin test plan
- ✓ **AU1** Product addition 2:
  - the labels in bold (**Product name:**, **Stock:**, **Unit price:** …)
  - in the same order as the form (species where the form has it)
  - the supplier must be a real supplier's name (not "PetCo Wholesale")
  - fix the expiration date wording ("one week" then "one year" is confusing)
  - add the barcode
- ✓ **AU2** Product import 4: Expected becomes "if no product with the same … exists, … is imported; otherwise the error message shows".
- ✓ **AU3** Bulk reorder is missing: add a test case.
- ✓ **AU4** Supplier addition 2: put "then click **Save supplier**" under the list of details, and bold the labels (**Supplier name:** …).
- ✓ **AU5** Supplier addition: remove 3 (the 0000000000 phone case).
- ✓ **AU6** Product addition: remove 4 (the empty expiration date case).
- ✓ **AU7** Every step whose only point is one error message: remove it (all plans).
- ✓ **AU8** Reports, Sales report 1: remove the example, and break the long text into lines.
