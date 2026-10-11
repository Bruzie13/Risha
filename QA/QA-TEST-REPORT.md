# FETCH: QA test report against the test plan

Date: 11 October 2026 (shop time). System: FETCH, Inventory Management System with Predictive Analytics, Risha Pet Supplies.

Every result below was seen in a run made for this report, unless the row says "10 Oct". Nothing here is from memory, and nothing was guessed. Where a check could not be made, the row says "Not Tested" and why.

## Update: after the fixes

The fixes that followed this report are on the work branch `pro-redesign`, one commit each. Nothing is deployed: the live site is still at `6c60be9`.

**How to read the rows now.** What was seen in the test is left as it was written. A row that has changed gains a note beginning **Now:** and, where it had failed, a new status:

| Status | Meaning |
|---|---|
| Fixed – retest pending (`commit`) | Fixed in that commit and checked as described below. It has not been retested on the real system |
| Partly fixed – retest pending | Better, and measured, but the expected result is not fully met |
| Open / Not fixed | Unchanged, with the reason |

**How the fixes were checked.** Not on the shared database, and then read through once more: after this update was written, each of its claims was checked against the code by a separate review, which corrected details in 17 places and found one small fault that is now fixed (`90bed5f`, row A13). Each fix that saves anything was run on a separate test database on this computer (the same tables, with only TEST_ rows in it), through the real server code, and where it shows on screen, in a test browser. The one exception is the last fix (`90bed5f`, row A13), which was checked by reading the code and with the unit tests only. The forecast was run read-only on the real sales. The automated tests, 184 of them now, all pass. "Retest pending" means what is still owed: the same cases run on the real system once it is deployed.

**The count.** Of the 27 rows that failed: 21 are fixed, 2 are partly fixed (B04, B06), and 4 are open (B02, B12, C04, C05). The 6 rows that were not tested are still not tested; the last section says what each would create.

**Also written since:** `QA/FORECAST-METHOD.md` (how the forecast works now, with its test results) and `QA/FETCH-System-and-Analytics-Guide.docx` (the system and the analytics in plain words).

## How the test was run

Nothing was saved to the database in this run. Your computer and the live site share one database, and saving needs your yes, so every check either only reads, or stops just before the write.

| Tag | Where the result was seen |
|---|---|
| LIVE | `https://risha-pets.onrender.com` from outside, without signing in. Page and read requests only, plus one sign-in with a made-up name. |
| LOCAL | The real server on this computer, without signing in. |
| COPY | A read-only copy of the server on this computer: the real code and the real database, every request that is not a read is refused. It acts as an existing account of a role (administrator, viewer, cashier, supplier) without a password. |
| BROWSER | A test browser on COPY. Where a button would save, the save was answered inside the browser and never sent. |
| DRY | The real save handler called directly, with every database write, email and outside call blocked. It shows what the handler accepts, what it refuses, and what it was about to write. It does not show what the database would do with a value it dislikes. |
| CODE | The system's own forecasting code run on the real sales (read only) or on made-up sales histories. |
| 10 Oct | Seen in the button-pressing pass you approved on 10 October, with "QA TEST" records that were removed afterwards. Not repeated today. Details in `QA/SYSTEM-CHECK.md`. |

Two versions exist right now, and results depend on which one:

- **Live site:** commit `6c60be9`. It does not yet have the last two commits.
- **This computer (work branch):** commit `644735a`. It adds: reorder needs a current supplier, no past expiration dates, and a product cannot be added without a supplier, a category and a price.

Rows marked "work branch" will behave the old way on the live site until those two commits are deployed.

## 1. Module inventory

**Pages (13 screens, 2 redirects)**

| Page | What it is | Who opens it |
|---|---|---|
| `login.html`, `reset-password.html`, `verify-email.html` | Sign in, set a new password from an emailed link, confirm an email address | Public |
| `dashboard.html` | Totals, sales of the last 30 days, recent sales, what needs restocking, expiring products | Administrator, manager, viewer |
| `inventory.html` | Product list, add, edit, delete, stock in and out, import from file, reorder list, barcode and picture tools | Same; only administrator and manager see the buttons that change things |
| `sales.html` | Sales history, sale details, void, delete, export, end-of-day counts | Same |
| `suppliers.html` | Suppliers, purchase orders board, receive into stock, supplier performance | Same |
| `reports.html` | Four tabs: Sales, Stock planning (the forecast), Void requests, Activity log | Same; Activity log is administrator only |
| `users.html` | Accounts, roles, password reset requests | Administrator only |
| `notifications.html` | Low stock, out of stock, expiry and other notices | Administrator, manager, viewer |
| `settings.html` | Own profile, password, appearance; email and till settings for the administrator | Everyone signed in |
| `pos.html` | The till: sell, cash in and out, my sales today, end-of-day count | Cashier only |
| `supplier.html` | A supplier's own products, orders and scorecard | Supplier only |
| `analytics.html`, `audit.html` | Redirect to the Stock planning and Activity log tabs of Reports | |

A built-in assistant (a chat helper) sits on the back-office pages.

**Roles found:** administrator, manager, viewer (view only), cashier, supplier. Accounts on record: 6. The roles in use are administrator, viewer, cashier and supplier. There is no manager account.

**Server:** 102 addresses, 92 of them need a sign-in. The 10 open ones are sign-in, forgot and reset password, confirm email and resend its link, sign out, the three links used inside emails, and a health check.

**Forecast:** written in Python (scikit-learn), called by the server. It is not plain linear regression; see B02.

**In the test plan but not in the system**

- A screen showing the stock history of one product. Stock changes are recorded, but only the administrator's Activity log shows them.
- Payment by card or online. The till is cash only, and all 2,338 completed sales are cash.

## 2. Test cases

Status is Pass, Fail or Not Tested. Severity is given for a Fail.

### A. Functional

