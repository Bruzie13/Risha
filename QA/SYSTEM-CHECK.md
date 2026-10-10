# FETCH: full system check

Date: 10 October 2026. Branch checked: `pro-redesign`.

Every number and every "works" in this file comes from a check that was actually run. Anything that was not run is listed under "Not pressed, and why". Nothing here is from memory.

The check was done in two passes:

1. **Looking only.** Reading the source, asking the server questions without signing in, and opening every page on a read-only copy of the server that refuses anything that would save.
2. **Pressing the buttons.** With the owner's permission, pressing the buttons that save, send and delete, using test records labelled "QA TEST" and three temporary accounts, then removing all of it.

## Results at a glance

| # | Check | Result |
|---|---|---|
| 1 | Every request a page sends has a server address that answers it | 139 of 139 |
| 2 | Every button's function exists on the page that uses it | 360 of 360 |
| 3 | Every link goes to a page that exists | 145 of 145 |
| 4 | Every stylesheet, script and image a page loads exists | 126 of 126 |
| 5 | Protected server addresses refuse without a sign-in (real local server) | 92 of 92 refused |
| 6 | A made-up sign-in token is refused | 45 of 45 refused |
| 7 | Pages are not served without a sign-in | 12 sent to sign-in; the 3 public ones open |
| 8 | Reading the real data, as administrator, viewer, cashier and supplier | 172 of 172 calls as expected |
| 9 | Every page opens with the real data and no script error | 13 page loads, 0 script errors |
| 10 | Buttons pressed for real, with test records | 128 kinds of control pressed; every one did what it says, after the fixes below |
| 11 | Real sign-in on the real local server, as manager, cashier and supplier | 98 of 98 checks |
| 12 | Real emails | 14 sent, all to the owner's own addresses; none to anyone else |
| 13 | Automated tests | 116 of 116 |
| 14 | Database after the clean-up | Every table has the same number of rows as before the test, except notifications (see "Clean-up") |

## Problems found and fixed

### Found in the first pass

1. **"View all" under Needs restocking went to the POS.** The session belongs to one browser tab; the page pass (a cookie) belongs to the whole browser. After a cashier signed in in another tab, the administrator's next link was judged as the cashier and sent to the POS, then back to the Dashboard. Now the tab being looked at takes the pass back, and a click that is still misdirected carries on to the page that was clicked. Tested four ways on a copy that follows the same rule; not tested with two real sign-ins in two tabs.
2. **The menu button covered the start of the page title** in a window 768px wide or narrower when the sidebar was collapsed (always the case for the till and supplier accounts). Measured at 726px on every page: fixed.
3. **A server address that does not exist answered with the sign-in page** and "200 OK". It now answers "404 Not found".

### Asked for before deploying

4. **The unused "new sale" dialog in Sales history is gone**, with everything only it used: 391 lines of script and 124 lines of page. The page also no longer loads the whole product list on every visit, and no longer listens for scanner keystrokes for a dialog nobody could open.
5. **28 server addresses that no page used were removed**, with the code only they used (about 900 lines of server code). 4 unused-by-pages addresses were kept on purpose: the three `/track/…` addresses are reached from links in emails, and `/api/health` is for checking the server is up. The removed ones are listed at the end.
6. **A view-only account no longer sees buttons it cannot use**: Add, Import, Reorder, Barcodes and Images on Inventory; Add supplier and order Notes on Suppliers; Add product on the Dashboard; the count boxes and Save count in End of day. The Users page is now for administrators only, so the Users link is gone for managers and viewers, and opening the address sends them to the Dashboard.

### Found by pressing the buttons

7. **Searching Sales history by a customer's name found nothing.** The search looked at the sale number and the cashier, not the Customer column. It now looks at the customer too.
8. **The Sales history export was wrong.** Every date came out as a raw number, every sale showed 0 items, the total was the amount before discount, and a voided sale was written as "completed". It now gives the date and time, cashier, item count, subtotal, discount, total and the true status.
9. **Sale details said "Discount 0%"** on a sale that had a 5% discount (the totals underneath were right). Fixed.
10. **Notices never reached the administrator** for three things: cash put in or taken out of a drawer, a cashier asking for a void, and everything a supplier does in their own login (confirm, ship, change the date, leave a note, propose a price, offer an order). Each notice was addressed to the person who caused it, and those accounts cannot open notifications at all. They are now addressed to the shop. Checked: after the fix the administrator and a manager both saw "Cash put into the till", "Void requested" and "Price change proposed".
11. **Supplier performance said "not confirmed"** for orders the supplier had confirmed in their own login; it only counted the confirm link in the email. It now counts both, and a confirmation the shop recorded by phone.
12. **An administrator could delete, deactivate or demote their own account**, and with one administrator that locks the shop out of user management for good. The server now refuses it ("You cannot remove your own account…", "This is the only administrator account…"), the Delete button is gone from your own row, and your own role box is locked. Checked against the real accounts with the writing switched off: all four attempts refused, nothing changed.
13. **A changed name or profile photo did not show until the next sign-in** in a normal (not "kept signed in") session, and a copy of the details was left behind in the browser. Fixed.
14. **Typing in the Stock planning search before the forecast had loaded caused a script error.** What is typed is now kept and applied when the forecast arrives.
15. **A supplier's name was written into the Reorder list without escaping.** A name containing HTML would have been run by the browser. Fixed.
16. **The two redirect pages** (`analytics.html`, `audit.html`) carried their old content underneath. They are now 15 lines each and only redirect.

## What was pressed in the second pass

A test copy of the server ran on this computer only, using the real routes, the real database and the real mail service, with one guard: an email could leave only if every recipient was one of the owner's own addresses. The accounts were created through the Users page itself. Sign-in was then tested separately on the real local server with those accounts and their real passwords.

