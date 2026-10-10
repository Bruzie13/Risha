# FETCH: full system check

Date: 10 October 2026. Branch checked: `pro-redesign` (the live site runs the same code, minus the three fixes listed below).

Every number and every "works" in this file comes from a check that was actually run. Anything that was not run is listed under "Not checked" with the reason. Nothing here is from memory.

## How the checking was done

| # | Check | How | Result |
|---|---|---|---|
| 1 | Every request a page sends has a server address that answers it | Read all 15 pages and 21 scripts, matched each request to the server's route list | 141 of 141 match |
| 2 | Every button's function exists on the page that uses it | Read every `onclick`, `onchange`, `oninput` in the pages and in the HTML the scripts write | 409 calls checked, 1 missing (see "Leftovers") |
| 3 | Every link goes to a page that exists | Read every link in pages and scripts | 161 of 161 |
| 4 | Every stylesheet, script and image a page loads exists | Checked each file on disk | 145 of 145 |
| 5 | Nothing protected answers without a sign-in | Asked all 120 protected server addresses with no sign-in, on the real local server | 120 of 120 refused (401) |
| 6 | A made-up sign-in token is refused | Asked all 64 protected read addresses with a fake token | 64 of 64 refused (403) |
| 7 | Pages are not served without a sign-in | Asked for all 15 pages with no sign-in | 12 sent to the sign-in page; the 3 public ones (sign in, reset password, verify email) open |
| 8 | Reading the real data works, for each kind of account | Called all 60 read addresses as administrator, viewer, cashier and supplier through a read-only copy of the server (240 calls) | 240 of 240 as expected: allowed ones returned data, the rest were refused |
| 9 | One account cannot read another's records | Supplier asked for another supplier's order; cashier asked for another person's sale | Refused (404 and 403) |
| 10 | Each page loads and its controls respond, with the real data | Opened 10 pages in a browser through the read-only copy, listed every control (1,323), and pressed the ones that only look, open, switch, sort or filter | 136 server requests, 0 script errors. 62 different functions pressed (54 by the checker, 8 by hand), plus the 4 Reports tabs, the 5 Settings tabs and the 7 colour combinations. All responded |
| 11 | Automated tests | `npm test` in `backend/` | 111 of 111 pass |
| 12 | Selling flow | Pressed through on a preview copy with sample data earlier today, before the last deploy | Add to cart, charge with change, cash in/out, refusing a cash-out larger than the drawer, "Not yet", closing the drawer, selling blocked after, reopening: all passed |

"Read-only copy of the server" means: the real routes, controllers and database, on this computer only, with every request that is not a read refused before it reaches a route. Nothing could be saved, sent or deleted through it. During the whole check it refused 3 writes, all the same one: the Notifications page asking the server to refresh its alerts when it opens.

## Problems found and fixed in this pass

These are on this computer only. They are not on the live site until deployed.

### 1. "View all" under Needs restocking went to the POS

**Cause.** The system keeps two things when you sign in: the session, which belongs to one browser tab, and a page pass (a cookie), which belongs to the whole browser. When a cashier signs in in another tab of the same browser, the page pass becomes the cashier's. The administrator's tab still shows the dashboard, but the next link it clicks is judged as the cashier, so the server sends it to the cashier's only page, the POS. The tab then noticed, took the pass back, and returned to the Dashboard instead of the page that was clicked.

**Reproduced.** Dashboard as administrator, page pass switched to the cashier, click "View all": the browser requested `pos.html`, then `dashboard.html`.

**Fix** (`src/js/auth.js`):
- When a tab is the one being looked at, it takes the page pass back for its own account, so the next click is judged correctly.
- If a click is still sent to the wrong page, the tab now carries on to the page that was clicked, not to the Dashboard.

**After the fix.** Tested on the read-only copy, which follows the same page-pass rule as the real server:
- Same steps, clicking in the tab: the click went straight to `inventory.html?filter=reorder`.
- With the page pass still the cashier's at the moment of the click: `pos.html`, then on to the page that was clicked.
- A cashier's tab asking for the Dashboard while the page pass was the administrator's: ended back on the POS, and no dashboard data was requested.
- A saved destination that is not one of the system's own pages is ignored; the tab goes to its home page.

I have not run it with two real sign-ins, because I have no passwords.

### 2. The menu button covered the start of the page title in a small window

In a window 768px wide or narrower, with the sidebar collapsed (always the case for the till and supplier accounts), the menu button sat on top of the first letters of the title ("ettings"), and the date under it was cut off at the left edge. Measured on all 8 administrator pages, the POS and the supplier portal at 726px: fixed on every one (`src/css/system.css`). Wider windows are not affected.