| ID | Area | Test case | Steps | Expected result | Actual result | Status | Severity |
|---|---|---|---|---|---|---|---|
| A01 | Sign-in | Wrong password, and a user that does not exist | LOCAL: sign in as a real user name with a wrong password; then as a made-up name | Both refused with the same message, no session | Both: 401 "Invalid username or password". No cookie set. **Now:** They now also take the same time: 121.7 ms and 121.1 ms over 30 tries each on a test server (it was 118 ms against 2 ms) (`ce07f9b`) | Pass | – |
| A02 | Sign-in | Nothing typed | LOCAL: send an empty sign-in | Refused with a clear message | 400 "Username and password are required" | Pass | – |
| A03 | Sign-in | Lock after repeated failures | LOCAL: six refused sign-ins in a row | Locked after five | The sixth and seventh: 429 "Too many login attempts. Try again in 900s." The local server was restarted afterwards to clear the lock | Pass | – |
| A04 | Sign-in | Made-up name on the live site | LIVE: one sign-in with a made-up name | Refused | 401 "Invalid username or password", no cookie, answered in 0.81 s | Pass | – |
| A05 | Sign-in | Successful sign-in and sign-out | Needs a real password | Signs in, signs out, nothing left in the browser | Not tested today: I do not type passwords. 10 Oct: 98 real sign-in checks passed with three temporary accounts, including sign-out returning to the sign-in page with nothing left in the browser | Not Tested | – |
| A06 | Sign-in | Session expiry | Needs a session left to run out | Signed out when the session ends | Not tested: it would need a session left for 24 hours (7 days with "Keep me signed in"), or a token made by hand, which I do not do. By reading the code: 24 hours, or 7 days. 10 Oct: a deactivated account's session stopped at once | Not Tested | – |
| A07 | Roles | Pages each role can open | COPY: open all ten pages as viewer, cashier, supplier and administrator | Each role reaches only its own pages | Viewer: Users, POS and Supplier page send it to the Dashboard. Cashier: everything except POS and Settings sends it to the POS. Supplier: everything except its page and Settings sends it to its page. Administrator: POS and Supplier page send it to the Dashboard | Pass | – |
| A08 | Roles | Read addresses by role | COPY: 43 read addresses as four roles | Allowed or refused as designed | 172 of 172 calls as expected. A cashier opening another person's sale: 403. A supplier opening another supplier's order: 404 | Pass | – |
| A09 | Roles | View-only account sees no buttons that change things | BROWSER as viewer: Inventory, Suppliers, Sales history, Dashboard | No Add, Import, Edit, Delete, Stock, Reorder | None visible on the four pages. The only match was the assistant's suggested question "Void & end-of-day?", which is not an action | Pass | – |
| A10 | Products | Add: required fields | DRY and BROWSER (work branch): add with fields missing | Refused, missing fields named | 400 "Fill in these first: SKU, Product name, Category, Unit price, Supplier." The form stops on each starred field and sends nothing | Pass | – |
| A11 | Products | Add: SKU that already exists | DRY: add with SKU `DRY-002` | Refused | 409 "A product with this SKU already exists". The database also keeps SKUs unique | Pass | – |
| A12 | Products | Add: name that already exists | DRY: add "AOZI ADULT LAMB" under a new SKU | Refused or warned | Accepted. Nothing checks for a name already in use. **Now:** The server asks first, naming the other product's SKU, and saves only when told to. A file import leaves such a row out and names it | Fixed – retest pending (`c535a0a`) | Low |
| A13 | Products | Edit cannot empty a required field | DRY (work branch): edit with the supplier cleared; edit sending only a barcode | First refused, second accepted | 400 "Fill in this first: Supplier."; the barcode-only edit is accepted; a refused edit uploads no picture. **Now:** An edit refused because of its name or its expiration date used to upload its picture before being refused. The picture is now stored last (`90bed5f`; checked by reading the code and with the unit tests, not run against a database) | Pass | – |
| A14 | Products | Delete asks first | BROWSER: press Delete on a product, then Cancel | A confirmation; Cancel sends nothing | "Delete product. Are you sure you want to delete this product? This cannot be undone." Cancel sent nothing. **Now:** The question now names the product and says what deleting does (`c535a0a`) | Pass | – |
| A15 | Products | Delete: what it does | DRY: delete a product with 20 in stock; delete product number 999999, which does not exist | First warns about the stock; second refused | Both answer 200 "Product deleted successfully". The product is hidden, not erased. No warning about stock on hand. The one that does not exist is also logged as deleted. **Now:** A product that does not exist is answered 404 and nothing is logged. The question says when the product still has stock, and the Activity log keeps what was deleted | Fixed – retest pending (`c535a0a`) | Low |
| A16 | Products | Search | COPY: search "aozi" and "AOZI" | The matching products | 7 rows both times; the database has 7. **Now:** A `%` or `_` typed in the search used to match every product. Each is now looked for as itself (`d07958e`) | Pass | – |
| A17 | Products | Filter by category, species and status | COPY: Food; Dog; low, out, expired, healthy, to reorder | Counts equal the database | Food 60, Dog 35, low 4, out 2, expired 14, healthy 101, to reorder 6. All equal the database | Pass | – |
| A18 | Products | Import from a file | BROWSER (work branch): 5-row file with a blank category, a misspelled category and a zero price | Bad rows left out and named | "Imported 2 of 5 products." with the three rows named and why. With no supplier chosen nothing is sent | Pass | – |
| A19 | Stock | Stock in and stock out change stock by the amount entered | DRY: stock in 5, then stock out 5, on a product with 20 | +5, then −5, each recorded | About to write "stock + 5" with a history row of +5, then "stock − 5" with a history row of −5. Not executed | Pass | – |
| A20 | Stock | Cannot remove more than there is | DRY: stock out 999,999 from a product with 20 | Refused, or a warning | 200 "Stock adjusted successfully". Stock would be set to 0 and the history row would say −999,999. The page would then say "Recorded −999999 — inventory levels are up to date.". **Now:** Refused: 400 "Only 20 in stock: you cannot remove 999999." The page checks before sending, and the server checks while the product's row is locked | Fixed – retest pending (`9051de7`) | Medium |
| A21 | Stock | The "Adjustment" kind of change | DRY: quantity 1 with no kind given, which is recorded as "adjustment" | A clear direction | It subtracts: about to write "stock − 1". The same line of code makes "Damage" subtract too. Only "Add Stock (In)" adds. **Now:** The four choices each say which way they go ("Add stock…", "Remove stock: count was lower than the system", …) (`2547ac2`). The window also shows what the stock will go from and to as the quantity is typed (`9051de7`) | Fixed – retest pending (`2547ac2`, `9051de7`) | Low |
| A22 | Stock | History is recorded | Database counts and code | Each change recorded | Recorded in two places: 78 stock movement rows and the Activity log. No page reads the stock movement rows, so the history is visible only in the administrator's Activity log | Pass | – |
| A23 | Sales | Stock goes down by exactly what was sold | DRY as cashier: sell 1 unit priced ₱1,560 | Stock − 1 | About to write: a sale of ₱1,560.00, one line of quantity 1, "stock − 1", history row −1. Not executed | Pass | – |
| A24 | Sales | Cannot sell more than the stock | DRY: sell 21 of a product with 20; sell an out-of-stock product | Refused | 400 "Insufficient stock for AOZI ADULT LAMB. Available: 20.000, requested: 21"; the out-of-stock one refused the same way | Pass | – |
| A25 | Sales | Expired product | DRY: sell an expired product | Refused | 400 "Product BEEFPRO PUPPY has expired and cannot be sold" | Pass | – |
| A26 | Sales | A price changed by the page is ignored | DRY: send the line with a price of 0.01 | The server's own price is used | The sale was about to be written at ₱1,560.00 | Pass | – |
| A27 | Sales | Discount limit | DRY: 5%, 50%, −10%, "abc" | Over the limit refused | 5% gives ₱1,482.00. 50%: 400 "The largest discount allowed at the till is 10%. Ask a manager to change the limit." −10% and "abc" are treated as no discount | Pass | – |
| A28 | Sales | The same product on two lines | DRY: two lines of 16 each for a product with 20 | Refused: 32 is more than 20 | Both lines pass, and two deductions of 16 were about to be written, which would leave −12. The till page merges lines, so this needs a hand-made request. **Now:** Lines for the same product are added together before the stock check, so 32 against 20 is refused, and a sale is saved as one line per product | Fixed – retest pending (`8cf9ba4`) | Medium |
| A29 | Alerts | Low stock starts at the right level | COPY and database | Every product at or below its reorder level is listed | 6 listed: 2 with none left and 4 below their level, the same 6 as the database. "kik" (1 left, level 2) is listed. No product is exactly at its level today, so that exact case could not be seen | Pass | – |
| A30 | Alerts | Alert clears when restocked | Needs a stock change | The product leaves the list | Not tested today. Read only: every unread low-stock or out-of-stock notice belongs to a product that is still low | Not Tested | – |
| A31 | Dashboard | Totals match the records | COPY against the database | Equal | Products 120, revenue ₱9,983,522.50 and "restock needed" 6 are equal. "2,341 transactions" counts 3 voided sales; Reports say 2,338. **Now:** Voided sales are left out of the count, and the card says how many more were voided | Fixed – retest pending (`bfd77f9`) | Low |
| A32 | Dashboard | Status in Recent sales | BROWSER: read the Recent sales list | Voided sales shown as voided | Sales #2578 and #1930 are voided in the database and shown as "Completed". The page reads a field the server does not send, so every sale says "completed". **Now:** Each sale shows its own status, and a voided one is marked | Fixed – retest pending (`acde06b`) | Medium |
| A33 | Reports | Totals match the records | COPY against the database | Equal | All time: 2,338 sales, ₱9,983,522.50, 10,370 items: equal. The rows by day, by week and by month each add up to the same. Last 30 days on screen (179 sales, ₱224,698.10, 347 items): equal | Pass | – |
| A34 | Reports | Revenue by category adds up to revenue | COPY | Equal, less discounts | Categories add up to ₱8,847,885.00; revenue is ₱9,983,522.50. See C04 for the reason. **Now:** Under the category bars the list now reads "Items sold, all categories", "Sales recorded without items" (199 sales, in no category) + ₱1,259,362.00, "Discounts given" − ₱123,724.50, and "Revenue". It adds up: ₱8,847,885.00 + ₱1,259,362.00 − ₱123,724.50 = ₱9,983,522.50 | Fixed – retest pending (`3c0e0a1`) | High |
| A35 | Reports | Date filter | COPY: 1 to 7 September 2026 | Only that week, by shop time | 45 sales and ₱68,095.50 in both Reports and Sales history, equal to the database. No row outside the range | Pass | – |
| A36 | Reports | Date filter with odd input | COPY: dates the wrong way round; a month in 2030; "2026-13-45" | Handled without an error | Wrong way round: 0 rows. 2030: 0. The impossible date is ignored and the whole history comes back, with no message. **Now:** Dates the wrong way round, and a date that does not exist, are now refused with the reason. No dates at all is still the whole history (`d07958e`) | Pass | – |
| A37 | Reports | Exports open correctly | BROWSER: capture each export | A well-formed file | Sales history: 2,341 rows of 10 columns. Reports: 30 rows of 4. Stock planning: 6 rows of 13. Import template: 1 row of 12. Every row has the right number of columns. **Now:** The Sales history export is now named with the date on the computer that downloads it, which on a shop computer is the shop's date. Between midnight and 8 am it carried the day before (`4fbd723`) | Pass | – |
| A38 | All | Saving for real: add, edit and delete a product, stock in and out, a sale, a void, receiving an order, end of day | Needs records to be created | Each saves and shows correctly | Not tested today: it creates records. 10 Oct: all of these were pressed with QA TEST records | Not Tested | – |