- **Suppliers:** add (empty form refused), edit, search, performance, email history, delete.
- **Users:** send code, wrong code refused, weak password refused, create three accounts (manager, cashier, supplier linked to the test supplier), edit, change an email address, resend the confirmation link, deactivate, show deactivated, restore, decline a password reset request, approve one.
- **Inventory:** add (empty form refused), generate barcode, upload a picture, search, details, edit, add and remove stock, download the import template, import a 2-row file, select, bulk adjust, bulk delete, clear selection, the Reorder list, bulk reorder (which created a purchase order and emailed it), the Barcodes and Images tools, delete.
- **Supplier's own login:** confirm an order (no date refused), change the delivery date, leave a note, mark as shipped, propose a price (zero refused), offer an order, edit contact details.
- **Order board:** read the supplier's note and reply, accept a price, accept an offer, mark shipped, cancel an order, receive into stock (3 became 10), mark paid, refresh, email the order again, receive from the Performance dialog.
- **Point of sale:** starting cash, search and add, a typed barcode, plus and minus, more than the stock (cut back to the stock), discount over the limit (cut back to 10%), too little cash (refused), exact and quick cash, charge (four sales), clear, my sales today, ask for a void (no reason refused), cash out and in (no reason refused, more than the drawer refused), end of day ("Not yet" keeps the drawer open; closing balanced to the peso: 1,000 + 1,683 + 50 − 100 = 2,633), selling refused after the count on screen and by the server, reopened by a manager, selling again.
- **Sales history:** search, details, void (no reason refused, twice refused), delete a sale (stock returned), export, date filter, end of day for a test date, reopen.
- **Reports:** all four tabs, every period and grouping button, void request approved (stock returned) and another dismissed, both exports, one product's forecast, the group buttons, the activity log's filters, paging and row details. "Create purchase orders" was pressed up to its confirmation and cancelled.
- **Settings:** save profile (empty name refused), upload and remove a photo, change password (wrong current, mismatch and weak all refused), appearance (pick, save, discard, reset), the two switches, the discount limit (over 100 refused), send test email.
- **Notifications, assistant, sign out:** mark one as read, filter, refresh; one question to the assistant, answered; sign out returned to the sign-in page with nothing left in the browser.

### Real sign-in (real local server)

98 checks, all passed. Among them: a wrong password is refused; the page cookie is HttpOnly and lasts only for the browser session unless "Keep me signed in" is ticked, when it lasts 7 days; the password is never sent back; a manager opens the Dashboard, Inventory and Reports but is sent away from Users and the POS, and is refused all 13 administrator-only actions tried; a cashier is held to the POS and Settings and cannot open another cashier's sale; a supplier is held to their own page and cannot open another supplier's order; a deactivated account's sign-in stops working at once; an account whose email is not confirmed cannot sign in; the reset-password page refuses a made-up link, a mismatch and a weak password, accepts a good one, and the link cannot be used twice; the confirm-email page does the same; opening and confirming a purchase-order email is recorded and shown in the supplier's email history.

After several refused sign-ins in a row (they were part of the test), the server blocked sign-in from this computer for about 13 minutes. That is its protection working. Restarting the local server cleared it.

### Emails really sent: 14

All to the owner's own addresses (`reusorajuan@gmail.com` and `reusorajuan+fetchqa-…@gmail.com`). 5 verification codes, 3 welcome emails, 2 purchase orders, 2 confirm-your-email links, 1 password reset link, 1 test email. The mail service accepted every one. The guard held back nothing, because nothing was addressed to anyone else.

### Clean-up

Everything the test created was removed in one step, after checking group by group that each row belonged to the test: 3 accounts, 1 supplier, 3 products, 5 sales, 3 purchase orders, 14 stock movements, 46 notifications, 87 activity-log rows, and the smaller records hanging off them. The discount limit the test saved was removed too, which puts it back to the built-in 10% it had before.

Row counts were taken for all 23 tables before the test and again after. 22 tables match exactly. Notifications had 2 fewer than before: the system deletes read notices older than 30 days by itself every hour, and afterwards no read notice older than 30 days was left. Products, stock, sales, revenue, suppliers, accounts and purchase orders all show the same totals as before.

Two things the clean-up cannot undo: sale numbers #2581 to #2586 were used by the test, so the next real sale is a few numbers later; and the 14 emails are in your inbox.

## Not pressed, and why

- **Printer and scanner.** Left out, as instructed. Reprint, Print receipt and Connect printer were not pressed. A barcode typed into the scan box did add the product.
- **Mark all read and Clear read** (Notifications). Read state is shared by everyone, so these would have marked your real notices as read and deleted them.
- **Save and Verify** (email settings). It could change the live email set-up.
- **Download backup.** It downloads the whole database. A manager asking for it was refused.
- **The final "send" of Reorder and of Create purchase orders for real products.** Both were pressed up to their confirmation and cancelled, because they would order real products from real suppliers. The same sending was pressed for the test product.
- **Forgot password for an administrator account.** It would have put a working reset link for your account in the test's hands.
- **A few controls that only show more rows or re-sort**: Show more on Inventory, POS, Notifications, Too much stock and Expiry risk; the sort drop-down; pasting an image address; the filter boxes and Generate buttons inside the Barcodes and Images tools; some appearance choices (Light, System, Sans, Mono, Small, Default, Larger).
- **The live site while signed in**, and **phone-size screens** beyond the title check.

## What the Manager role is for

A manager runs the stock and the suppliers without being able to touch accounts or the system's settings.

- **Can:** add, edit, import and delete products; adjust stock; add, edit and delete suppliers; create, email, update, receive and mark purchase orders paid; answer a supplier's price proposals and notes; void and delete sales and decide cashiers' void requests; record a whole-shop cash count and reopen a count; see every report and the dashboard.
- **Cannot:** open Users, create or change accounts, approve password resets, read the activity log, change the email settings, change the discount limit, or download a backup. Those are the administrator's. A manager also cannot sell at the POS; that is the cashier's.

There is no manager account at the moment. The temporary one made for this check was removed.

## Page-by-page function map

Generated from what was recorded in the browser and from what the source says each function calls.

- **Pressed for real** means it was pressed in the second pass with test records, and what happened is written beside it.
- **Pressed** (without "for real") means it only opens, closes, switches or filters, and was pressed on the read-only copy.
- "any signed-in account*" means administrator, manager and viewer. Till and supplier accounts are held to their own short lists.
- The sidebar, the notification bell, the Jump box, the help guide and the assistant are the same on every page, so they are not repeated in each table.

### Dashboard — `dashboard.html` (checked as Administrator)

Loaded with the real data: 12 requests to the server, all answered OK; no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Add product | Goes to `inventory.html` | — | Page exists |
| Recent Sales | View all → | Goes to `sales.html` | — | Page exists |
| Recent Sales | Show 1 more (1 remaining) | `showMoreDashSales()` | none directly (changes the screen, or works through another function) | Pressed for real: 5 rows became 10 |
| Recent Sales | Show less | `showLessDashSales()` | none directly (changes the screen, or works through another function) | Pressed for real: back to 5 rows |
| Needs restocking | View all → | Goes to `inventory.html?filter=reorder` | — | Page exists |
| Expiring products | 0 Within 30 days | `showExpirationProducts('critical')` | none directly (changes the screen, or works through another function) | Pressed: opened expirationModal |
| Expiring products | 0 In 31 to 60 days | `showExpirationProducts('warning')` | none directly (changes the screen, or works through another function) | Pressed: opened expirationModal |
| Expiring products | 0 In 61 to 90 days | `showExpirationProducts('notice')` | none directly (changes the screen, or works through another function) | Pressed: opened expirationModal |
| Purchase orders | View all → | Goes to `suppliers.html` | — | Page exists |
| Purchase orders | Shipped | `advancePO()` | none directly (changes the screen, or works through another function) | Not pressed here; the same address was pressed from the order board (confirmed, shipped, received, cancelled) |
| dialog: schedule Expiring in 61 to 90 days (0 product(s)) | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeExpirationModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: jumpOverlay | esc _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |

Fields you type or choose in (no action of their own):
- page: Ask a question or how to do something…
- dialog: jumpOverlay: Jump to

### Inventory — `inventory.html` (checked as Administrator)

Loaded with the real data: 45 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: productsTableWrap: 10 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Sort: Default Name A → Z Name Z → A Price: Low | `applySortSelect()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| page | Card view | `setInvView('grid')` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| page | Table view | `setInvView('list')` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| page | Add | `openAddProductModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened "Add new product"; an empty form was refused, a filled one was saved (POST /products, 201) |
| page | Import | `openCsvImportModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened "Import Products from CSV" |
| page | Reorder | `autoReorder()` | `GET /api/products/low-stock` (any signed-in account*) | Pressed for real: opened the low-stock list (5 products). Closed without sending, because it would order real products from real suppliers |
| page | Barcodes | `openBarcodeManager()` | none directly (changes the screen, or works through another function) | Pressed for real: opened and listed the products |
| page | Images | `openImageManager()` | none directly (changes the screen, or works through another function) | Pressed for real: opened and listed the products without a picture |
| page | Low stock 5 | `filterLowStock()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| page | All 119 | `setStatusFilter()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Low stock 3 | `setStatusFilter('low')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats |
| page | Out of stock 2 | `setStatusFilter('out')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Expiring soon 0 | `setStatusFilter('expiring')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats |
| page | Expired 14 | `setStatusFilter('expired')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats |
| page | Healthy 102 | `setStatusFilter('in')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats |
| page | Show all products _(hidden until its dialog or state appears)_ | `showAllProducts()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products, 200 products/stats, 200 products/stats |
| page | View _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `viewProductDetails()` | `GET /api/products/:id` (any signed-in account*) | Pressed for real: opened "Product details" with the saved values |
| page | Edit _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `openEditProductModal()` | `GET /api/products/:id` (any signed-in account*) | Pressed for real: opened "Edit product" pre-filled; a price change was saved (PUT /products/:id, 200) |
| page | Stock _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `openStockModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened "Adjust stock" |
| page | Delete _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `deleteProduct()` | `DELETE /api/products/:id` (admin, manager) | Pressed for real: Cancel kept the product; Yes removed it (DELETE /products/:id, 200) |
| page | Product ▲ | `sortBy('name')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Category ▲ | `sortBy('category')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Price ▲ | `sortBy('price')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Stock ▲ | `sortBy('stock')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Expiration ▲ | `sortBy('expiry')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Status ▲ | `sortBy('status')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stock-levels, 200 products |
| page | Show 10 more (109 remaining) | `showMoreProducts()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| page | Bulk reorder _(hidden until its dialog or state appears)_ | `bulkReorder()` | `POST /api/purchase-orders/auto-generate` (admin, manager) | Pressed for real: two confirmations, then a purchase order was created and emailed to the test supplier (POST /purchase-orders/auto-generate, 201) |
| page | Adjust stock _(hidden until its dialog or state appears)_ | `bulkAdjustStock()` | `PUT /api/products/:id/stock` (admin, manager) | Pressed for real: +3 on two selected products (PUT /products/:id/stock twice, 200) |
| page | Delete _(hidden until its dialog or state appears)_ | `bulkDelete()` | `DELETE /api/products/:id` (admin, manager) | Pressed for real: two selected products removed (DELETE twice, 200) |
| page | Clear _(hidden until its dialog or state appears)_ | `clearSelection()` | none directly (changes the screen, or works through another function) | Pressed for real: the selection bar went away |
| dialog: Add new product | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeProductModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Add new product | Generate _(hidden until its dialog or state appears)_ | `generateBarcodeField()` | none directly (changes the screen, or works through another function) | Pressed for real: a barcode was filled in (291597597387) |
| dialog: Add new product | Paste image URL, or upload → _(hidden until its dialog or state appears)_ | `updateImagePreview()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Add new product | imageFile _(hidden until its dialog or state appears)_ | `handleFormImageFile()` | none directly (changes the screen, or works through another function) | Pressed for real: a picture file was accepted ("Image ready") |
| dialog: Add new product | Upload _(hidden until its dialog or state appears)_ | `getElementById('imageFile')` | none directly (changes the screen, or works through another function) | Pressed for real: a picture was chosen, shown, and saved with the record |
| dialog: Add new product | Save product _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real (see Add and Edit above) |
| dialog: Product details | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeProductDetailsModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Product details | Edit _(hidden until its dialog or state appears)_ | `editProduct()` | none directly (changes the screen, or works through another function) | Pressed for real: opened "Edit product" from the details dialog |
| dialog: Product details | Delete _(hidden until its dialog or state appears)_ | `deleteFromDetails()` | none directly (changes the screen, or works through another function) | Not pressed itself; it calls the same delete as the row's Delete button, which was pressed |
| dialog: Adjust stock | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeStockModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Adjust stock | Save adjustment _(hidden until its dialog or state appears)_ | `saveStockAdjustment()` | `PUT /api/products/:id/stock` (admin, manager) | Pressed for real: added and removed stock (PUT /products/:id/stock, 200); the stock changed by exactly what was typed |
| dialog: file_upload Import Products from CSV | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeCsvImportModal()` | none directly (changes the screen, or works through another function) | Pressed for real: the dialog closed |
| dialog: file_upload Import Products from CSV | Download template _(hidden until its dialog or state appears)_ | `downloadCsvTemplate()` | none directly (changes the screen, or works through another function) | Pressed for real: the template file was produced (product_import_template.csv, 2 lines) |
| dialog: file_upload Import Products from CSV | Import products _(hidden until its dialog or state appears)_ | `importCsvProducts()` | `GET /api/products/categories` (any signed-in account*)<br>`POST /api/products/bulk` (admin, manager) | Pressed for real: a 2-row file was imported (POST /products/bulk, 201, "Created 2 product(s)") |
| dialog: barcode_scanner Assign barcodes | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeBarcodeManager()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| dialog: barcode_scanner Assign barcodes | Filter products… _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `renderBarcodeManagerList()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: barcode_scanner Assign barcodes | Generate _(and 112 more like it)_ _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| dialog: image Product images | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeImageManager()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| dialog: image Product images | Filter products… _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `renderImageManagerList()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: image Product images | (no label) _(and 80 more like it)_ _(hidden until its dialog or state appears)_ | `handleManagerImageFile()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |

Fields you type or choose in (no action of their own):
- page: Search name, SKU, or barcode..., All Categories AccessoriesCages & HabitatsFoodHealth & WellnessLitter , All Species Dog Cat Bird Fish, selectAll, Ask a question or how to do something…
- dialog: Add new product: sku, Scan or enter barcode, name, brand, Select Category AccessoriesCages & HabitatsFoodHealth & WellnessLitter, Select Species Dog Cat Bird Fish, Any Size Small Medium Large Giant, All Ages Puppy/Kitten Adult Senior, None Dietary Dental Joint Care Skin & Coat Digestive, unit_price, cost_price, stock_quantity, reorder_level, Piece (pcs) Kilogram (kg) Gram (g) Liter (L) Milliliter (mL), max_stock_level, Select Supplier Roger EnteriaSupplier 1, e.g., LOT-2025-001, expiration_date, Product description...
- dialog: Adjust stock: Add Stock (In) Remove Stock (Out) Adjustment Damage, stockQuantity, Reason for adjustment
- dialog: file_upload Import Products from CSV: csvFile
- dialog: barcode_scanner Assign barcodes: Scan or type…
- dialog: image Product images: Paste URL…

Search boxes and filters tried: typing "dog" in `searchInput` gave 10 rows (was 10).

### Sales history — `sales.html` (checked as Administrator)

Loaded with the real data: 13 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: table: 10 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | End of day | `openEodModal()` | none directly (changes the screen, or works through another function) | Pressed: opened eodModal |
| page | Export CSV | `exportSalesCsv()` | `GET /api/sales` (any signed-in account*) | Pressed for real: the file was produced (2,346 lines) with readable dates, item counts and the true status |
| page | Filter | `filterSalesByDate()` | none directly (changes the screen, or works through another function) | Pressed for real: today only, then all again |
| page | Clear | `clearDateFilter()` | none directly (changes the screen, or works through another function) | Pressed for real: the filter was cleared |
| page | View _(and 9 more like it)_ | `viewSaleDetails()` | `GET /api/sales/:id` (any signed-in account*) | Pressed: loaded 200 sales/eod |
| page | Void _(and 7 more like it)_ | `voidSale()` | `POST /api/sales/:id/void` (admin, manager) | Pressed for real: no reason was refused; with a reason the sale was voided and its items returned to stock (POST /sales/:id/void, 200). A second void of the same sale was refused |
| page | Show 10 more (2331 remaining) | `showMoreSales()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 sales |
| dialog: Sale details | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeViewSaleModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Sale details | Print receipt _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `printReceipt()` | `GET /api/sales/:id` (any signed-in account*) | Left out: printer |
| dialog: Sale details | Delete sale _(hidden until its dialog or state appears)_ | `deleteSaleFromDetail()` | none directly (changes the screen, or works through another function) | Pressed for real: a test sale of 12 items was deleted and its stock returned (DELETE /sales/:id, 200; stock 19 became 31) |
| dialog: End of day cash count (whole shop) | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeEodModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: End of day cash count (whole shop) | eodDate _(hidden until its dialog or state appears)_ | `loadEod()` | `GET /api/sales/eod` (any signed-in account*) | Pressed for real: changing the date reloaded the figures for that day |
| dialog: End of day cash count (whole shop) | 0.00 _(hidden until its dialog or state appears)_ | `updateEodDiff()` | none directly (changes the screen, or works through another function) | Pressed for real: typing a count showed "Over by ₱25.00" at once |
| dialog: End of day cash count (whole shop) | Reopen _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `reopenCount()` | `DELETE /api/sales/eod/:id` (admin, manager) | Pressed for real: the cashier's count and two test counts were reopened (DELETE /sales/eod/:id, 200); the cashier could sell again |
| dialog: End of day cash count (whole shop) | Save count _(hidden until its dialog or state appears)_ | `saveEod()` | `POST /api/sales/eod` (admin, manager, cashier) | Pressed for real: a whole-shop count was saved for a test date (POST /sales/eod, 200), then reopened |

Fields you type or choose in (no action of their own):
- page: Search sales..., dateFrom, dateTo, Ask a question or how to do something…
- dialog: End of day cash count (whole shop): e.g. ₱200 used for water delivery

Search boxes and filters tried: typing "dog" in `searchInput` gave 4 rows (was 23).

### Suppliers — `suppliers.html` (checked as Administrator)

Loaded with the real data: 7 requests to the server, all answered OK except the email history, which the read-only copy does not carry (it answered on the real server); no script errors; nothing left loading. Tables on screen: supplierTableWrap: 2 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Suppliers | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: switched to the supplier list |
| page | Orders 0 | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: switched to the order board |
| page | Add supplier | `openAddSupplierModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened "Add supplier"; an empty form was refused, a filled one was saved (POST /suppliers, 201) |
| Orders on the way | Refresh _(hidden until its dialog or state appears)_ | `refreshDeliveries()` | none directly (changes the screen, or works through another function) | Pressed for real: "Orders refreshed" |
| Orders on the way | Receive into stock _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the order was received and its items added to stock (3 became 10) |
| Orders on the way | Notes _(and 2 more like it)_ _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the other side's note was shown and a reply was sent |
| Orders on the way | Mark shipped _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: order marked shipped (PUT /purchase-orders/:id/status, 200) |
| Orders on the way | Cancel order _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: order cancelled (PUT /purchase-orders/:id/status, 200) |
| page | bruzieozie@gmail.com _(and 3 more like it)_ | `showEmailLogs()` | `GET /api/email-logs/:supplierId` (any signed-in account*) | Pressed for real: opened. On the real server the list loaded (200) and showed the test email as opened and confirmed |
| page | Performance _(and 1 more like it)_ | `showPerformance()` | `GET /api/suppliers/:id/performance` (any signed-in account*) | Pressed for real: opened with the supplier's orders; from it an order was emailed again and another was received |
| page | Edit _(and 1 more like it)_ | `openEditSupplierModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened pre-filled; a phone change was saved (PUT /suppliers/:id, 200) |
| page | Delete _(and 1 more like it)_ | `deleteSupplier()` | `DELETE /api/suppliers/:id` (admin, manager) | Pressed for real: the test supplier was removed (DELETE /suppliers/:id, 200) |
| dialog: Roger Enteria Performance | × _(hidden until its dialog or state appears)_ | `closePerformanceModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Roger Enteria Performance | Shipped _(hidden until its dialog or state appears)_ | `advancePOFromModal()` | none directly (changes the screen, or works through another function) | Pressed for real: a shipped test order was received from this dialog (PUT /purchase-orders/:id/status, 200) |
| dialog: Roger Enteria Performance | Email _(and 10 more like it)_ _(hidden until its dialog or state appears)_ | `emailPOFromModal()` | none directly (changes the screen, or works through another function) | Pressed for real: the order was emailed again to the test supplier (POST /purchase-orders/:id/send-email, 200) |
| dialog: Edit supplier | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeSupplierModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Edit supplier | Save supplier _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real (see Add supplier and Edit above) |
| dialog: mark_email_read Email History — Roger Enteria | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeEmailLogsModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |

Fields you type or choose in (no action of their own):
- page: Search suppliers..., Ask a question or how to do something…
- dialog: Edit supplier: name, contact_person, email, phone, Street address, city, Net 15 Net 30 Net 60 Due on Receipt

Search boxes and filters tried: typing "dog" in `searchInput` gave 13 rows (was 14).

### Reports — `reports.html` (checked as Administrator)

Loaded with the real data: 7 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: salesTable: 20 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Sales | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | Stock planning | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | Void requests0 | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: opened the Void requests tab (it showed the two test requests while they were waiting) |
| page | Activity log | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| Revenue by day | Last 7 days _(and 1 more like it)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the report reloaded (7 rows) |
| Revenue by day | This month | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the report reloaded |
| Revenue by day | All time | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the report reloaded |
| Revenue by day | Custom | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the two date boxes appeared |
| Revenue by day | Day | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: grouped by day |
| Revenue by day | Week | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: grouped by week |
| Revenue by day | Month | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: grouped by month |
| Revenue by day | Export CSV | `exportCSV()` | none directly (changes the screen, or works through another function) | Pressed for real: the file was produced (sales_by_day, 33 lines) |
| Revenue by day | Apply _(hidden until its dialog or state appears)_ | `applyDateRange()` | none directly (changes the screen, or works through another function) | Pressed for real: the sales report reloaded |
| Sales breakdown | Show 10 more (10 remaining) | `showMoreReport()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| Sales breakdown | Show less | `showLessReport()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| What to reorder | Refresh _(hidden until its dialog or state appears)_ | `refreshAnalytics()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 predictions/trends |
| What to reorder | Export list _(hidden until its dialog or state appears)_ | `exportReorderCSV()` | none directly (changes the screen, or works through another function) | Pressed for real: the file was produced (reorder_list, 6 lines) |
| What to reorder | Create purchase orders _(hidden until its dialog or state appears)_ | `createPlannedOrders()` | `POST /api/purchase-orders/auto-generate` (admin, manager) | Pressed for real up to its confirmation, then cancelled, because it would order real products from real suppliers |
| Too much stock | Show 10 more (102 remaining) _(hidden until its dialog or state appears)_ | `showMoreExcess()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Expiry risk | Show 5 more (5 remaining) _(hidden until its dialog or state appears)_ | `showMoreExpiry()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| All products | All 119 _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the list showed that group |
| All products | Selling fast 31 _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the list showed that group |
| All products | Selling steadily 55 _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the list showed that group |
| All products | Selling slowly 33 _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the list showed that group |
| All products | Not selling 0 _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the list showed that group |
| All products | Show 10 more (109 remaining) _(hidden until its dialog or state appears)_ | `showMorePredictions()` | none directly (changes the screen, or works through another function) | Pressed for real: more rows were shown |
| Product forecast | Close _(hidden until its dialog or state appears)_ | `closeProductDetail()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| Void requests | Refresh _(hidden until its dialog or state appears)_ | `loadVoidRequests()` | `GET /api/sales/void-requests` (admin, manager) | Ran when the Void requests tab was opened: the list showed the two test requests. The Refresh button itself was not pressed |
| Activity log | All actions Created Updated Deleted Signed in _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `loadAuditLogs()` | `GET /api/audit-logs` (admin) | Pressed for real: both filters reloaded the list |
| Activity log | Refresh _(hidden until its dialog or state appears)_ | `refreshAudit()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 audit-logs |
| Activity log | User Logged in on users by Juan Carlo 9m ago _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `toggleDetail()` | none directly (changes the screen, or works through another function) | Pressed for real: a row opened to show its details |
| Activity log | ‹ Prev _(and 4 more like it)_ _(hidden until its dialog or state appears)_ | `goToPage()` | none directly (changes the screen, or works through another function) | Pressed for real: page 2 of the activity log loaded |

Fields you type or choose in (no action of their own):
- Revenue by day: startDate, endDate
- All products: Search products
- page: Ask a question or how to do something…

### Users — `users.html` (checked as Administrator)

Loaded with the real data: 6 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: usersTable: 4 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | showInactive | `loadUsers()` | `GET /api/auth/users` (admin) | Pressed for real: ticking "Show deactivated" listed the deactivated account, with a Restore button that worked |
| page | Add user | `openAddUserModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened "Add new user"; three accounts were created (POST /auth/register, 201) |
| page | Edit _(and 3 more like it)_ | `openEditUserModal()` | none directly (changes the screen, or works through another function) | Pressed for real: opened pre-filled with the username locked; a name and an email change were saved (PUT /auth/users/:id, 200) |
| page | Delete _(and 2 more like it)_ | `deleteUser()` | `DELETE /api/auth/users/:id` (admin) | Pressed for real: the account was deactivated (DELETE /auth/users/:id, 200) and left the list |
| dialog: Edit user | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeUserModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Edit user | userEmail _(hidden until its dialog or state appears)_ | `onEmailChanged()` | none directly (changes the screen, or works through another function) | Pressed for real: typing an address readied the Send code button |
| dialog: Edit user | Send code _(hidden until its dialog or state appears)_ | `sendEmailCode()` | `POST /api/auth/email-code` (admin) | Pressed for real: a 6-digit code was emailed (POST /auth/email-code, 200). A wrong code was refused; the right one was accepted |
| dialog: Edit user | - - - - - - _(hidden until its dialog or state appears)_ | `onCodeTyped()` | none directly (changes the screen, or works through another function) | Pressed for real: typing the code enabled Create user |
| dialog: Edit user | Staff — point of sale only Manager — inventory _(hidden until its dialog or state appears)_ | `refreshRoleFields()` | none directly (changes the screen, or works through another function) | Pressed for real: choosing Supplier showed the supplier list |
| dialog: Edit user | Update user _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: changes saved (PUT /auth/users/:id, 200) |