### 3. A server address that does not exist answered with the sign-in page

`/api/anything-wrong` returned the sign-in page with "200 OK". It now returns "404 Not found" in the same format as every other answer (`backend/server.js`). All 120 protected addresses were asked again afterwards and still answer correctly.

## Found and left as they are

None of these stop anything working. They are yours to decide.

**Leftovers**
- `analytics.html` and `audit.html` only redirect to Reports (Stock planning and Activity log tabs). Both redirect correctly. They still carry their old page content underneath, which is never shown; the one missing function in check 2 (`onProductChange`) is in that unseen part.
- `sales.html` contains a complete "new sale" dialog (add item, scan barcode) that nothing opens. Selling moved to the POS page.
- 32 server addresses are not used by any page (listed at the end). They are all still protected by sign-in.

**View-only account**
- On Inventory, a viewer still sees Add, Import and Reorder. Pressing them shows "Your role can't …" and the server refuses the request as well, so nothing can be changed; the buttons are just not hidden.
- A viewer has a Users link in the sidebar. The page opens and shows "You do not have admin privileges".

**Wording**
- Sales history shows "Today's Sales" with a capital S beside "Total sales amount" and "Total transactions".

## Not checked, and why

**51 functions were not pressed.** Most of them save, send, delete, print or download, and this computer and the live site share one database, so pressing them would change the shop's real records or send real email. A few harmless ones (clear the cart, clear the date filter, refresh the void list) were skipped by the same cautious rule. For each one, what was checked is: the function is on the page, the server address it calls exists, and that address refuses anyone not signed in.

**Also not pressed: buttons that are wired inside the scripts instead of on the button itself.** The checker only presses buttons that name their function. These were on screen and listed, but not pressed: on the order board (Suppliers, Orders), Receive into stock, Mark shipped, Cancel order and Notes; in the supplier portal, Mark as shipped, Change delivery date, Notes, Change price and Save details. Two more were not on screen at all because nothing was waiting: Approve and Decline for a password reset request (Users), and Void and Keep for a void request (Reports). The server addresses behind all of them were checked the same way (they exist and refuse without a sign-in).

The 51: `addItemToSale`, `addToCart`, `advancePO`, `autoReorder`, `bulkAdjustStock`, `bulkDelete`, `bulkReorder`, `clearBarcodeInput`, `clearCart`, `clearDateFilter`, `clearRead`, `clearSelection`, `closeCsvImportModal`, `completeSale`, `connectThermalPrinter`, `createPlannedOrders`, `deleteFromDetails`, `deleteProduct`, `deleteSaleFromDetail`, `deleteSupplier`, `deleteUser`, `downloadBackup`, `downloadCsvTemplate`, `editProduct`, `exportCSV`, `exportReorderCSV`, `exportSalesCsv`, `focusBarcodeScanner`, `generateBarcodeField`, the two photo upload buttons, `importCsvProducts`, `loadVoidRequests`, `logout`, `markAllRead`, `markAsRead`, `openOffer`, `printCurrentReceipt`, `printReceipt`, `quickCash`, `removeAvatar`, `saveEmailSettings`, `saveEod`, `savePosCash`, `savePosEod`, `savePosOpen`, `savePosSettings`, `saveProfile`, `saveStockAdjustment`, `sendEmailCode`, `sendTestEmail`, `voidSale`.

Of these, the till ones (`addToCart`, `clearCart`, `quickCash`, `completeSale`, `savePosCash`, `savePosEod`) were pressed on the preview copy with sample data (check 12), and the cashier's selling, void request and receipt cases were run for real earlier in this project (`QA-REPORT.md`).

Also pressed, with nothing typed in: Settings, Change password. It showed its own "fill this in" message and sent nothing.

**Other things not checked**
- Signing in with a real password, and the emails for password reset, email verification, purchase orders and low stock. No real email was sent.
- The live site while signed in. The live site was checked only from outside, after the deploy.
- The Manager role. There is no active manager account, so pages were not opened as a manager. The server rules for managers are covered by the automated tests.
- Printing, the USB receipt printer, CSV import, and files that download (exports, backup).
- The supplier's own actions in the portal (confirm, promise a date, mark shipped, send a message, propose a price, offer an order).
- Phone-size screens, beyond the title check in fix 2.

**How the rest can be checked safely.** The clean way is a private copy of the database on this computer, with the real server running against the copy, so every save, delete and email can be pressed without touching the shop's records. I started to set that up and a safety rule stopped the copy step, because it reads the whole live database at once. If you want it, say so and I will ask for that permission; or sign in to the browser pane with a test account and tell me which cases may write.