### B. Predictive analytics

| ID | Area | Test case | Steps | Expected result | Actual result | Status | Severity |
|---|---|---|---|---|---|---|---|
| B01 | Forecast | What is forecast, and how far ahead | Code and screen | Clear | Items sold per product per day for the next 30 days. From that: expected sales and revenue for 30 days, how long stock lasts, the run-out date, the order-by date, a suggested order, a reorder point, safety stock, too much stock, and stock likely to expire | Pass | – |
| B02 | Forecast | The method is the one the documents name | Code and screen against the test plan | The same method | The plan says linear regression. The system uses two machine-learning models (Random Forest and Gradient Boosting, one fit for all products), averaged, then mixed half and half with a "simple trend" made of smoothing, linear regression and a moving average. Linear regression is at most 15% of the final figure. The screen describes the real method. **Now:** The method itself changed in `3f4b61e`: a product with six weeks of sales is forecast by the two models alone. The page, the help guide and the assistant now say the same (`5fb2f31`). `QA/FORECAST-METHOD.md` (`9f72d40`) describes it, and its section 12 lists what to change in the paper, the slides and the test plan | Open: the documents are yours to change | High |
| B03 | Accuracy | Better than a rule of thumb | CODE: four held-back fortnights, 120 products each | Smaller error than simple rules | Average miss per product per fortnight: 1.55 items. "Average of the last 28 days": 1.58. "Same as the last 14 days": 1.65. So 2% and 6% better; on large misses 10% and 21% better. **Now:** Average miss 1.40 against 1.58 and 1.65: 11% and 15% better. On large misses 19% and 28% better | Pass | – |
| B04 | Accuracy | No steady lean to one side | CODE: the same four fortnights | Sometimes high, sometimes low | High every time: +41.5%, +24.2%, +42.7%, +36.5%. Together 1,064 forecast against 780 sold (+36%). **Now:** +13.9%, −9.1%, +21.3%, +30.0% (the same fortnights, in the same order). Together 901 against 780 (+15.6%). With settings chosen without sight of each fortnight: +18.9%. Still high in three of the four | Partly fixed – retest pending (`3f4b61e`) | High |
| B05 | Accuracy | The accuracy on the screen can be reproduced | CODE against the screen | The same figure | Screen: 58.5% (shown as 59%). Worked out separately: 226.4 forecast against 160 sold, which is 58.5%. The four other figures in the table were reproduced too. **Now:** The same test now gives 86.1% (182.2 against 160). This has not yet been read off the real screen | Pass | – |
| B06 | Accuracy | The machine-learning part does at least as well as the simple trend | Screen and CODE | At least as good | On the screen: "Both together (the ensemble) 35.2%", "Simple trend only 82.2%", "What this page uses 58.5%". Over four fortnights the simple trend was closer to the shop total every time. **Now:** For 27 Sep to 10 Oct the same test gives: both models together 84.1%, simple trend only 82.0%, what the page uses 86.1%. Over four fortnights the models have the smaller miss per product (1.47 against 1.58), and what the page uses is closer to the shop total in all four. The two models alone are closer to the shop total in only two of the four (989 against the simple trend's 974 over the four, with 780 sold), so the expected result is not fully met | Partly fixed – retest pending (`3f4b61e`) | High |
| B07 | Edge | A product with no sales | CODE and COPY | No forecast, said plainly | Expected 0, shown under "Not selling", no days-left figure. Its own forecast address answers 404 "No sales data". What the page shows when that product is opened was not looked at | Pass | – |
| B08 | Edge | A new product with one sale yesterday | CODE: one sale of 1; one sale of 5 | A cautious figure | 1 sold gives 30 expected in 30 days. 5 sold gives 150 expected; with 20 in stock: "4 days left, reorder now, order 165". Confidence is "low". **Now:** 1 sold gives 2.1 expected in 30 days. 5 sold gives 10.8, and with 20 in stock no order is suggested | Fixed – retest pending (`54a6680`) | Medium |
| B09 | Edge | One sale some time ago | CODE: 5 sold ten days ago; 5 sold sixty days ago | A small figure | 8.4 and 1.6 expected in 30 days | Pass | – |
| B10 | Edge | Constant sales | CODE: 3 a day for 120 days; 1 a day for 30 days | About the same rate | 87 in 30 days (2.9 a day); 30 in 30 days | Pass | – |
| B11 | Edge | A sudden spike | CODE: 2 a day, then 40 on the last day; the same spike a month ago | Not several times the usual | Spike on the last day: 187 for 30 days, about three times the usual 60, and "order 211". A month-old spike: 63. **Now:** The cap alone brought the spike day from 187 to 92 (`270ae10`). With the forecast as it now stands it gives 60.1 for 30 days, the same as with no spike. A month-old spike: 60.1 | Fixed – retest pending (`270ae10`, `3f4b61e`) | Medium |
| B12 | Edge | A sudden drop | CODE, and the real sales around the break in May | Follows the new level quickly | Made-up: 10 a day then 2 a day for 20 days gives 31.6 (the new rate is 60). Real: the first fortnight after the break was forecast 114% too high, the next 35% too low, the third 2% too high. **Now:** 10 a day then 2 a day for 20 days gives 30.4. A lasting rise is now followed more slowly than before: 2 a day then 10 a day for 14 days gives 100 (it gave 207; the new rate is 300). A rule for a clear change of level was tried and not added, because it never acted on a real product in the held-out fortnights. See `QA/FORECAST-METHOD.md`, section 11 | Not fixed | Low |
| B13 | Edge | A falling trend never gives a negative forecast | CODE: every figure produced in this test | No negative number anywhere | None, in 6,720 held-back product-days, 19 made-up histories and the live forecast of every product. Smallest forecast 0.05, smallest low bound 0 | Pass | – |
| B14 | Edge | Missing days and gaps | CODE: sold only every 7th day; a 30-day hole in the middle | Sensible | A day with no sale counts as zero. Every 7th day (true rate 25.7): 16.9. A hole in the middle (true rate 300): 268. **Now:** Every 7th day: 17.4. A hole in the middle: 181 (true rate 300), so a recent 30-day gap now pulls the forecast down further than it did | Pass | – |
| B15 | Edge | One freak value stays with its own product | CODE: add one made-up product to the real ones and refit | Other products unchanged | One day of 10,000 for one product: the other 120 products' forecast goes from 408 to 938 (+130%). 300 sold yesterday: +22.8%, 98 products move by more than 10%. An ordinary extra product: −3.2%. **Now:** One day of 10,000: the other products move by +4.1%, against +3.8% for the same product with no freak day. 300 on the last day: +4.1%, and 3 products move by more than 10% | Fixed – retest pending (`270ae10`) | High |
| B16 | Explain | Labelled as an estimate | BROWSER: Stock planning and one product | Yes | "Expected to sell, next 30 days", "Forecasts cover the next 30 days", and on a product: "Sales have been irregular, so this is a rough estimate." The chart draws the forecast dashed with a shaded range | Pass | – |
| B17 | Explain | The basis is shown | BROWSER | Period and method visible | "Based on 226 days of sales on record (the model reads up to 12 months)… Last sale recorded Oct 10, 2026." A section "How these numbers are worked out" explains the method, each figure and the accuracy test. **Now:** The line now says how many days the model reads, "(the model reads the last 120)". It no longer says "up to 12 months" (`3f4b61e`) | Pass | – |
| B18 | Explain | Limits are stated | BROWSER: read the whole page | A warning about seasons, holidays and promotions | No such warning. Nothing says 226 days cannot show a yearly season, that moving holidays and promotions are unknown to the model, or that the sales history is made up. The model's strongest input is "Month" at 36%. **Now:** The page has a section "What the forecast cannot know", and a note under the method table | Fixed – retest pending (`d6871c1`) | Medium |
| B19 | Consistency | The same input gives the same forecast | CODE: two separate fits; COPY: the page asked three times | Identical | 3,600 daily forecasts compared, 0 different. The page gave the same figures each time | Pass | – |
| B20 | Consistency | The same figure on two screens | COPY: the list against each product's own forecast | Equal | 119 equal, 0 different, 1 with no sales data | Pass | – |
| B21 | Consistency | Forecast changes after new sales | Needs a real sale and the next day | Changes | Not tested live. The forecasting code itself does change: one more day with 25 sold moved a product from 3.5 to 22.7. By the code, today's sales count from tomorrow, and the figures are refreshed at most every 5 minutes | Not Tested | – |
| B22 | Explain | Confidence | COPY | Low where little is known | 105 of 120 products are "low", 14 "high". A product whose only sale was 60 days ago gets "high". **Now:** No product reads "high" any more. The 14 that did were exactly the 14 that had sold nothing in 8 weeks: no sales was being scored as perfectly steady sales. All 119 now read "low", scores 35 to 39 (`377a063`) | Pass | – |

### C. Data integrity

| ID | Area | Test case | Steps | Expected result | Actual result | Status | Severity |
|---|---|---|---|---|---|---|---|
| C01 | Stock | The same stock everywhere | COPY against the database: Inventory, the tools list, the live refresh, the POS, Stock planning | Equal for every product | 120 products in each place, 0 different | Pass | – |
| C02 | Stock | The same counts everywhere | COPY against the database | Equal | Products 120, out of stock 2, low 4, expired 14, on every page that shows them | Pass | – |
| C03 | Stock | The same word means the same number | BROWSER | One number per label | Inventory card "Low stock 6" beside chip "Low stock 4". Inventory "Healthy 101" against Dashboard "in stock 114". Inventory "Overstock 0" against Stock planning "Too much stock: 112 products". **Now:** The Inventory cards now read "Restock needed" and "Over max level", and the Dashboard counts stock status the way Inventory does | Fixed – retest pending (`8dd5f9f`, `bfd77f9`) | Low |
| C04 | Sales | Each sale's total equals its lines | Database | Equal | 199 completed sales (#1097 to #1295, 10 to 27 May 2026) have no item lines at all: ₱1,259,362.00 of revenue with no products. Every other sale is right. **Now:** The 199 sales were not touched. Their effects are handled: the forecast leaves 10 to 31 May out of every product's history (`fbc407d`), and Reports show the ₱1,259,362.00 as its own line (`3c0e0a1`) | Open: the data is left as it is, at your instruction | High |
| C05 | Sales | Sales and stock history agree | Database | Each sale line has a stock movement | 4,473 sale lines, 59 stock movements for sales. The seeded history did not go through the till. **Now:** It is the data, not the code. It needs your decision (L13) | Not fixed | Low |
| C06 | Repeats | Double-click on a confirmation | BROWSER | The action runs once | Once | Pass | – |
| C07 | Repeats | Double-click on Save, Add product | BROWSER | One product | Two requests are sent. The second would be refused by the SKU rule, so no duplicate, but an error follows the success. **Now:** Save is now locked while saving, so a double-click sends one request (`c535a0a`) | Pass | – |
| C08 | Repeats | Double-click on Save adjustment | BROWSER | One stock change | Two requests: the stock would change twice. **Now:** A double-click sends one request, and the server writes a repeated request once | Fixed – retest pending (`93ba109`) | Medium |
| C09 | Repeats | Double-click on Save, Add supplier | BROWSER and DRY | One supplier | Two requests, and the server accepts the same name twice. **Now:** One request, and a name already in use is refused | Fixed – retest pending (`794c500`) | Medium |
| C10 | Repeats | A second Charge while the first sale is saving | BROWSER, with the save taking 1.5 s | One sale | Two sale requests. The cart stays full and Charge stays live until the answer comes. **Now:** Charge is locked while a sale is saving, and each sale carries a reference that the server saves only once | Fixed – retest pending (`93ba109`) | Medium |
| C11 | Input | Negative price, stock and reorder level | DRY | Refused | 400 each: "Unit price must be more than zero.", "Stock quantity cannot be less than zero.", "Reorder level cannot be less than zero." | Pass | – |
| C12 | Input | Letters in number fields, product | DRY: "abc" as price, stock, reorder level | Refused | 400 each, with the messages above | Pass | – |
| C13 | Input | Letters in number fields, stock change | DRY: quantity "abc" and "5abc"; an unknown kind of change | Refused | All three pass the handler's check. The page's own box only takes numbers, so this needs a hand-made request. What the database then does was not tested. **Now:** "abc", "5abc" and an unknown kind are each refused with a message | Fixed – retest pending (`2547ac2`) | Low |
| C14 | Input | Extremely large numbers | DRY: price 1,000,000,000,000; stock 99,999,999,999; a 300-letter name | Refused with a message | All pass the handler's checks, though each is over what the database column holds. The database's answer was not tested. **Now:** Each is refused, naming the field and its limit | Fixed – retest pending (`278e6ff`) | Low |
| C15 | Input | Empty text | DRY: product name and supplier name of only spaces | Refused | Product: 400 "Fill in this first: Product name." Supplier: accepted. The supplier check also accepts "abc" as an email and as a phone number. **Now:** A supplier name of only spaces is refused, and an email or phone has to look like one | Fixed – retest pending (`794c500`) | Low |
| C16 | Input | Dates | DRY (work branch): expiry yesterday, "abc", 30 February, year 2099 | Past and impossible dates refused | Yesterday: 400 "The expiration date cannot be earlier than today." "abc" and 30 February: 400 "Enter the expiration date as a real date." 2099 accepted | Pass | – |
| C17 | Input | Odd input in read addresses | COPY: 27 requests with letters, huge numbers, SQL-style text and tags | No server error | No server error. Unknown records answer 404 with a plain message | Pass | – |

### D. Security (nothing destructive)

| ID | Area | Test case | Steps | Expected result | Actual result | Status | Severity |
|---|---|---|---|---|---|---|---|
| D01 | Access | Pages without a sign-in, live site | LIVE: open 12 pages directly; with a made-up cookie; with a token in the address | Sent to sign-in | 12 of 12 sent to `/login.html`. The made-up cookie and the token in the address too | Pass | – |
| D02 | Access | Read addresses without a sign-in, live site | LIVE: 45 addresses, with nothing and with a made-up token | Refused | 45 of 45 refused both ways. An address that does not exist: 404 | Pass | – |
| D03 | Access | Every protected address, every method | LOCAL: 92 addresses (45 read, 47 that save or delete) | Refused | 92 of 92 refused without a sign-in, 92 of 92 with a made-up token | Pass | – |
| D04 | Roles | Lower roles cannot reach administrator or manager actions | The permission checks of 95 addresses, tried as five roles; no handler was run | Refused | 14 addresses let only the administrator through, 21 only administrator and manager, 7 only the cashier. A viewer gets through no add, edit or delete of products, sales, suppliers, orders or users. **Now:** 15 addresses now let only the administrator through, and 23 only administrator and manager, after the fixes to D05 (`352845e`) and D11 (`217dfba`) | Pass | – |
| D05 | Roles | View-only account and notifications | The same check, and the code | Refused | A viewer gets through "mark all read", "mark one read" and "clear read". Nothing in the address or its handler checks the role. Read state is shared, so this changes and removes everyone's notices. **Now:** A viewer is refused on all three. Administrators and managers can still do them | Fixed – retest pending (`352845e`) | Medium |
| D06 | Input | A tag in a text field is shown as text | BROWSER: `<b>TEST_xss</b>` with a script trigger added to every text field in 96 server answers; 33 views on 10 pages | Shown as text, nothing runs | Nothing was drawn as HTML and nothing ran. The marker showed as plain text everywhere | Pass | – |
| D07 | Input | A tag or SQL-style text is stored as plain text | DRY: `<b>TEST_xss</b>` and `TEST_' OR '1'='1` as product name, supplier name, customer name and stock reason | Stored as typed, or refused | Accepted as plain text; every statement passes its values separately from the SQL | Pass | – |
| D08 | Input | SQL-style text in search and sign-in | COPY and LOCAL | No effect | Product and sales search: 0 rows. Sign-in: 401. "1 OR 1=1" as a category is read as 1 | Pass | – |
| D09 | Secrets | Passwords are not exposed | COPY: every read answer scanned; LIVE: the sign-in page source | None anywhere | No password, password hash or sign-in token in 172 answers. The sign-in boxes have no field name, so they cannot end up in the address | Pass | – |
| D10 | Secrets | Security headers, live site | LIVE | Present | Content-Security-Policy, X-Frame-Options DENY, nosniff, HSTS, Referrer-Policy and Permissions-Policy are sent. Plain http is moved to https. Another website cannot read the answers. Two soft spots: `X-Powered-By: Express` is sent, and the policy allows inline scripts. **Now:** `X-Powered-By` is no longer sent (`7698cb6`). The policy still allows inline scripts | Pass | – |
| D11 | Records | A sale cannot be erased without trace | Code and BROWSER | Only voiding | An administrator or a manager can delete a sale for good. A confirmation is shown. The Activity log records that it happened, not what the sale was. **Now:** Only an administrator can delete a sale. The Activity log keeps a copy of it: its number, date, cashier, customer name, totals, payment status, notes and every item (not the customer's phone number). A voided sale's stock is not returned a second time | Fixed – retest pending (`217dfba`) | Medium |

### E. Usability and performance

| ID | Area | Test case | Steps | Expected result | Actual result | Status | Severity |
|---|---|---|---|---|---|---|---|
| E01 | Messages | Errors and successes are clear | Every message quoted in this report | Plain and specific | They name the field or the reason. One exception: a sale quantity of "abc" is refused as "Insufficient stock… requested: abc". **Now:** That one now reads "Each item needs a quantity above zero, as a number" (`8cf9ba4`, `ce584e3`) | Pass | – |
| E02 | Messages | Confirmation before deleting | BROWSER: Delete on a product, a supplier, a user and a sale | Asks first | All four ask, and Cancel sends nothing. The supplier one also says how many products and orders it would leave behind. The user one is titled "Delete user" but deactivates. **Now:** The user one is now titled "Deactivate account" and names the account (`ce584e3`) | Pass | – |
| E03 | Layout | Desktop width | BROWSER: 12 screens at 1366 px | No sideways scrolling | 12 of 12 fit | Pass | – |
| E04 | Layout | Phone width | BROWSER: 12 screens at 375 px | No sideways scrolling | 12 of 12 fit. Screenshots of Inventory and the POS look right | Pass | – |
| E05 | Speed | Live site, public pages, once warm | LIVE: 7 requests each | Under 1 second | Median: sign-in page 0.29 s, stylesheet 0.33 s, script 0.31 s, health check 0.21 s. The first request after a rest took 22.7 s: that is the free hosting waking up | Pass | – |
| E06 | Speed | Signed-in addresses | COPY on this computer | Under 2 seconds | Most 0.1 to 0.5 s. Sales report 1.1 s. Dashboard totals 2.5 to 2.7 s, the slowest. Stock planning 8.7 s the first time after a restart, 0.5 s after that. **Now:** Dashboard totals now take about 0.1 to 0.2 s on the real data, read only (`bfd77f9`) | Pass | – |
| E07 | Speed | Signed-in pages on the live site | Needs a sign-in | Under 2 seconds | Not tested: it needs a sign-in on the live site | Not Tested | – |
| E08 | Stability | Script errors on pages | BROWSER: every page opened in this test | None | None | Pass | – |

## 3. Forecast accuracy

**What was compared.** The system's own forecast, made by its own code, against sales it was not shown. For each test the last 14 days were hidden, the forecast was made from everything before, and the two were compared. This was done four times, each a fortnight further back.

**Products:** all 120 that have ever sold. **Sales used:** 28 February to 10 October 2026: 2,338 completed sales, 4,473 lines, 10,370 items.

| Test fortnight | Trained on | Whole shop: forecast against sold | Per product, 14 days: MAE / RMSE / MAPE | Per product per day: MAE / RMSE / MAPE |
|---|---|---|---|---|
| 27 Sep to 10 Oct | 28 Feb to 26 Sep | 226.4 against 160 (+41.5%) | 1.42 / 1.71 / 67.8% | 0.208 / 0.403 / 86.6% |
| 13 to 26 Sep | 28 Feb to 12 Sep | 217.4 against 175 (+24.2%) | 1.37 / 1.67 / 63.4% | 0.212 / 0.402 / 88.3% |
| 30 Aug to 12 Sep | 28 Feb to 29 Aug | 299.7 against 210 (+42.7%) | 1.68 / 2.10 / 74.6% | 0.272 / 0.491 / 84.9% |
| 16 to 29 Aug | 28 Feb to 15 Aug | 320.8 against 235 (+36.5%) | 1.73 / 2.14 / 86.3% | 0.290 / 0.485 / 82.8% |
| **All four** | | **1,064.3 against 780 (+36.4%)** | **1.55 / 1.92 / 73.8%** | **0.246 / 0.447 / 85.4%** |

MAE and RMSE are in items. MAPE can only be worked out where something was sold: 311 of the 480 product-fortnights, and 538 of the 6,720 product-days.

**The same test, method by method** (all four fortnights, per product per 14 days):

| Method | MAE | RMSE | Whole shop against 780 sold |
|---|---|---|---|
| What the page uses (machine learning mixed with the simple trend) | 1.549 | 1.917 | 1,064 (+36%) |
| Simple trend only | 1.580 | 2.183 | 973 (+25%) |
| Machine learning only (both models) | 1.633 | 1.949 | 1,153 (+48%) |
| Random Forest only | 1.656 | 1.969 | 1,178 (+51%) |
| Gradient Boosting only | 1.641 | 1.973 | 1,127 (+45%) |
| Rule of thumb: the same as the last 14 days | 1.648 | 2.422 | 919 (+18%) |
| Rule of thumb: the average of the last 28 days | 1.577 | 2.137 | 999 (+28%) |

**What this means, in plain words**

- **The shop sells very little of each product.** In the latest fortnight it sold 160 items across 120 products, and 51 products sold nothing. On 9 product-days out of 10 nothing is sold. So an average miss of about 1.5 items per product per fortnight is roughly as large as the sales themselves.
- **MAPE is a poor ruler for this shop.** It cannot be worked out where nothing sold, which is most of the time. Where it can, the forecast is off by about three-quarters of what was sold. MAE and the whole-shop total say more.
- **The forecast runs high.** It was above what was sold in all four fortnights, by 24% to 43%. Sales have been falling since July, and the model still learns from March to May, when the shop sold four to five times more.
- **It is only a little better than a rule of thumb per product.** 2% better than "the average of the last 28 days" and 6% better than "the same as the last fortnight". It does avoid large misses better (10% to 21%).
- **The machine-learning part does not beat the simple trend on the shop total.** The simple trend was closer in all four fortnights. Mixed together they give the smallest miss per product.
- **The page's own accuracy figure is honest.** It shows 59%. Worked out separately from the same data it is 58.5%.
- **These numbers describe the model on made-up sales.** They do not show how it would do on the shop's real demand.

**The real break in the sales history, replayed**

The history has three parts: about 100 items a day until 9 May, then 22 days with no item sold (see C04), then about 25 a day from June, falling to about 12 now.

| Trained up to | Test fortnight | Forecast | Sold | Miss |
|---|---|---|---|---|
| 25 Apr | 26 Apr to 9 May | 1,440 | 1,784 | −19% |
| 9 May | 10 to 23 May | 1,915 | 0 | no sales at all |
| 31 May | 1 to 14 Jun | 748 | 349 | +114% |
| 14 Jun | 15 to 28 Jun | 234 | 362 | −35% |
| 28 Jun | 29 Jun to 12 Jul | 425 | 416 | +2% |
| 12 Jul | 13 to 26 Jul | 341 | 283 | +20% |

After the level changed it took about four weeks to settle. In the first fortnight the simple trend alone gave 320 (close to the 349 sold) and the machine-learning part alone gave 1,174.

**Edge cases** (made-up sales histories, forecast together with the real products, as the system would)

| Sales history | Forecast, next 30 days | With 20 in stock the page would say |
|---|---|---|
| Never sold | 0, "Not selling" | Enough stock |
| One sale of 1, yesterday | 30 | 20 days left, reorder soon, order 17 |
| One sale of 5, yesterday | 150 | 4 days left, reorder now, order 165 |
| One sale of 5, ten days ago | 8.4 | Enough stock |
| One sale of 5, sixty days ago | 1.6 | Enough stock |
| 3 a day for 120 days | 87 | 6 days left, reorder now, order 88 |
| 2 a day, then 40 on the last day | 187 | 3 days left, reorder now, order 211 |
| 2 a day, with one day of 40 a month ago | 63 | 9 days left, reorder soon, order 58 |
| 10 a day, then nothing for 20 days | 2.3 | Enough stock |
| 10 a day, then 2 a day for 20 days | 31.6 | 18 days left, reorder soon, order 19 |
| 2 a day, then 10 a day for 14 days | 207 | 2 days left, reorder now, order 236 |
| Falling steadily from 10 to 0 over 120 days | 7.4 | Enough stock |
| Falling from 20 to 0 over 20 days | 113 | 5 days left, reorder now, order 120 |
| 6 items every 7th day | 16.9 | Enough stock |
| 10 a day, a 30-day hole, 10 a day again | 268 | 2 days left, reorder now, order 311 |

No forecast, range or order quantity was negative in any case.

### After the fixes

Everything above is the forecast as it was first tested. The same four fortnights, with the code as it now stands (`node scripts/forecast-backtest.js 2026-10-10 2026-09-26 2026-09-12 2026-08-29`):

| Test fortnight | Whole shop: forecast against sold | Per product, 14 days: MAE / RMSE / MAPE | Before |
|---|---|---|---|
| 27 Sep to 10 Oct | 182.2 against 160 (+13.9%) | 1.26 / 1.58 / 52.5% | 226.4 (+41.5%), 1.42 / 1.71 / 67.8% |
| 13 to 26 Sep | 159.1 against 175 (−9.1%) | 1.21 / 1.54 / 48.4% | 217.4 (+24.2%), 1.37 / 1.67 / 63.4% |
| 30 Aug to 12 Sep | 254.7 against 210 (+21.3%) | 1.57 / 1.87 / 64.5% | 299.7 (+42.7%), 1.68 / 2.10 / 74.6% |
| 16 to 29 Aug | 305.5 against 235 (+30.0%) | 1.57 / 1.94 / 71.1% | 320.8 (+36.5%), 1.73 / 2.14 / 86.3% |
| **All four** | **901.4 against 780 (+15.6%)** | **1.40 / 1.74 / 59.9%** | **1,064.3 (+36.4%), 1.55 / 1.92 / 73.8%** |

Per product per day: MAE 0.226, RMSE 0.443, MAPE 87.8% (it was 0.246, 0.447, 85.4%).

| Product group | Before: MAE / RMSE / whole group | Now: MAE / RMSE / whole group |
|---|---|---|
| Food | 1.317 / 1.588 / +67.9% | 1.227 / 1.456 / +37.2% |
| Health & Wellness | 1.856 / 2.325 / +18.8% | 1.586 / 2.051 / +2.9% |
| Accessories | 1.622 / 1.926 / +16.1% | 1.557 / 1.872 / +2.8% |
| Litter & Waste | 1.870 / 2.160 / +37.6% | 1.660 / 1.935 / +15.8% |

| Method, now | MAE | RMSE | Whole shop against 780 sold |
|---|---|---|---|
| What the page uses (the two models, then the correction for the last miss) | 1.402 | 1.741 | 901 (+16%) |
| The two models, before that correction | 1.472 | 1.810 | 989 (+27%) |
| Simple trend only | 1.582 | 2.188 | 974 (+25%) |
| Rule of thumb: the average of the last 28 days | 1.577 | 2.137 | 999 (+28%) |
| Rule of thumb: the same as the last 14 days | 1.648 | 2.422 | 919 (+18%) |
| Forecast nothing at all | 1.625 | 2.422 | 0 |

**The figure to quote.** The settings were chosen by a walk-forward test: each fortnight was scored with settings picked only from fortnights before it. That gives **+18.9% and MAE 1.45** over the four. The +15.6% above is the code as it stands, on fortnights that also helped choose its final settings, so it is slightly flattering. `QA/FORECAST-METHOD.md`, section 10, has the test.

**What this means now**

- The forecast still runs high, by about half as much as before. Food is the worst group.
- It is now 11% better than the best rule of thumb per product, and 19% better on large misses. It was 2% and 10%.
- "Forecast nothing at all" misses by 1.63 items. A product here sells one or two items a fortnight, so no method can have a small error per product. The forecast is of most use for a category or the whole shop.
- The page's accuracy figure for the latest fortnight is now 86.1% by the same test (it showed 58.5%). That is accuracy for the shop total, not error per product.

**Edge cases, now** (each made-up product added alone to the 120 real ones)

| Sales history | Forecast, next 30 days: before | Now |
|---|---|---|
| One sale of 1, yesterday | 30 | 2.1 |
| One sale of 5, yesterday | 150, "order 165" | 10.8, no order |
| One sale of 5, ten days ago | 8.4 | 10.8 |
| One sale of 5, sixty days ago | 1.6 | 1.7 |
| 3 a day for 120 days | 87 | 87.9 |
| 2 a day, then 40 on the last day | 187, "order 211" | 60.1, "order 55" |
| 2 a day, with one day of 40 a month ago | 63 | 60.1 |
| 10 a day, then nothing for 20 days | 2.3 | 4.9 |
| 10 a day, then 2 a day for 20 days | 31.6 | 30.4 |
| 2 a day, then 10 a day for 14 days | 207 | 100.4 |
| Falling steadily from 10 to 0 over 120 days | 7.4 | 6.3 |
| Falling from 20 to 1 over 60 days | 43.5 | 73.3 |
| Falling from 20 to 0 over 20 days | 113 | 113 |
| 6 items every 7th day | 16.9 | 17.4 |
| 10 a day, a 30-day hole, 10 a day again | 268 | 181 |
| 1 a day with one day of 1,000,000 | 79,559, "order 98,104" | 26.1, no order |

Three rows went the wrong way and are stated as limits in `QA/FORECAST-METHOD.md`, section 11: a lasting rise is followed more slowly (2 then 10 a day), a fast fall is kept higher (20 to 1 over 60 days), and a recent gap lowers the forecast further (the 30-day hole: 268 before, 181 now, where the true rate is 300). No forecast, range or order quantity was negative.

## 4. Bugs and findings, most serious first

Nothing found would lose data or let someone in without a sign-in. There is no Critical item.

### High

**H1. One freak sale changes every product's forecast.** (B15)
One model is fitted on all products together, and nothing trims an extreme day before it learns.
To reproduce: with the forecasting code, add one product that sells 1 a day and has one day of 10,000, and refit. The other 120 products' 30-day forecast rises from 408 to 938. With 300 sold yesterday it rises 22.8%.
In the shop this needs a product with a very large stock figure, because a sale cannot exceed the stock. In a user test, a tester typing a huge stock and a huge sale would bend the whole Stock planning page the next day. Voiding the sale undoes it.
**Fixed – retest pending** (`270ae10`). A day now counts for no more than a cap, the larger of 5 and 4 times the product's typical selling day, before any model sees it. The same test moves the other products by +4.1%, against +3.8% for the same product with no freak day.

**H2. 199 sales have no items.** (C04, A34)
To reproduce: Sales history, open sale #1097. It shows a total of ₱12,650.00 and an empty item list. The same for #1097 to #1295 (10 to 27 May 2026): ₱1,259,362.00 in all.
Effects: revenue by category does not add up to revenue; "items sold" is short; and the forecast sees 22 days in which nothing sold, followed by a level four to five times lower.
**The data is left as it is, at your instruction. Its effects are fixed – retest pending** (`fbc407d`, `3c0e0a1`). The forecast leaves 10 to 31 May out of every product's history, and says so on the page. Reports show the ₱1,259,362.00 as its own line, so revenue by category adds up. "Items sold" is still short by whatever those 199 sales held.

**H3. The forecast runs 24% to 43% high, and the machine-learning part is behind the simple trend.** (B04, B06)
To reproduce: Reports, Stock planning, "How good is the forecast". It reads: Random Forest alone 45.2%, Gradient Boosting alone 25.2%, both together 35.2%, simple trend only 82.2%, what this page uses 58.5%.
This is the page being honest. It is also the first thing a panel will ask about.
**Partly fixed – retest pending** (`3f4b61e`). The other forecast fixes (`270ae10`, `54a6680`, `fbc407d`) are part of the code that was tested, but by themselves they did not move this figure. The forecast now runs 15.6% high over the four fortnights (18.9% with settings chosen without sight of each fortnight). It was 36.4%. It is still above what sold in three of the four. The machine-learning part now has the smaller miss per product, though by itself it is still no closer to the shop total than the simple trend (B06). Section 3 has the figures, and `QA/FORECAST-METHOD.md` the method.

**H4. The method is named differently in different places.** (B02)
The test plan says linear regression. The system, and its own on-screen explanation, say Random Forest and Gradient Boosting mixed with a simple trend. Check that the paper, the slides and the plan all say the same as the system.
**Open: the documents are yours to change.** The system now says one thing in every place: the page, the help guide and the assistant (`5fb2f31`). `QA/FORECAST-METHOD.md` (`9f72d40`) describes the method as the code runs it, and its section 12 lists what to change in the paper, the slides and the test plan.

### Medium

**M1. A product's first-day sale is taken as its daily rate.** (B08)
To reproduce: a new product sells 5 on its first day. The next day Stock planning expects 150 in 30 days and suggests ordering 165.
**Fixed – retest pending** (`54a6680`). Until a product has 14 days on record, what it has sold is spread over 14 days: 5 sold gives 10.8 expected, and no order.

**M2. A spike on the most recent day triples the forecast.** (B11)
To reproduce: a product selling 2 a day sells 40 in one day. The next day it expects 187 in 30 days instead of about 60. A month later it is back to 63.
**Fixed – retest pending** (`270ae10`, with `3f4b61e`). The cap alone brought the spike day from 187 to 92. With the forecast as it now stands it gives 60.1, the same as with no spike.

**M3. The Dashboard shows voided sales as "Completed".** (A32)
To reproduce: Dashboard, Recent sales. #2578 "QA TEST" and #1930 are voided, and both show "Completed". Cause: `src/js/dashboard.js` reads `s.status`; the server sends `payment_status`.
**Fixed – retest pending** (`acde06b`).

**M4. Double-clicking "Save adjustment" changes the stock twice.** (C08)
To reproduce: Inventory, Stock on any product, quantity 1, double-click Save adjustment. Two requests are sent. The button is not locked while saving, and the server takes both.
**Fixed – retest pending** (`93ba109`). The button is locked while saving, and the server writes a repeated request once.

**M5. A second charge can go through while the first sale is still saving.** (C10)
To reproduce: at the till on a slow connection, press Charge and confirm, then press Charge and confirm again before the cart empties. Two sales are sent.
**Fixed – retest pending** (`93ba109`). Charge is locked while saving, and each sale carries a reference the server saves only once.

**M6. Suppliers can be duplicated, and their details are not checked.** (C09, C15)
To reproduce: Add supplier, double-click Save: two requests. The server also accepts a name already in use, a name of only spaces, and any text as email or phone.
**Fixed – retest pending** (`794c500`).

**M7. Removing more stock than exists is accepted without a word.** (A20)
To reproduce: Stock on a product with 20, choose Remove Stock, quantity 999999, save. Stock becomes 0, the history says −999,999, and the page says the levels are up to date.
**Fixed – retest pending** (`9051de7`). The page stops it before sending: "Only 20 in stock: you cannot remove 999,999." A hand-made request gets the same refusal from the server.

**M8. The same product on two lines of one sale can sell more than the stock.** (A28)
To reproduce: send a sale with two lines of 16 for a product with 20. Each line is checked against 20 on its own. The till page merges lines, so this needs a hand-made request from a signed-in cashier.
**Fixed – retest pending** (`8cf9ba4`).

**M9. A view-only account can mark every notice read and clear them.** (D05)
To reproduce: as a viewer, call "mark all read" or "clear read". No role is checked. The buttons on the Notifications page were not pressed in this test.
**Fixed – retest pending** (`352845e`). Only an administrator or a manager can mark notices read or clear them.

**M10. A sale can be deleted for good.** (D11)
To reproduce: Sales history, open a sale, Delete sale, confirm. The record is gone and the stock is returned. The Activity log keeps no copy of the sale. Voiding already exists for mistakes.
**Fixed – retest pending** (`217dfba`). Deleting is for the administrator only, and the Activity log keeps a copy of the sale: its number, date, cashier, customer name, totals, payment status, notes and every item. A sale can still be deleted; voiding remains the way to correct a mistake. One thing to know: the copy is written straight after the delete, so if that one write failed, the delete would stand without it.

**M11. The forecast page does not say what it cannot know.** (B18)
With 226 days of history it cannot have seen a year. Its strongest input is "Month" (36%), which in this data marks the break in May more than any season. Moving holidays and promotions are not inputs. None of this is on the page.
**Fixed – retest pending** (`d6871c1`). The page says what the forecast cannot know. "Month" is still one of the model's inputs.

### Low

- **L1. Labels that disagree.** (C03, A31) "Low stock" is 6 on the Inventory card and 4 on the chip beside it. "In stock" is 114 on the Dashboard and 101 ("Healthy") on Inventory, because the Dashboard counts 13 expired products. "Overstock" is 0 on Inventory while Stock planning lists 112 products with too much stock. Transactions are 2,341 on the Dashboard and Sales history and 2,338 in Reports, because the first two count voided sales. **Fixed – retest pending** (`8dd5f9f`, `bfd77f9`). A correction to the finding: the 114 was in the figures the server sends for the Dashboard, not on a screen. The server now counts it the way Inventory does.
- **L2. "Adjustment" and "Damage" always subtract.** (A21) Nothing on the form says so. **Fixed – retest pending** (`2547ac2`).
- **L3. Deleting a product.** (A15) A product that does not exist is answered "Product deleted successfully". A product with stock on hand is deleted with no warning. **Fixed – retest pending** (`c535a0a`).
- **L4. A product in clear decline is kept high.** (B12) The forecast never goes below 55% of the last two weeks, so a product falling from 20 a day to 0 over 20 days is still expected to sell 113. **Not fixed.** This case has 20 days on record, so it is still forecast by the simple trend with its floor, and still gives 113. A rule for a clear drop in level was tried: it never acted on a real product in the held-out fortnights, so it could not be tested on this shop's data, and was not added. A lasting rise is now followed more slowly than before. See `QA/FORECAST-METHOD.md`, section 11.
- **L5. Very large values pass the server's own checks.** (C13, C14) A price of 1,000,000,000,000, a 300-letter name, letters as a stock quantity. The database would most likely refuse them with a general error; that was not tested. **Fixed – retest pending** (`278e6ff`, `2547ac2`). Each is refused by the server with the field named, so the database is never asked.
- **L6. Two products can have the same name.** (A12) **Fixed – retest pending** (`c535a0a`). The server asks first, and saves under the same name only when told to.
- **L7. The Sales export file is named with the wrong day** between midnight and 8 am: `sales_export_2026-10-10.csv` at about 1:30 am on 11 October. The Reports export uses the right day. **Fixed – retest pending** (`4fbd723`). The backup had the same fault, and was also saved under a `.json.gz` name though it is a zip; both are fixed in the same commit.
- **L8. The Dashboard totals are the slowest request** (2.5 to 2.7 s). It loads all 2,341 sales to count them. **Fixed – retest pending** (`bfd77f9`). About 0.1 to 0.2 s on the real data, read only.
- **L9. Headers.** (D10) `X-Powered-By: Express` is sent. The content policy allows inline scripts, so the escaping on each page is what stops a script, and that held in every view tested. **Half fixed – retest pending** (`7698cb6`). `X-Powered-By` is no longer sent. The policy still allows inline scripts: the pages carry about 287 such handlers, so it cannot be tightened without rewriting them.
- **L10. Search.** `%` or `_` in the product search matches everything. Impossible dates in a report address return the whole history with no message. **Fixed – retest pending** (`d07958e`).
- **L11. Wording.** The user dialog says "Delete user" and "Yes, Delete" but deactivates. A sale quantity of "abc" is refused as "Insufficient stock". **Fixed – retest pending** (`ce584e3`, `8cf9ba4`). Retesting the quantity message found one more case, also fixed: a list holding one number, such as [3], was read as 3.
- **L12. Confidence reads "high" for a product that does not sell.** (B22) **Fixed – retest pending** (`377a063`). All 119 products now read "low".
- **L13. The seeded data.** Cost equals selling price for 119 of 120 products, so any margin is zero. 4,473 sale lines have only 59 stock movements behind them. 13 products are expired with stock on the shelf, two of them dated February 2025. **Not fixed.** It is the data, and it needs your decision. Nothing in the database was changed.
- **L14. Sign-in, by reading the code only.** An unknown user name is answered before any password work is done, and a deactivated account gets its own message ("User account is inactive"). Either could tell someone a name exists. One timing was taken, which is not enough to show it. **Fixed – retest pending** (`ce07f9b`), and one part of this finding was wrong. Measured on a test server, an unknown name was answered in about 2 ms and a wrong password for a real account in about 118 ms; both now take about 121 ms. The message for a deactivated account could never be shown: the lookup already leaves such accounts out, so they were always answered like an unknown name. That unreachable line is removed. A third way to tell was found and closed: a password sent as a number or a list got "Server error during login" for a real name only.

## 5. Summary

**Pass rate.** 96 test cases. 63 passed, 27 failed, 6 were not tested. Of the 90 that were run, 70% passed.

| Area | Cases | Pass | Fail | Not tested |
|---|---|---|---|---|
| A. Functional | 38 | 26 | 8 | 4 |
| B. Predictive analytics | 22 | 13 | 8 | 1 |
| C. Data integrity | 17 | 8 | 9 | 0 |
| D. Security | 11 | 9 | 2 | 0 |
| E. Usability and performance | 8 | 7 | 0 | 1 |

By severity, the 27 failed rows are 6 High, 11 Medium and 10 Low. Section 4 groups rows that share a cause, and adds small points noted on rows that passed: 4 High, 11 Medium, 14 Low.

**What held up well:** every protected page and address refuses without a sign-in, on the live site and locally; roles are fenced as designed; no tag or script was displayed as HTML in the 33 views tried; no password or token appears in any answer; stock is the same number in five places; report totals match the database to the centavo; the forecast never goes negative, always gives the same answer for the same input, and says on screen how it was worked out.

**Top 5 to fix before the defense**

1. **Make the documents and the system say the same method, and have an answer for the 59%.** (H4, H3) The page shows the machine-learning models at 35.2% and the simple trend at 82.2%.
2. **Repair the sales history.** (H2) 199 sales without items, and a level that drops four to five times in one step, sit under every chart and every forecast.
3. **Protect the forecast from freak values and from products with almost no history.** (H1, M1, M2)
4. **Stop double saves and the stock gaps.** (M4, M5, M6, M7, M8)
5. **Fix what a panelist sees in the first five minutes.** (M3, L1) Voided sales shown as "Completed", and two different "Low stock" numbers side by side.

**Risks to credibility during user testing**

- **The first page load can take 20 seconds or more.** The free hosting sleeps; the first request in this test took 22.7 s. Open the site a few minutes before a demo.
- **The live site is two commits behind.** A tester there can still add a product with no supplier and enter an expiration date in the past.
- **Testers type big numbers.** One large test sale changes every forecast the next day (H1).
- **The sales are made up.** The accuracy figures describe the model on this data set. Say so before someone asks.
- **The screen shows the weak points.** "Forecast accuracy 59%", the method table, 112 products with too much stock, 13 expired products with stock. Each is correct for the data, and each needs a sentence of explanation.
- **The history shows a cliff in May.** Anyone looking at "Sales by month" will see it.

### After the fixes

| Area | Failed | Fixed – retest pending | Partly fixed | Open or not fixed |
|---|---|---|---|---|
| A. Functional | 8 | 8 | 0 | 0 |
| B. Predictive analytics | 8 | 4 | 2 (B04, B06) | 2 (B02, B12) |
| C. Data integrity | 9 | 7 | 0 | 2 (C04, C05) |
| D. Security | 2 | 2 | 0 | 0 |
| E. Usability and performance | 0 | 0 | 0 | 0 |
| **All** | **27** | **21** | **2** | **4** |

Of the findings in section 4: H1 is fixed; H2 has its effects fixed and its data left alone; H3 is partly fixed; H4 waits on the documents. All 11 Medium findings are fixed. Of the 14 Low findings, 11 are fixed, L9 is half fixed, and L4 and L13 are not.

**The top 5, now.** 1: the system says one thing everywhere, and the documents are still to be brought into line; the page's figure is 86.1% by the same test. 2: the history was not repaired; its effects on the forecast and on the reports were. 3, 4 and 5: fixed.

**Still true for user testing:** the first page load after a rest is slow; the live site does not have any of this until it is deployed; the sales are made up; and the history shows a cliff in May.

**New things to be ready for:** every product now reads "low" confidence; a product whose sales rise for good is under-forecast for some weeks; and the forecast's settings were chosen in months when sales only fell.

## 6. TEST_ records created

**None.** Nothing was saved in this run.

- Text beginning `TEST_` was sent only to handlers whose database writes were blocked, to the read-only copy, or to saves answered inside the test browser.
- The row counts of products, stock, sales, sale lines, suppliers, users, stock movements, activity log and notifications were the same before and after. A search for products, suppliers, sales and users beginning `TEST_` finds 0.
- Eight sign-in attempts were made, all refused (seven locally, one on the live site). A refused sign-in is counted in the server's memory only; it writes nothing and sends nothing.

There is nothing to clean up.

## What was not tested, and what it needs

| Not tested | Needs |
|---|---|
| A real sign-in and sign-out, and session expiry (A05, A06) | You signing in, or temporary accounts. I do not type passwords |
| Saving for real: a TEST_ product added, edited and deleted; stock in and out; a sale and the stock after it; a void; an alert appearing and clearing (A30, A38) | Your yes to create TEST_ records in the shared database, removed afterwards |
| The forecast changing after a real sale (B21) | A real test sale, then a look the next day |
| What the database does with letters and oversized numbers (C13, C14) | No longer needed: the server now refuses these itself, before the database is asked (L5) |
| Page speed on the live site while signed in (E07) | A sign-in on the live site |
| The printer and the scanner | Left out, as you asked |

### The six cases that need real saves: what each would create

None of these was run. A38 covers several kinds of save, so it takes more than one line below. The rows were counted by doing the same actions on the separate test database. "Notice" means a row in the notifications list; "log row" a row in the Activity log.

| Case | What it would create in the shared database | How it would be removed |
|---|---|---|
| A TEST_ product, added, edited and deleted (A38) | Adding: 1 product, 1 log row, 1 notice. Editing: 1 log row. Deleting in the app: 1 log row, and the product row stays, hidden | The app never erases a product. Erasing the hidden row, its notice and its stock history needs a direct delete in the database, which is a separate yes |
| Stock in and stock out on that product (A38) | Each change: 1 stock history row, 1 log row, 1 notice. The product's stock changes | Rows as above |
| A real sale of that product at the till, then the stock after it (A38, B21) | 1 sale, 1 sale line per product, 1 stock history row per line, 1 log row, 1 notice (2 if the sale takes the product to or below its reorder level). The sale has to be made from a cashier account: if that cashier has not opened the till today, the till first asks for the starting cash, which is 1 till-opening row and 1 log row. Stock goes down. Revenue and the day's sales count go up until the sale is voided, and the sale counts in that cashier's expected cash for the end-of-day count. The next day the product appears in Stock planning as a new product, unless the sale has been voided by then | Void it (1 more stock history row and 1 log row; the sale stays, marked voided, out of every total), then delete it as administrator (the sale and its lines go; the log keeps a copy) |
| An alert appearing and clearing (A30) | Taking the TEST_ product below its reorder level: 1 stock history row, 1 log row, 2 notices (the change, and "low stock"). Restocking: the same again with 1 notice. On the test database the product then left the reorder list, and the "low stock" notice stayed until read | Rows as above. "Mark all read" and "Clear read" would not be pressed: they act on the shared notices that everyone sees |
| Page speed on the live site, signed in (E07) | One sign-in: 1 log row and 1 notice. Opening pages creates nothing, with one exception: the Notifications page asks the server to run its stock check at once. That check can add low-stock, expiry and overstock notices and send the day's low-stock email to suppliers, exactly as the server does by itself every hour. That page would be left out of the timing | Nothing to remove but those two rows |
| A real sign-in, sign-out and session expiry (A05, A06) | Each sign-in: 1 log row and 1 notice. Signing out creates nothing. Expiry creates nothing, but can only be seen by waiting 24 hours | As above |
| An end-of-day count by the test cashier (A38) | 1 count row and 1 log row. After it, that cashier can sell nothing more that day | An administrator or a manager reopens the count: the count row is deleted, and 1 more log row is written |
| Receiving an order (A38) | It first needs a purchase order: 1 order with its lines, 1 log row, 1 notice, and an email to the product's supplier (1 email log row). Each step after that (confirmed, shipped, received) is 1 log row and 1 notice. Receiving adds the stock and 1 stock history row per line | The app cannot delete a purchase order. It would stay, marked received; removing it needs a direct delete in the database |

Three things to decide before saying yes:

- **Email.** Suppliers of low-stock products are emailed at most once a day. For the alert case the TEST_ product would be given a TEST_ supplier whose address is your own, so that no real supplier is written to. That is 1 more supplier row and 1 log row. If the server's stock check runs while the TEST_ product is low (it runs when the server starts, every hour, and when the Notifications page is opened), it sends that one email to your address and writes 1 email log row and 1 notice.
- **Who signs in.** I do not type passwords. Either you sign in and I watch the result, or you create temporary accounts as on 10 October. Each is 1 user row, 2 log rows and 2 emails to an address of yours (a 6-digit code, then a welcome note); deactivating it afterwards is 1 more log row. Each needs an email address that no account, deactivated ones included, already uses.
- **What "removed" means.** Voiding and deleting in the app leave the Activity log rows and the notices, by design. Removing those too means deleting rows from the database directly. Two exceptions: the server itself deletes read notices once they are 30 days old, and the stock history rows of a voided and deleted sale stay.