Fields you type or choose in (no action of their own):
- page: Search users..., Ask a question or how to do something…
- dialog: Edit user: userFullName, Usernames cannot be changed, userPassword, Choose a supplier Roger EnteriaSupplier 1Roger EnteriaSupplier 1

Search boxes and filters tried: typing "dog" in `searchInput` gave 1 rows (was 4).

### Notifications — `notifications.html` (checked as Administrator)

Loaded with the real data: 7 requests to the server, all answered OK except the start-up alert check, which the read-only copy refuses because it saves (it answered on the real server); no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Mark all read | `markAllRead()` | `PUT /api/notifications/read-all` (any signed-in account*) | Not pressed: it would mark your real shared notices as read for everyone |
| page | Clear read | `clearRead()` | none directly (changes the screen, or works through another function) | Not pressed: it would delete your real read notices |
| page | Refresh | `refreshList()` | none directly (changes the screen, or works through another function) | Pressed for real: the list reloaded |
| page | All Types Low Stock Stock Out Expiration Overs _(and 1 more like it)_ | `applyNotifFilters()` | none directly (changes the screen, or works through another function) | Pressed for real: the status filter reloaded the list |
| page | Mark as read _(and 9 more like it)_ | `markAsRead()` | `PUT /api/notifications/:id/read` (any signed-in account*) | Pressed for real: one test notice was marked read (PUT /notifications/:id/read, 200) |
| page | Show 10 more (145 remaining) | `showMoreNotifications()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |

Fields you type or choose in (no action of their own):
- page: Ask a question or how to do something…

### Settings — `settings.html` (checked as Administrator)

Loaded with the real data: 4 requests to the server, all answered OK; no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Profile | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | Password | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | Preferences | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | Session | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | Email | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real |
| page | avatarFile _(hidden until its dialog or state appears)_ | `handleAvatarFile()` | none directly (changes the screen, or works through another function) | Pressed for real: a photo was chosen and saved (PUT /auth/profile, 200) |
| page | Upload photo | `getElementById('avatarFile')` | none directly (changes the screen, or works through another function) | Pressed for real: a picture was chosen, shown, and saved with the record |
| page | Remove _(hidden until its dialog or state appears)_ | `removeAvatar()` | none directly (changes the screen, or works through another function) | Pressed for real: the photo was removed (PUT /auth/profile, 200) |
| page | Save changes | `saveProfile()` | `PUT /api/auth/profile` (any signed-in account*) | Pressed for real: an empty name was refused; a new name was saved and put back (PUT /auth/profile, 200) |
| page | Update password _(hidden until its dialog or state appears)_ | `changePassword()` | `PUT /api/auth/change-password` (any signed-in account*) | Pressed for real: wrong current password, mismatched and weak passwords were refused; the right one was saved (PUT /auth/change-password, 200) and the old password stopped working |
| page | Save limit _(hidden until its dialog or state appears)_ | `savePosSettings()` | `PUT /api/sales/pos-settings` (admin) | Pressed for real: the same limit was saved again (PUT /sales/pos-settings, 200); a limit above 100 was refused |
| page | Download backup _(hidden until its dialog or state appears)_ | `downloadBackup()` | `GET /api/backup` (admin) | Not pressed: it downloads the whole database. A manager was refused it (403) |
| page | System _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Light _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Dark _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: saved as dark |
| page | Risha _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed |
| page | Navy & Sky _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed and were saved |
| page | Red & Sunshine _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed |
| page | Green & Gold _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed |
| page | Teal & Orange _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed, then Discard put them back |
| page | Purple & Pink _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed |
| page | Charcoal & Blue _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the colours changed |
| page | Sans _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Serif _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: saved as serif |
| page | Mono _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Small _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Default _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Large _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: saved as large |
| page | Larger _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Reset _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: everything went back to the default |
| page | Discard _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the unsaved change was undone |
| page | Save changes _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: "Appearance saved" |
| page | Save & Verify _(hidden until its dialog or state appears)_ | `saveEmailSettings()` | `PUT /api/email-settings` (admin) | Not pressed: it could change the live email set-up |
| page | Send test email _(hidden until its dialog or state appears)_ | `sendTestEmail()` | `POST /api/email-settings/test` (admin) | Pressed for real: a test email went to your own address (POST /email-settings/test, 200) |

Fields you type or choose in (no action of their own):
- page: Your full name, your@email.com, username, Enter current password, Enter new password, Confirm new password, posMaxDiscountInput, settingsNotifToggle, settingsSidebarToggle, emailEnabledToggle, yourshop@gmail.com, •••••••• (saved — leave blank to keep), RISHA Pet Supplies, you@example.com, Ask a question or how to do something…

### Point of sale — `pos.html` (checked as Staff (cashier))

Loaded with the real data: 12 requests to the server, all answered OK; no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Connect printer | `connectThermalPrinter()` | none directly (changes the screen, or works through another function) | Left out: printer |
| page | My sales today | `openMySales()` | none directly (changes the screen, or works through another function) | Pressed: opened posMySalesModal; loaded 200 sales/mine |
| page | Cash in / out | `openPosCash()` | `GET /api/sales/till/cash` (cashier) | Pressed: opened posCashModal; loaded 200 sales/till/cash |
| page | End of day | `openPosEod()` | `GET /api/sales/eod` (any signed-in account*) | Pressed: opened posEodModal |
| page | Search products | `filterProducts()` | none directly (changes the screen, or works through another function) | Typed "dog": 11 rows shown (was 11), no errors |
| page | All products105 _(and 7 more like it)_ | `filterByCategory()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 sales/eod, 200 products |
| page | Health & Wellness1 BOX SMP 23 left ₱120.00 Add _(and 9 more like it)_ | `addToCart()` | none directly (changes the screen, or works through another function) | Pressed for real: added from the list and by typing a barcode; a sold-out product was refused |
| page | Show 10 more (95 remaining) | `showMorePosProducts()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Current sale | Clear _(hidden until its dialog or state appears)_ | `clearCart()` | none directly (changes the screen, or works through another function) | Pressed for real: "Cart cleared" |
| Current sale | Discount percent | `updateCartTotals()` | none directly (changes the screen, or works through another function) | Pressed for real: 5% took ₱11.00 off ₱220.00; 50% was cut back to the 10% limit |
| Current sale | 0.00 _(hidden until its dialog or state appears)_ | `updateChange()` | none directly (changes the screen, or works through another function) | Pressed for real: typing the cash received showed the change |
| Current sale | Exact _(hidden until its dialog or state appears)_ | `quickCash('exact')` | none directly (changes the screen, or works through another function) | Pressed for real: Exact filled the total; +100 showed ₱100.00 change |
| Current sale | +20 _(and 4 more like it)_ _(hidden until its dialog or state appears)_ | `quickCash()` | none directly (changes the screen, or works through another function) | Pressed for real: Exact filled the total; +100 showed ₱100.00 change |
| Current sale | Charge₱0.00 | `completeSale()` | `POST /api/sales` (cashier) | Pressed for real: too little cash was refused; otherwise the sale was saved (POST /sales, 201). After the count it was refused (drawer closed) |
| dialog: Starting cash | Cancel _(hidden until its dialog or state appears)_ | `closePosOpen()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Starting cash | Save starting cash _(hidden until its dialog or state appears)_ | `savePosOpen()` | `POST /api/sales/till/open` (cashier) | Pressed for real: starting cash saved (POST /sales/till/open, 200) |
| dialog: My sales today | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeMySales()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: My sales today | Reprint _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Left out: printer |
| dialog: My sales today | Ask for void _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: no reason was refused; with a reason the request was sent (POST /sales/:id/void-request, 200) and the button left that row |
| dialog: End of day cash count | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closePosEod()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: End of day cash count | Change _(hidden until its dialog or state appears)_ | `changePosOpen()` | none directly (changes the screen, or works through another function) | Pressed for real: reopened the starting-cash dialog with the saved amount |
| dialog: End of day cash count | Save count and close drawer _(hidden until its dialog or state appears)_ | `savePosEod()` | `POST /api/sales/eod` (admin, manager, cashier) | Pressed for real: "Not yet" kept the drawer open; "Close the drawer" saved the count (POST /sales/eod, 200) and it balanced to the peso |
| dialog: Cash in or out of the drawer | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closePosCash()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Cash in or out of the drawer | Taken out _(hidden until its dialog or state appears)_ | `setPosCashKind('out')` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Cash in or out of the drawer | Put in _(hidden until its dialog or state appears)_ | `setPosCashKind('in')` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Cash in or out of the drawer | Record cash put in _(hidden until its dialog or state appears)_ | `savePosCash()` | `POST /api/sales/till/cash` (cashier) | Pressed for real: no reason was refused; ₱100 out and ₱50 in were recorded (POST /sales/till/cash, 200); more than the drawer holds was refused |