## Page-by-page function map

Generated from what the checker recorded in the browser and from what the source says each function calls.

- **Pressed** means it was pressed in the browser with the real data, and what happened is written beside it.
- **Not pressed** means it changes, saves, sends, deletes, prints or downloads something. Its wiring was checked instead.
- "any signed-in account*" means administrator, manager and viewer. Till and supplier accounts are held to their own short lists: the cashier could read 10 addresses and the supplier 6, and were refused everywhere else (check 8).
- The sidebar, the notification bell, the Jump box, the help guide and the assistant are the same on every page, so they are not repeated in each table. The sidebar buttons and the bell were pressed on every page and responded each time. The Jump box was opened from the Dashboard. The assistant's status address answered (it is switched on), but its buttons were not pressed, because asking it a question sends a request to an outside AI service.

### Dashboard — `dashboard.html` (checked as Administrator)

Loaded with the real data: 12 requests to the server, all answered OK; no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Add product | Goes to `inventory.html` | — | Page exists |
| Recent Sales | View all → | Goes to `sales.html` | — | Page exists |
| Recent Sales | Show 5 more (7 remaining) | `showMoreDashSales()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 sales |
| Recent Sales | Show less | `showLessDashSales()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Needs restocking | View all → | Goes to `inventory.html?filter=reorder` | — | Page exists |
| Expiring products | 0 Within 30 days | `showExpirationProducts('critical')` | none directly (changes the screen, or works through another function) | Pressed: opened expirationModal |
| Expiring products | 0 In 31 to 60 days | `showExpirationProducts('warning')` | none directly (changes the screen, or works through another function) | Pressed: opened expirationModal |
| Expiring products | 0 In 61 to 90 days | `showExpirationProducts('notice')` | none directly (changes the screen, or works through another function) | Pressed: opened expirationModal |
| Purchase orders | View all → | Goes to `suppliers.html` | — | Page exists |
| Purchase orders | Shipped | `advancePO()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
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
| page | Add | `openAddProductModal()` | none directly (changes the screen, or works through another function) | Pressed by hand: opened "Add new product" (20 fields, Save product) |
| page | Import | `openCsvImportModal()` | none directly (changes the screen, or works through another function) | Pressed by hand: opened "Import Products from CSV" |
| page | Reorder | `autoReorder()` | `GET /api/products/low-stock` (any signed-in account*) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Barcodes | `openBarcodeManager()` | none directly (changes the screen, or works through another function) | Pressed: opened barcodeManagerModal; loaded 200 products |
| page | Images | `openImageManager()` | none directly (changes the screen, or works through another function) | Pressed: opened imageManagerModal; loaded 200 products |
| page | Low stock 5 | `filterLowStock()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | All 119 | `setStatusFilter()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Low stock 3 | `setStatusFilter('low')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Out of stock 2 | `setStatusFilter('out')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Expiring soon 0 | `setStatusFilter('expiring')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Expired 14 | `setStatusFilter('expired')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Healthy 102 | `setStatusFilter('in')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products |
| page | Show all products _(hidden until its dialog or state appears)_ | `showAllProducts()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products/stats, 200 products, 200 products/stats |
| page | View _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `viewProductDetails()` | `GET /api/products/:id` (any signed-in account*) | Pressed by hand: opened "Product details" |
| page | Edit _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `openEditProductModal()` | `GET /api/products/:id` (any signed-in account*) | Pressed by hand: opened "Edit product" with 14 of 20 fields already filled from the product |
| page | Stock _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `openStockModal()` | none directly (changes the screen, or works through another function) | Pressed by hand: opened "Adjust stock" |
| page | Delete _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `deleteProduct()` | `DELETE /api/products/:id` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Product ▲ | `sortBy('name')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| page | Category ▲ | `sortBy('category')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Price ▲ | `sortBy('price')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| page | Stock ▲ | `sortBy('stock')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| page | Expiration ▲ | `sortBy('expiry')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| page | Status ▲ | `sortBy('status')` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products, 200 products/stats |
| page | Show 10 more (109 remaining) | `showMoreProducts()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| page | Bulk reorder _(hidden until its dialog or state appears)_ | `bulkReorder()` | `POST /api/purchase-orders/auto-generate` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Adjust stock _(hidden until its dialog or state appears)_ | `bulkAdjustStock()` | `PUT /api/products/:id/stock` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Delete _(hidden until its dialog or state appears)_ | `bulkDelete()` | `DELETE /api/products/:id` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Clear _(hidden until its dialog or state appears)_ | `clearSelection()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Add new product | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeProductModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Add new product | Generate _(hidden until its dialog or state appears)_ | `generateBarcodeField()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Add new product | Paste image URL, or upload → _(hidden until its dialog or state appears)_ | `updateImagePreview()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Add new product | imageFile _(hidden until its dialog or state appears)_ | `handleFormImageFile()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Add new product | Upload _(hidden until its dialog or state appears)_ | `getElementById('imageFile')` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Add new product | Save product _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| dialog: Product details | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeProductDetailsModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Product details | Edit _(hidden until its dialog or state appears)_ | `editProduct()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Product details | Delete _(hidden until its dialog or state appears)_ | `deleteFromDetails()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Adjust stock | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeStockModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Adjust stock | Save adjustment _(hidden until its dialog or state appears)_ | `saveStockAdjustment()` | `PUT /api/products/:id/stock` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: file_upload Import Products from CSV | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeCsvImportModal()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: file_upload Import Products from CSV | Download template _(hidden until its dialog or state appears)_ | `downloadCsvTemplate()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: file_upload Import Products from CSV | Import products _(hidden until its dialog or state appears)_ | `importCsvProducts()` | `GET /api/products/categories` (any signed-in account*)<br>`POST /api/products/bulk` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
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

