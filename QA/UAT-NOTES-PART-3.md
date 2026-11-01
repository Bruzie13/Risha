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
- ✓ **A6b** (left out of this copy at first, from the PDF) "Pag nakavoid, may hyperlink yung notifs na mapupunta sa Reports": a void request's notification opens with **Open Void requests**, and a voided sale's (1 Nov) with **Open in Reports** (Reports → Void requests, which lists the voided sales).
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

## While checking after Part 3 (1 Nov 2026)
- **S1b** Button colours hardly changed between themes: they now take the theme's **sidebar** colour (Navy, Red and Charcoal share the same blue "primary"). Not yet in the test plans.
- **SA1b** "Lahat ng transaction dapat may receipt": every **supplier order** (offer, waiting, confirmed, shipped, received, cancelled) has an **Order receipt** with Print — Supplier portal (Open orders and Past orders) and the shop (Suppliers → Orders cards, and each supplier's purchase order history). Add a test step to the Supplier and Admin plans when Carlo says the system is done.
- **S1c** "Ask FETCH din dapat nagbabago kulay": Ask FETCH (and the assistant's send button, paw and your own messages) and the Inventory **Reorder** button now take the theme's sidebar colour. A scan of every page in all 7 themes found nothing else fixed except status colours (Expired, Low stock, In stock, Delete, alerts), which keep their meaning on purpose.
- **S3** "Changes not saved": in Settings, switching tab, following a sidebar link or reloading with an unsaved change (Preferences/Appearance, Profile, Company details, Password, Point of sale limit, Email) asks "Changes not saved … Leave without saving?"; leaving puts the old values (and the saved theme) back.
- **S4** Phone box: the country list opened behind the window (the library's own layer won over ours); it now opens in front, everywhere a phone box is used.
- **S5** The colour cards in Appearance show the new look: the tinted button, the main action and Ask FETCH in each theme's colours.
- **S6** Phone box: no more digits than the chosen country's ordinary mobile/landline numbers (Philippines 11 with the 0, 10 without; US 10; UK 11; Singapore 8); extra digits are not taken, the counter says "Limit reached (11 digits for Philippines)", and changing the flag applies that country's limit.
- **C7** Cashier searching is automatic only: Enter typed by hand does nothing in Scan barcode or Search products (a scanner's own Enter still works); the search also updates on paste.
- **C8** Customer Name takes no numbers or symbols (letters, spaces and . ' - only): they are not typed in, with a note why; the server refuses a sale whose customer name has numbers.
- **A11** "Bakit walang notif ung void?": voiding a sale now adds "Sale voided: #…" to the bell (amount, cashier, who voided it, stock returned) and declining a request adds "Void request declined: #…". The cashier has no bell, so the till itself shows "Sale #… was voided by a manager" / "Your request for sale #… was declined" when the till opens or within a minute, once.
- **A7b** "Di dapat ma-spam ang Send thanks / Send cancellation": already once-only since 31 Oct; two quick clicks while the first email was still going could still send twice. Now the server refuses a second send while one is on its way ("…is being sent right now") and the button shows "Sending…" until done. Dry run: two quick clicks → one email.
- **A8b** "Pagsamahin ung ibang graphs": besides When the shop sells (31 Oct), Reports → Sales **What sold** (Best-selling products / By category) and Stock planning → Forecast **Expected sales** (By category / By brand) are each one card with a switch at the top right.
- **A9b** Expiry: about-to-expire stock comes first (soonest at the top, amber rows, amber "At risk"), then a red "Already expired" heading and the expired stock (most recent first, red rows, red "Expired"); the line above says how many of each.

**1 Nov:** everything above is now in the three test plans (17 changes: 12 Administrator, 2 Cashier, 3 Supplier), PDFs rebuilt.