Fields you type or choose in (no action of their own):
- page: Scan barcode
- Current sale: Customer name, optional, Customer phone, optional
- dialog: Starting cash: posOpenAmount
- dialog: End of day cash count: posEodCounted, For example: ₱200 used for water delivery
- dialog: Cash in or out of the drawer: 0.00, For example: Owner added coins for change

Search boxes and filters tried: typing "dog" in `posSearchInput` gave 11 rows (was 11).

### Supplier portal — `supplier.html` (checked as Supplier)

Loaded with the real data: 4 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: table: 1 rows, table: 4 rows, table: 10 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| Open orders | Offer an order | `openOffer()` | `POST /api/supplier-portal/offers` (supplier) | Pressed for real: an offer was sent to the shop (POST /supplier-portal/offers, 201) |
| Open orders | Mark as shipped | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: order marked shipped with a receipt number (POST /supplier-portal/orders/:id/ship, 200) |
| Open orders | Change delivery date | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: new date and reason saved (PUT /supplier-portal/orders/:id/promise, 200) |
| Open orders | Notes | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: the other side's note was shown and a reply was sent |
| Products you supply | Change price _(and 3 more like it)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real: zero was refused; ₱65.00 was proposed (POST /supplier-portal/products/:id/price, 200) and the shop accepted it |
| Your details | Edit contact details | `openDetails()` | `PUT /api/supplier-portal/me` (supplier) | Pressed for real: contact details were changed and saved (PUT /supplier-portal/me, 200) |
| dialog: Edit contact details | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeSpModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Edit contact details | Save details _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | Pressed for real (PUT /supplier-portal/me, 200) |

Fields you type or choose in (no action of their own):
- dialog: Edit contact details: spContact, spPhone, spAddress, spCity

## Every server address

102 addresses. "Used by" names the script that calls it.