Loaded with the real data: 14 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: table: 10 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | End of day | `openEodModal()` | none directly (changes the screen, or works through another function) | Pressed: opened eodModal |
| page | Export CSV | `exportSalesCsv()` | `GET /api/sales` (any signed-in account*) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Filter | `filterSalesByDate()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| page | Clear | `clearDateFilter()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| page | View _(and 9 more like it)_ | `viewSaleDetails()` | `GET /api/sales/:id` (any signed-in account*) | Pressed: opened viewSaleModal; loaded 200 sales/eod, 200 sales/2580, 200 sales/eod/history |
| page | Void _(and 7 more like it)_ | `voidSale()` | `POST /api/sales/:id/void` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Show 10 more (2331 remaining) | `showMoreSales()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 sales |
| dialog: Create new sale | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeSaleModal()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 sales/stats |
| dialog: Create new sale | Clear _(hidden until its dialog or state appears)_ | `clearBarcodeInput()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Create new sale | Scan _(hidden until its dialog or state appears)_ | `focusBarcodeScanner()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Create new sale | Add item _(hidden until its dialog or state appears)_ | `addItemToSale()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Create new sale | Print receipt _(hidden until its dialog or state appears)_ | `printCurrentReceipt()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: Create new sale | Complete sale _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| dialog: Sale details | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeViewSaleModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Sale details | Print receipt _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `printReceipt()` | `GET /api/sales/:id` (any signed-in account*) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: Sale details | Delete sale _(hidden until its dialog or state appears)_ | `deleteSaleFromDetail()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| dialog: End of day cash count (whole shop) | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeEodModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: End of day cash count (whole shop) | eodDate _(hidden until its dialog or state appears)_ | `loadEod()` | `GET /api/sales/eod` (any signed-in account*) | Not pressed. Function exists on the page. |
| dialog: End of day cash count (whole shop) | 0.00 _(hidden until its dialog or state appears)_ | `updateEodDiff()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: End of day cash count (whole shop) | Reopen _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `reopenCount()` | `DELETE /api/sales/eod/:id` (admin, manager) | Not pressed. Function exists on the page. |
| dialog: End of day cash count (whole shop) | Save count _(hidden until its dialog or state appears)_ | `saveEod()` | `POST /api/sales/eod` (admin, manager, cashier) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |

Fields you type or choose in (no action of their own):
- page: Search sales..., dateFrom, dateTo, Ask a question or how to do something…
- dialog: Create new sale: Optional, Scan barcode or type to search... (F2), Select a productAOZI ADULT LAMB (20)AOZI PUPPY LAMB (12)AOZI PUPPY SIL, quantity, unit_price, Cash (cash-only), Optional notes, discount
- dialog: End of day cash count (whole shop): e.g. ₱200 used for water delivery

Search boxes and filters tried: typing "dog" in `searchInput` gave 4 rows (was 23).

### Suppliers — `suppliers.html` (checked as Administrator)

Loaded with the real data: 7 requests to the server, 1 not OK (404 /api/email-logs/6); no script errors; nothing left loading. Tables on screen: supplierTableWrap: 2 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Suppliers | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Orders 0 | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Add supplier | `openAddSupplierModal()` | none directly (changes the screen, or works through another function) | Pressed by hand: opened "Add supplier" (7 fields, Save supplier) |
| Orders on the way | Refresh _(hidden until its dialog or state appears)_ | `refreshDeliveries()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 purchase-orders/deliveries |
| Orders on the way | Receive into stock _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Orders on the way | Notes _(and 2 more like it)_ _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Orders on the way | Mark shipped _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Orders on the way | Cancel order _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | bruzieozie@gmail.com _(and 3 more like it)_ | `showEmailLogs()` | `GET /api/email-logs/:supplierId` (any signed-in account*) | Dialog opened. Its list could not be loaded through the read-only copy (this one address lives in the main server file); the same query was run directly and returned rows. |
| page | Performance _(and 1 more like it)_ | `showPerformance()` | `GET /api/suppliers/:id/performance` (any signed-in account*) | Pressed: opened performanceModal; loaded 200 suppliers/6/performance |
| page | Edit _(and 1 more like it)_ | `openEditSupplierModal()` | none directly (changes the screen, or works through another function) | Pressed: opened supplierModal |
| page | Delete _(and 1 more like it)_ | `deleteSupplier()` | `DELETE /api/suppliers/:id` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: Roger Enteria Performance | × _(hidden until its dialog or state appears)_ | `closePerformanceModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Roger Enteria Performance | Shipped _(hidden until its dialog or state appears)_ | `advancePOFromModal()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Roger Enteria Performance | Email _(and 10 more like it)_ _(hidden until its dialog or state appears)_ | `emailPOFromModal()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Edit supplier | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeSupplierModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Edit supplier | Save supplier _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| dialog: mark_email_read Email History — Roger Enteria | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeEmailLogsModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |

Fields you type or choose in (no action of their own):
- page: Search suppliers..., Ask a question or how to do something…
- dialog: Edit supplier: name, contact_person, email, phone, Street address, city, Net 15 Net 30 Net 60 Due on Receipt

Search boxes and filters tried: typing "dog" in `searchInput` gave 13 rows (was 14).

### Reports — `reports.html` (checked as Administrator)

Loaded with the real data: 7 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: salesTable: 20 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Sales | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Stock planning | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Void requests0 | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Activity log | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | Last 7 days _(and 1 more like it)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | This month | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | All time | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | Custom | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | Day | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | Week | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | Month | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Revenue by day | Export CSV | `exportCSV()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| Revenue by day | Apply _(hidden until its dialog or state appears)_ | `applyDateRange()` | none directly (changes the screen, or works through another function) | Pressed by hand: reloaded the sales report (200 sales/report) |
| Sales breakdown | Show 10 more (10 remaining) | `showMoreReport()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| Sales breakdown | Show less | `showLessReport()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| What to reorder | Refresh _(hidden until its dialog or state appears)_ | `refreshAnalytics()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 predictions/trends |
| What to reorder | Export list _(hidden until its dialog or state appears)_ | `exportReorderCSV()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| What to reorder | Create purchase orders _(hidden until its dialog or state appears)_ | `createPlannedOrders()` | `POST /api/purchase-orders/auto-generate` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| All products | All _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| All products | Selling fast _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| All products | Selling steadily _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| All products | Selling slowly _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| All products | Not selling _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Product forecast | Close _(hidden until its dialog or state appears)_ | `closeProductDetail()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| Void requests | Refresh _(hidden until its dialog or state appears)_ | `loadVoidRequests()` | `GET /api/sales/void-requests` (admin, manager) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| Activity log | All actions Created Updated Deleted Signed in _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `loadAuditLogs()` | `GET /api/audit-logs` (admin) | Not pressed. Function exists on the page. |
| Activity log | Refresh _(hidden until its dialog or state appears)_ | `refreshAudit()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 audit-logs, 200 notifications/count |
| Activity log | User Logged in on users by JUAN CASHIER 18m ag _(and 19 more like it)_ _(hidden until its dialog or state appears)_ | `toggleDetail()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Activity log | ‹ Prev _(and 4 more like it)_ _(hidden until its dialog or state appears)_ | `goToPage()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |

Fields you type or choose in (no action of their own):
- Revenue by day: startDate, endDate
- All products: Search products
- page: Ask a question or how to do something…

### Users — `users.html` (checked as Administrator)

Loaded with the real data: 6 requests to the server, all answered OK; no script errors; nothing left loading. Tables on screen: usersTable: 4 rows.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | showInactive | `loadUsers()` | `GET /api/auth/users` (admin) | Not pressed. Function exists on the page. |
| page | Add user | `openAddUserModal()` | none directly (changes the screen, or works through another function) | Pressed by hand: opened "Add new user" with the five roles to choose from |
| page | Edit _(and 3 more like it)_ | `openEditUserModal()` | none directly (changes the screen, or works through another function) | Pressed: opened userModal; loaded 200 suppliers, 200 suppliers |
| page | Delete _(and 3 more like it)_ | `deleteUser()` | `DELETE /api/auth/users/:id` (admin) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: Edit user | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeUserModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Edit user | userEmail _(hidden until its dialog or state appears)_ | `onEmailChanged()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Edit user | Send code _(hidden until its dialog or state appears)_ | `sendEmailCode()` | `POST /api/auth/email-code` (admin) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: Edit user | - - - - - - _(hidden until its dialog or state appears)_ | `onCodeTyped()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Edit user | Staff — point of sale only Manager — inventory _(hidden until its dialog or state appears)_ | `refreshRoleFields()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| dialog: Edit user | Update user _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |

Fields you type or choose in (no action of their own):
- page: Search users..., Ask a question or how to do something…
- dialog: Edit user: userFullName, Usernames cannot be changed, userPassword, Choose a supplier Roger EnteriaSupplier 1Roger EnteriaSupplier 1

Search boxes and filters tried: typing "dog" in `searchInput` gave 1 rows (was 4).

### Notifications — `notifications.html` (checked as Administrator)

Loaded with the real data: 7 requests to the server, 1 not OK (405 /api/notifications/check-alerts); no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Mark all read | `markAllRead()` | `PUT /api/notifications/read-all` (any signed-in account*) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Clear read | `clearRead()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| page | Refresh | `refreshList()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 notifications/summary, 200 notifications |
| page | All Types Low Stock Stock Out Expiration Overs _(and 1 more like it)_ | `applyNotifFilters()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| page | Mark as read _(and 9 more like it)_ | `markAsRead()` | `PUT /api/notifications/:id/read` (any signed-in account*) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Show 10 more (142 remaining) | `showMoreNotifications()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |

Fields you type or choose in (no action of their own):
- page: Ask a question or how to do something…

### Settings — `settings.html` (checked as Administrator)

Loaded with the real data: 4 requests to the server, all answered OK; no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Profile | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Password | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Preferences | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Session | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Email | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | avatarFile _(hidden until its dialog or state appears)_ | `handleAvatarFile()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| page | Upload photo | `getElementById('avatarFile')` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| page | Remove _(hidden until its dialog or state appears)_ | `removeAvatar()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| page | Save changes | `saveProfile()` | `PUT /api/auth/profile` (any signed-in account*) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Update password _(hidden until its dialog or state appears)_ | `changePassword()` | `PUT /api/auth/change-password` (any signed-in account*) | Pressed: changed the view |
| page | Save limit _(hidden until its dialog or state appears)_ | `savePosSettings()` | `PUT /api/sales/pos-settings` (admin) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Download backup _(hidden until its dialog or state appears)_ | `downloadBackup()` | `GET /api/backup` (admin) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | System _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Light _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Dark _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Risha _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Navy & Sky _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Red & Sunshine _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Green & Gold _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Teal & Orange _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Purple & Pink _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Charcoal & Blue _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Sans _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Serif _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Mono _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Small _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Default _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Large _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Larger _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Reset _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Discard _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Save changes _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| page | Save & Verify _(hidden until its dialog or state appears)_ | `saveEmailSettings()` | `PUT /api/email-settings` (admin) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| page | Send test email _(hidden until its dialog or state appears)_ | `sendTestEmail()` | `POST /api/email-settings/test` (admin) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |

Fields you type or choose in (no action of their own):
- page: Your full name, your@email.com, username, Enter current password, Enter new password, Confirm new password, posMaxDiscountInput, settingsNotifToggle, settingsSidebarToggle, emailEnabledToggle, yourshop@gmail.com, •••••••• (saved — leave blank to keep), RISHA Pet Supplies, you@example.com, Ask a question or how to do something…

### Point of sale — `pos.html` (checked as Staff (cashier))

Loaded with the real data: 11 requests to the server, all answered OK; no script errors; nothing left loading.

| Where | Control | What it does | Server address (who may use it) | Result |
|---|---|---|---|---|
| page | Connect printer | `connectThermalPrinter()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| page | My sales today | `openMySales()` | none directly (changes the screen, or works through another function) | Pressed: opened posMySalesModal; loaded 200 sales/mine |
| page | Cash in / out | `openPosCash()` | `GET /api/sales/till/cash` (cashier) | Pressed: opened posCashModal; loaded 200 sales/till/cash |
| page | End of day | `openPosEod()` | `GET /api/sales/eod` (any signed-in account*) | Pressed: opened posEodModal |
| page | Search products | `filterProducts()` | none directly (changes the screen, or works through another function) | Typed "dog": 11 rows shown (was 11), no errors |
| page | All products105 _(and 7 more like it)_ | `filterByCategory()` | none directly (changes the screen, or works through another function) | Pressed: loaded 200 products |
| page | Health & Wellness1 BOX SMP 23 left ₱120.00 Add _(and 9 more like it)_ | `addToCart()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| page | Show 10 more (95 remaining) | `showMorePosProducts()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Current sale | Clear _(hidden until its dialog or state appears)_ | `clearCart()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| Current sale | Discount percent | `updateCartTotals()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Current sale | 0.00 _(hidden until its dialog or state appears)_ | `updateChange()` | none directly (changes the screen, or works through another function) | Not pressed. Function exists on the page. |
| Current sale | Exact _(hidden until its dialog or state appears)_ | `quickCash('exact')` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| Current sale | +20 _(and 4 more like it)_ _(hidden until its dialog or state appears)_ | `quickCash()` | none directly (changes the screen, or works through another function) | Not pressed in this pass. The function is on the page. |
| Current sale | Charge₱0.00 | `completeSale()` | `POST /api/sales` (cashier) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: Starting cash | Cancel _(hidden until its dialog or state appears)_ | `closePosOpen()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Starting cash | Save starting cash _(hidden until its dialog or state appears)_ | `savePosOpen()` | `POST /api/sales/till/open` (cashier) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: My sales today | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeMySales()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: My sales today | Reprint _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| dialog: My sales today | Ask for void _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| dialog: End of day cash count | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closePosEod()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: End of day cash count | Change _(hidden until its dialog or state appears)_ | `changePosOpen()` | none directly (changes the screen, or works through another function) | Pressed: opened posOpenModal |
| dialog: End of day cash count | Save count and close drawer _(hidden until its dialog or state appears)_ | `savePosEod()` | `POST /api/sales/eod` (admin, manager, cashier) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| dialog: Cash in or out of the drawer | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closePosCash()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Cash in or out of the drawer | Taken out _(hidden until its dialog or state appears)_ | `setPosCashKind('out')` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Cash in or out of the drawer | Put in _(hidden until its dialog or state appears)_ | `setPosCashKind('in')` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Cash in or out of the drawer | Record cash put in _(hidden until its dialog or state appears)_ | `savePosCash()` | `POST /api/sales/till/cash` (cashier) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |

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
| Open orders | Offer an order | `openOffer()` | `POST /api/supplier-portal/offers` (supplier) | Not pressed in this pass. The function is on the page, the address exists and it refuses without a sign-in. |
| Open orders | Mark as shipped | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Open orders | Change delivery date | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Open orders | Notes | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Products you supply | Change price _(and 3 more like it)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |
| Your details | Edit contact details | `openDetails()` | `PUT /api/supplier-portal/me` (supplier) | Pressed: opened spModal |
| dialog: Edit contact details | × _(and 1 more like it)_ _(hidden until its dialog or state appears)_ | `closeSpModal()` | none directly (changes the screen, or works through another function) | Pressed: changed the view |
| dialog: Edit contact details | Save details _(hidden until its dialog or state appears)_ | wired inside the page script | none directly (changes the screen, or works through another function) | On screen and listed, not pressed |

Fields you type or choose in (no action of their own):
- dialog: Edit contact details: spContact, spPhone, spAddress, spCity

## Every server address

130 addresses. "Used by" names the script that calls it.

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
| `GET /api/auth/users/:id` | admin | _no page uses it_ |
| `PUT /api/auth/users/:id` | admin | users.js |
| `PUT /api/auth/users/:id/role` | admin | _no page uses it_ |
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
| `GET /api/notifications/unread` | any signed-in account* | _no page uses it_ |
| `GET /api/notifications/count` | any signed-in account* | auth.js, dashboard.js |
| `GET /api/notifications/alerts` | any signed-in account* | _no page uses it_ |
| `POST /api/notifications` | admin | _no page uses it_ |
| `PUT /api/notifications/read-all` | any signed-in account* | auth.js, notifications.js |
| `PUT /api/notifications/:id/read` | any signed-in account* | auth.js, notifications.js |
| `DELETE /api/notifications/read` | any signed-in account* | notifications.js |
| `DELETE /api/notifications/old` | admin | _no page uses it_ |
| `DELETE /api/notifications/:id` | admin | _no page uses it_ |
| `GET /api/predictions/product/:id` | any signed-in account* | analytics.js |
| `GET /api/predictions/all` | any signed-in account* | _no page uses it_ |
| `GET /api/predictions/overview` | any signed-in account* | analytics.js |
| `GET /api/predictions/summary` | any signed-in account* | _no page uses it_ |
| `GET /api/predictions/trends` | any signed-in account* | analytics.js |
| `GET /api/products` | any signed-in account* | auth.js, dashboard.js, inventory.js, jump.js, point-of-sale.js, pos.js |
| `GET /api/products/stock-levels` | any signed-in account* | inventory.js, pos.js |
| `GET /api/products/stats` | any signed-in account* | inventory.js |
| `GET /api/products/low-stock` | any signed-in account* | dashboard.js, inventory.js |
| `GET /api/products/expiring` | any signed-in account* | _no page uses it_ |
| `GET /api/products/overstock` | any signed-in account* | _no page uses it_ |
| `GET /api/products/barcode` | any signed-in account* | _no page uses it_ |
| `GET /api/products/categories` | any signed-in account* | inventory.js, pos.js |
| `GET /api/products/suppliers` | any signed-in account* | _no page uses it_ |
| `GET /api/products/species` | any signed-in account* | _no page uses it_ |
| `GET /api/products/:id` | any signed-in account* | inventory.js |
| `POST /api/products` | admin, manager | inventory.js |
| `POST /api/products/bulk` | admin, manager | inventory.js |
| `PUT /api/products/:id` | admin, manager | inventory.js |
| `PUT /api/products/:id/stock` | admin, manager | inventory.js |
| `DELETE /api/products/:id` | admin, manager | inventory.js |
| `GET /api/purchase-orders` | any signed-in account* | dashboard.js |
| `GET /api/purchase-orders/deliveries` | any signed-in account* | supply-board.js |
| `POST /api/purchase-orders/price-proposals/:id/decide` | admin, manager | supply-board.js |
| `GET /api/purchase-orders/:id` | any signed-in account* | _no page uses it_ |
| `GET /api/purchase-orders/:id/messages` | admin, manager | supply-board.js |
| `POST /api/purchase-orders/:id/messages` | admin, manager | supply-board.js |
| `PUT /api/purchase-orders/:id/payment` | admin, manager | supply-board.js |
| `POST /api/purchase-orders` | admin, manager | _no page uses it_ |
| `POST /api/purchase-orders/auto-generate` | admin, manager | analytics.js, inventory.js |
| `PUT /api/purchase-orders/:id/status` | admin, manager | dashboard.js, suppliers.js, supply-board.js |
| `POST /api/purchase-orders/:id/send-email` | admin, manager | suppliers.js |
| `DELETE /api/purchase-orders/:id` | admin | _no page uses it_ |
| `GET /api/sales` | any signed-in account* | dashboard.js, point-of-sale.js |
| `GET /api/sales/stats` | any signed-in account* | point-of-sale.js |
| `GET /api/sales/daily-sales` | any signed-in account* | dashboard.js |
| `GET /api/sales/weekly-sales` | any signed-in account* | _no page uses it_ |
| `GET /api/sales/monthly-sales` | any signed-in account* | _no page uses it_ |
| `GET /api/sales/total-sales` | any signed-in account* | _no page uses it_ |
| `GET /api/sales/report` | any signed-in account* | reports.js |
| `GET /api/sales/top-products` | any signed-in account* | _no page uses it_ |
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
| `POST /api/sales` | cashier | point-of-sale.js, pos.js |
| `PUT /api/sales/:id` | admin, manager | _no page uses it_ |
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
| `GET /api/suppliers/geocode` | admin, manager | _no page uses it_ |
| `GET /api/suppliers/shop-location` | any signed-in account* | _no page uses it_ |
| `PUT /api/suppliers/shop-location` | admin | _no page uses it_ |
| `GET /api/suppliers/:id` | any signed-in account* | _no page uses it_ |
| `GET /api/suppliers/:id/performance` | any signed-in account* | suppliers.js |
| `POST /api/suppliers` | admin, manager | suppliers.js |
| `POST /api/suppliers/:id/performance` | admin, manager | _no page uses it_ |
| `PUT /api/suppliers/:id` | admin, manager | suppliers.js |
| `DELETE /api/suppliers/:id` | admin, manager | suppliers.js |
| `GET /api/backup` | admin | settings.js |
| `GET /track/:trackingId.gif` | anyone (no sign-in) | _no page uses it_ |
| `POST /track/confirm/:trackingId` | anyone (no sign-in) | _no page uses it_ |
| `GET /track/click/:trackingId` | anyone (no sign-in) | _no page uses it_ |
| `GET /api/email-logs/:supplierId` | any signed-in account* | suppliers.js |
| `GET /api/email-logs` | any signed-in account* | _no page uses it_ |
| `GET /api/health` | anyone (no sign-in) | _no page uses it_ |
| `POST /api/notifications/check-alerts` | any signed-in account* | notifications.js |