| Address | Who may use it | Used by |
|---|---|---|
| `GET /api/assistant/status` | any signed-in account* | assistant.js |
| `POST /api/assistant` | any signed-in account* | assistant.js |
| `GET /api/audit-logs` | admin | audit.js |
| `POST /api/auth/login` | anyone (no sign-in) | login.html |
| `POST /api/auth/forgot-password` | anyone (no sign-in) | login.html |
| `POST /api/auth/reset-password` | anyone (no sign-in) | reset-password.html |
| `POST /api/auth/verify-email` | anyone (no sign-in) | verify-email.html |
| `POST /api/auth/resend-verification` | anyone (no sign-in) | login.html |
| `POST /api/auth/logout` | anyone (no sign-in) | auth.js |
| `POST /api/auth/email-code` | admin | users.js |
| `POST /api/auth/register` | admin | users.js |
| `GET /api/auth/verify` | any signed-in account* | auth.js |
| `GET /api/auth/users` | admin | users.js |
| `PUT /api/auth/users/:id` | admin | users.js |
| `PUT /api/auth/users/:id/status` | admin | users.js |
| `POST /api/auth/users/:id/resend-verification` | admin | users.js |
| `DELETE /api/auth/users/:id` | admin | users.js |
| `GET /api/auth/reset-requests` | admin | users.js |
| `POST /api/auth/reset-requests/:id/:decision` | admin | users.js |
| `PUT /api/auth/profile` | any signed-in account* | settings.js |
| `PUT /api/auth/change-password` | any signed-in account* | settings.js |
| `GET /api/dashboard/stats` | any signed-in account* | dashboard.js |
| `GET /api/dashboard/charts` | any signed-in account* | dashboard.js |
| `GET /api/dashboard/expiration-risk` | any signed-in account* | dashboard.js |
| `GET /api/email-settings` | admin | settings.js |
| `PUT /api/email-settings` | admin | settings.js |
| `POST /api/email-settings/test` | admin | settings.js |
| `GET /api/notifications` | any signed-in account* | auth.js, notifications.js |
| `GET /api/notifications/summary` | any signed-in account* | notifications.js |
| `GET /api/notifications/count` | any signed-in account* | auth.js, dashboard.js |
| `PUT /api/notifications/read-all` | any signed-in account* | auth.js, notifications.js |
| `PUT /api/notifications/:id/read` | any signed-in account* | auth.js, notifications.js |
| `DELETE /api/notifications/read` | any signed-in account* | notifications.js |
| `GET /api/predictions/product/:id` | any signed-in account* | analytics.js |
| `GET /api/predictions/overview` | any signed-in account* | analytics.js |
| `GET /api/predictions/trends` | any signed-in account* | analytics.js |
| `GET /api/products` | any signed-in account* | auth.js, dashboard.js, inventory.js, jump.js, pos.js |
| `GET /api/products/stock-levels` | any signed-in account* | inventory.js, pos.js |
| `GET /api/products/stats` | any signed-in account* | inventory.js |
| `GET /api/products/low-stock` | any signed-in account* | dashboard.js, inventory.js |
| `GET /api/products/categories` | any signed-in account* | inventory.js, pos.js |
| `GET /api/products/:id` | any signed-in account* | inventory.js |
| `POST /api/products` | admin, manager | inventory.js |
| `POST /api/products/bulk` | admin, manager | inventory.js |
| `PUT /api/products/:id` | admin, manager | inventory.js |
| `PUT /api/products/:id/stock` | admin, manager | inventory.js |
| `DELETE /api/products/:id` | admin, manager | inventory.js |
| `GET /api/purchase-orders` | any signed-in account* | dashboard.js |
| `GET /api/purchase-orders/deliveries` | any signed-in account* | supply-board.js |
| `POST /api/purchase-orders/price-proposals/:id/decide` | admin, manager | supply-board.js |
| `GET /api/purchase-orders/:id/messages` | admin, manager | supply-board.js |
| `POST /api/purchase-orders/:id/messages` | admin, manager | supply-board.js |
| `PUT /api/purchase-orders/:id/payment` | admin, manager | supply-board.js |
| `POST /api/purchase-orders/auto-generate` | admin, manager | analytics.js, inventory.js |
| `PUT /api/purchase-orders/:id/status` | admin, manager | dashboard.js, suppliers.js, supply-board.js |
| `POST /api/purchase-orders/:id/send-email` | admin, manager | suppliers.js |
| `GET /api/sales` | any signed-in account* | dashboard.js, point-of-sale.js |
| `GET /api/sales/stats` | any signed-in account* | point-of-sale.js |
| `GET /api/sales/daily-sales` | any signed-in account* | dashboard.js |
| `GET /api/sales/report` | any signed-in account* | reports.js |
| `GET /api/sales/till` | cashier | pos.js |
| `POST /api/sales/till/open` | cashier | pos.js |
| `GET /api/sales/till/cash` | cashier | pos.js |
| `POST /api/sales/till/cash` | cashier | pos.js |
| `GET /api/sales/mine` | cashier | pos.js |
| `GET /api/sales/void-requests` | admin, manager | reports.js |
| `GET /api/sales/pos-settings` | admin, manager | settings.js |
| `PUT /api/sales/pos-settings` | admin | settings.js |
| `DELETE /api/sales/eod/:id` | admin, manager | point-of-sale.js |
| `GET /api/sales/eod` | any signed-in account* | point-of-sale.js, pos.js |
| `GET /api/sales/eod/history` | any signed-in account* | point-of-sale.js |
| `POST /api/sales/eod` | admin, manager, cashier | point-of-sale.js, pos.js |
| `GET /api/sales/:id` | any signed-in account* | point-of-sale.js, pos.js |
| `POST /api/sales/:id/void` | admin, manager | point-of-sale.js, reports.js |
| `POST /api/sales/:id/void-request` | cashier | pos.js |
| `POST /api/sales/:id/void-request/dismiss` | admin, manager | reports.js |
| `POST /api/sales` | cashier | pos.js |
| `DELETE /api/sales/:id` | admin, manager | point-of-sale.js |
| `GET /api/supplier-portal/me` | supplier | supplier-portal.js |
| `PUT /api/supplier-portal/me` | supplier | supplier-portal.js |
| `GET /api/supplier-portal/products` | supplier | supplier-portal.js |
| `POST /api/supplier-portal/products/:id/price` | supplier | supplier-portal.js |
| `GET /api/supplier-portal/orders` | supplier | supplier-portal.js |
| `POST /api/supplier-portal/orders/:id/confirm` | supplier | supplier-portal.js |
| `PUT /api/supplier-portal/orders/:id/promise` | supplier | supplier-portal.js |
| `POST /api/supplier-portal/orders/:id/ship` | supplier | supplier-portal.js |
| `GET /api/supplier-portal/orders/:id/messages` | supplier | supplier-portal.js |
| `POST /api/supplier-portal/orders/:id/messages` | supplier | supplier-portal.js |
| `POST /api/supplier-portal/offers` | supplier | supplier-portal.js |
| `GET /api/supplier-portal/scorecard` | supplier | supplier-portal.js |
| `GET /api/suppliers` | any signed-in account* | auth.js, inventory.js, jump.js, suppliers.js, users.js |
| `GET /api/suppliers/:id/performance` | any signed-in account* | suppliers.js |
| `POST /api/suppliers` | admin, manager | suppliers.js |
| `PUT /api/suppliers/:id` | admin, manager | suppliers.js |
| `DELETE /api/suppliers/:id` | admin, manager | suppliers.js |
| `GET /api/backup` | admin | settings.js |
| `GET /track/:trackingId.gif` | anyone (no sign-in) | _no page uses it_ |
| `POST /track/confirm/:trackingId` | anyone (no sign-in) | _no page uses it_ |
| `GET /track/click/:trackingId` | anyone (no sign-in) | _no page uses it_ |
| `GET /api/email-logs/:supplierId` | any signed-in account* | suppliers.js |
| `GET /api/health` | anyone (no sign-in) | _no page uses it_ |
| `POST /api/notifications/check-alerts` | any signed-in account* | notifications.js |

## The 28 addresses that were removed

No page, email or other part of the system called them.

- `GET /api/auth/users/:id`
- `PUT /api/auth/users/:id/role`
- `GET /api/notifications/unread`
- `GET /api/notifications/alerts`
- `POST /api/notifications`
- `DELETE /api/notifications/old`
- `DELETE /api/notifications/:id`
- `GET /api/predictions/all`
- `GET /api/predictions/summary`
- `GET /api/products/expiring`
- `GET /api/products/overstock`
- `GET /api/products/barcode`
- `GET /api/products/suppliers`
- `GET /api/products/species`
- `GET /api/purchase-orders/:id`
- `POST /api/purchase-orders`
- `DELETE /api/purchase-orders/:id`
- `GET /api/sales/weekly-sales`
- `GET /api/sales/monthly-sales`
- `GET /api/sales/total-sales`
- `GET /api/sales/top-products`
- `PUT /api/sales/:id`
- `GET /api/suppliers/geocode`
- `GET /api/suppliers/shop-location`
- `PUT /api/suppliers/shop-location`
- `GET /api/suppliers/:id`
- `POST /api/suppliers/:id/performance`
- `GET /api/email-logs`
