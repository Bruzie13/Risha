# Administrator system test — run of 30 Oct 2026

Plan: `updadmin.pdf` (System Test Plan, Administrator). Site: localhost:8000 (the shop's database, with the changes of 29–30 Oct not yet online). Tested by Carlo, checked against the screen by Claude.

Status: Passed / Failed / In Progress / Open. "Plan out of date" in the comment means the system was changed on purpose and the step's wording needs updating, not that the system is wrong.

## Changes to make in the plan (all in one pass at the end)

Carlo's notes while testing. **All applied on 30 Oct** (he checked the list first): the plans are now drawn from `QA/test-plans/` (admin_plan.py, cashier_plan.py, supplier_plan.py + build_plan.py); the originals of 29 Oct are in `QA/test-plans/originals/`. The PDF (updadmin.pdf) was made with ReportLab, not Word: there is no .docx behind it, so the edit is a rebuild of the affected pages (Calibri matches its Carlito font; page size 1008 x 612).

1. **Authentication, Sign in, T.S 5, Expected result** — replace with:
   "Request sent. If the account exists, the reset email will follow." is shown, with the note "Not in your inbox? Check your Spam or Junk folder (in Gmail, also Promotions), and mark it 'Not spam' so the next one arrives normally." below it, and the reset link is emailed to the administrator right away
2. **Column header, every page** — "T.S ID" becomes "ID".
3. **Dashboard, Quick search, ID 1, Description** — replace with:
   Press **Ctrl + J** on Windows or Linux, or **⌘ Command + J** on Mac (or click **Jump to…** at the upper-right), type Pedigree, then click **PEDIGREE ADULT**
4. **Dashboard, Purchase order status, ID 1 and 2** — use the button's own words (the button reads "Confirm order", and its window says "Confirm order", not "Yes, Update"):
   - ID 1 Description: Under **Purchase orders** at the lower-right, click the **Confirm order** button of an order offered by a supplier
   - ID 1 Expected: The **Confirm this order** window asks to accept the supplier's offer, with the order number and total
   - ID 2 Description: Click **Confirm order**
   - ID 2 Expected: (unchanged) The order is marked "confirmed" and the button changes to **Shipped**
5. **Every "Click Yes, …" step** — the confirm buttons were renamed on 30 Oct to say what they do (Carlo's request). The steps become:
   - Dashboard, Purchase order status, ID 4: Click **Mark shipped** (was "Yes, Update")
   - Inventory, Reordering, ID 2: Click **Create and email orders** (was "Yes, Create Orders")
   - Inventory, Stock adjustment, ID 3: Click **Add stock**; ID 5: Click **Remove stock** (were "Yes, Adjust")
   - Inventory, Product manipulation, ID 4: Click **Delete product** (was "Yes, Delete")
   - Sales history, Delete sale, ID 2: Click **Delete sale** (was "Yes, Delete")
   - Suppliers, Supplier deletion, ID 2: Click **Delete supplier** (was "Yes, Delete")
   - Suppliers, Orders on the way, ID 3: Click **Mark shipped** (was "Yes, update")
   - Users, User deactivation, ID 2: Click **Deactivate account** (was "Yes, deactivate")
   - Users, User restore: removed, see note 24
   - Notifications, ID 6: Click **Clear read**, then **Clear read** in the window (was "Yes, Clear Them")
   - Logout, ID 2: Click **Log out** (was "Yes, Logout")
6. **Inventory, Product addition and Product import** — the expiration date is now required for Food, Health & Wellness and Litter & Waste (30 Oct):
   - Product addition, ID 2 Expected, add: The **Expiration date** label shows "*" for these categories; left empty, "Food products need an expiration date. Enter the date printed on the pack." shows under the box
   - Product import, ID 1 Expected: the needed columns now end with **expiration_date**
   - Product import, ID 2: the template has an **expiration_date** column (sample row: one year from today)
   - A sad case worth adding: import a Food row with no expiration_date → it is left out and listed with "Food products need an expiration date…"
7. **Inventory, Reordering** — the amount to order can now be changed (30 Oct). Both the **Reorder** button and **Bulk reorder** (bar at the bottom) open the same window: each product with its stock, reorder level and a **To order** box holding the suggested amount; the button says what will be ordered ("Order 2 products · 90 items · ₱10,500.00").
   - ID 1 Description: Click the **Reorder** button, tick the products to order, change the amount in **To order** if needed (example: 20), then click **Order … products**
   - ID 1 Expected: A question asks to order that many items and email each order to its supplier
   - ID 2 Description: Click **Create and email orders**
   - ID 2 Expected: (unchanged) "Purchase orders sent" is shown and each supplier receives its order by email, with the amounts chosen
   - Sad case worth adding: type "abc" or 0 in To order → "…is not a whole number…" / "Order at least 1." shows under that product and nothing is sent
8. **Inventory, Barcode assignment** — barcodes take letters and numbers only (30 Oct; no length or check-digit rule). Sad case worth adding after ID 2: type a barcode with symbols or a space (example: 480-1234) and press Enter → "A barcode can have letters and numbers only (for example 4801234567890 or ABC123). Spaces and symbols like - = / are not allowed." is shown and nothing is saved. Same in Add/Edit product and CSV import.
10. **Inventory, Stock status filter, ID 1 Expected** — the yellow "Restock needed" bar was removed (30 Oct). Expected becomes: Only the products at or below their reorder level are shown (low stock and out of stock together), and the **Restock needed** button is highlighted with how many there are
11. **Inventory, Stock adjustment, ID 1 Description** — replace with:
   Click a product card (anywhere except its buttons), or tick the box at its upper-left
   (Expected unchanged: the bar at the bottom shows "1 selected" with the Bulk reorder, Adjust stock, Delete and Clear buttons)
12. **Inventory, cost price is required** (30 Oct): the label reads "Cost price (₱) *". Sad case worth adding to Product addition and Product manipulation (Edit): leave Cost price empty or 0 → "Enter the cost price (what the shop pays the supplier). It has to be more than ₱0." shows under the box and the product is not saved. CSV rows without a cost price are left out and listed.
13. **Sales history, Sales list, ID 2 Description** — the example becomes Joy (a customer in the shop's sales): Type a customer name or sale number in the **Search sales...** box at the upper-left (example: Joy)
14. **Sales history, Date filter** — From and To are now one **Dates** field (30 Oct). Replace ID 1 with:
   - ID 1 Description: Click the **Dates** field beside the search box (it reads "All dates"), then click **This month**
   - ID 1 Expected: Only the sales made this month are listed, and the field reads the range (example: "Oct 1 – Oct 30, 2026")
   - ID 2 Description: Click the **Dates** field again, choose the **From** and **To** dates, then click **Apply**
   - ID 2 Expected: Only the sales made within those dates are listed
   - Sad case worth adding: a From date after the To date → "The start date is after the end date" shows in the panel and the list does not change
   - **Applies to every plan** (Carlo: "lahat sa uat"): checked all three. Only the Administrator plan has date-range filters: Sales history → Date filter (above) and Reports → Sales report ID 3 (Custom range). The Cashier plan has none; the Supplier plan only picks single dates (delivery date, offer date), which stay as they are.
15. **Reports, Sales report** — the period buttons and Custom are now one **Period** field, like Sales history (30 Oct):
   - ID 2 Description: Click the **Period** field (it reads "Last 30 days"), then click **Last 7 days**, **Last 30 days**, **This month** and **All time** one at a time (open the field again each time)
   - ID 2 Expected: (unchanged) The figures and charts change to show each period, and the field reads the period chosen
   - ID 3 Description: Click the **Period** field, choose a **From** date not later than the **To** date, then click **Apply**
   - ID 3 Expected: The report shows only the sales within those dates, and the field reads them (example: "Oct 1 – Oct 9, 2026")
   - Sad case worth adding: From later than To → "The start date is after the end date." shows in the panel and the report does not change
16. **Sales history, Delete sale — fuller Expected results** (wording as on screen):
   - ID 1 Expected: The **Delete sale** window says the sale is removed from the records for good and will no longer count in any report, that the Activity log keeps a copy of it, and that **Void** is the way to cancel a sale and keep it on record. It has **Cancel** and **Delete sale** buttons. (Only the administrator has the trash icon; any other role is told "Only an administrator can delete a sale. To cancel one, void it.")
   - ID 2 Description: Click **Delete sale** (was "Yes, Delete", see note 5)
   - ID 2 Expected: The **Sale deleted** window says "Sale deleted and its items returned to stock." (or, for a sale that was already voided, "Sale deleted. Its items had already gone back to stock when it was voided."). The sale is gone from the list, the totals at the top go down, the products' stock goes up by the items sold, and the Activity log lists the deletion
17. **No colours in any step, all three plans** — a user can switch the colour theme (Settings → Appearance), so a button is named by its words and place, never its colour. Drop the colour word:
   - Administrator: Product addition ID 1 "Click the **Add** button" (was "red Add"); Reordering ID 1 "**Reorder** button" (was "yellow"); Supplier addition ID 1 "**Add supplier** button at the upper-right" (was "red"); Stock planning ID 2 "**Create purchase orders** button" (was "red"); User addition ID 1 "**Add user** button at the upper-right" (was "red"); Notifications ID 1 Expected "with a dot beside the unread ones" (was "a red dot")
   - Cashier: the step "Click the yellow **Charge** button at the lower-right" becomes "Click the **Charge** button at the lower-right"
   - Supplier: "Click the **Confirm order** button on an order waiting…" and "Click the **Mark as shipped** button on a confirmed…" (both were "red")
   - The notes above already leave colours out.
18. **Suppliers, Supplier addition, ID 2 Description** — with an example, like Product addition:
   Fill in the supplier details, then click **Save supplier**:
   Supplier name: Pawfect Pet Trading
   Contact person: Ana Dela Cruz (letters only, no numbers)
   Email: pawfect.trading@example.com (a valid email)
   Phone: 09171234567 (7 to 15 digits)
   Address: 123 Rizal Street (optional)
   City: Quezon City (optional)
   Payment terms: Net 30
   - Supplier update, ID 1 example for the new number: 09281234567
19. **Suppliers, Price changes — its own section now** (Carlo: rewrite the test case). Price changes are a tab of their own beside Orders, not part of the Orders list.
   - Purchase orders, ID 1 Expected becomes: The supplier offers, orders on the way and deliveries not yet paid are shown (price changes are no longer here)
   - Price changes, ID 1 Description: Click the **Price changes** tab at the right of **Orders** (it shows how many are waiting, example "3 to decide")
   - ID 1 Expected: The **Price changes to decide** list opens with each product, its supplier, the price now, the proposed price and how much it changes, with **Accept** and **Decline** buttons. The line under the title says what each does: Accept changes the product's cost in inventory, Decline keeps the price and asks why (the supplier sees the reason)
   - ID 2 Description: Click **Accept** on a new price
   - ID 2 Expected: The **Accept this price** window says the product's cost in inventory changes to the proposed price
   - ID 3 Description: Click **Accept price**
   - ID 3 Expected: "Price updated in inventory." is shown, the price leaves the list, the count on the tab goes down, and the product's cost price is the new one
   - ID 4 Description: Click **Decline** on another price, type the reason (example: Too high compared with other suppliers), then click **Decline**
   - ID 4 Expected: "Proposal declined. The price is unchanged." is shown; the supplier sees "declined" and the reason on their portal
   - Sad case worth adding: click **Decline** and leave the reason empty → "Type why you are declining this price. The supplier will see it." and nothing is declined
   - Ctrl/⌘ + J also has "Supplier price changes", which opens this tab
20. **Suppliers, phone numbers** — the Phone box now has a country picker like Google's forms (30 Oct): a flag with +63 for the Philippines first, and the number checked against that country's real numbers.
   - Supplier addition, ID 2: Phone example stays 0917 123 4567 (the box shows "🇵🇭 +63")
   - Sad case worth adding: Phone 0000000000 → "Enter a real phone number for Philippines, like 0905 123 4567. Pick another country with the flag if the number is from abroad." and the supplier is not saved
   - Same box on the Supplier Portal → My details (Supplier plan)
21. **Suppliers module, order of the test cases** — Orders on the way comes before Price changes. Follow the screen, tab by tab:
   1. Supplier list → Supplier addition → Supplier performance → Email history → Supplier update → Supplier deletion (the Suppliers tab, unchanged)
   2. Purchase orders → Supplier offers → **Orders on the way** → **Unpaid deliveries** (all on the Orders tab)
   3. **Price changes** (its own tab, after Orders; see note 19)
   Was: … Supplier offers → Price changes → Orders on the way → Unpaid deliveries.
22. **Reports, Sales report — new layout (Option A, 30 Oct)**: sections Summary, Over time, What sold, Breakdown; Revenue is the headline; each figure compares with the same number of days just before; the chart shows every day.
   - ID 1 Expected: The Reports page opens on the **Sales** tab. Under **Summary**, Revenue is shown large with how it compares with the days before (example: "↓ 67% vs Sep 1 – Sep 30 (₱240,953.80)") and how many days had no sales; Sales made, Average per sale and Items sold each show their own comparison. Below are **Over time** (revenue per day, every day of the period, with days without sales marked "No sales recorded"), **What sold** (best-selling products, sales by category) and **Breakdown** (the table)
   - ID 2 Expected (with note 15): The figures, comparisons and chart change to show each period; **All time** shows no comparison
   - ID 4 Expected: The chart and the table group the sales by week, then by month ("revenue per week/month"); the comparisons stay
23. **Reports, Stock planning — rewrite the test case** (sub-tabs since 30 Oct: To reorder, Expiry, Too much stock, Forecast; replaces the earlier "out of date" line about it):
   - ID 1 Description: Click the **Stock planning** tab
   - ID 1 Expected: Four tabs are shown, each saying what it holds (example: To reorder "1 product, 1 out of stock", Expiry "14 expired, 11 at risk", Too much stock "124 products, ₱2.38M tied up", Forecast "244 items in the next 30 days"); **To reorder** is open with its list
   - ID 2 Description: On the **To reorder** tab, click **Create purchase orders**
   - ID 2 Expected: (unchanged) A question asks to create the orders and email them to the suppliers
   - ID 3 Description: Click **Create and email**
   - ID 3 Expected: (unchanged) "Purchase orders created" is shown and each supplier receives its order
   - ID 4 Description: Click the **Expiry** tab, then the **Too much stock** tab
   - ID 4 Expected: Expiry lists stock already expired and stock likely to expire before it sells; Too much stock lists products with more than three months of stock, with the money tied up
   - ID 5 Description: Click the **Forecast** tab, then click a product name under **All products**
   - ID 5 Expected: The product's past sales and its 30-day forecast are shown under the list
   - ID 6 Description: At the bottom of the Forecast tab, click **About this forecast**
   - ID 6 Expected: It opens to show the sales used, the forecast accuracy, how the model was tested, and short explanations of how the numbers are worked out
24. **Users, User restore — delete the whole test case** (both steps). The "Show deactivated" checkbox it used is gone; a deactivated account is restored from Settings → Trash → Accounts instead.
25. **Settings, Profile, ID 1 Description** — replace with:
   Click the account name at the lower-left of the sidebar, or the gear icon beside it
   (Expected unchanged: The Settings page opens on the Profile tab)
26. **Settings, Preferences, ID 2 Description** — the section is now called **Database backup** (was "Data backup"): Click **Download backup** under **Database backup**
27. **Settings module — new test case "Trash"** (add after Email). It brings back what the earlier steps removed: the product from Product manipulation, the supplier from Supplier deletion and the account from User deactivation.
   - ID 1 Description: Click the **Trash** tab in Settings (it shows how many are waiting, example "17 deleted")
   - ID 1 Expected: The Trash opens with three tabs, **Products**, **Suppliers** and **Accounts**, each with its count ("7 deleted"); each item says when it was deleted and by whom, with a **Restore** button
   - ID 2 Description: On **Products**, click **Restore** on the product deleted earlier
   - ID 2 Expected: "<product name> is back in Inventory." is shown, the product leaves the Trash and appears in Inventory again
   - ID 3 Description: Click **Suppliers**, then **Restore** on the supplier deleted earlier
   - ID 3 Expected: "<supplier name> is back on the supplier list. Assign it to products again where needed." is shown and the supplier is on the Suppliers page again
   - ID 4 Description: Click **Accounts**, then **Restore** on the account deactivated earlier
   - ID 4 Expected: "<name> can sign in again." is shown and the account is active again on the Users page
   - ID 5 Description: Type a name in **Search the Trash** (example: Pedigree)
   - ID 5 Expected: Only the deleted items that match are listed; with no match, "Nothing in the Trash matches that search." is shown
   - Sad case worth adding: restore a product whose barcode another product now uses → "<name> could not be restored: its barcode … is now used by "<other>" … Give "<other>" another barcode first…" and the product stays in the Trash
   - Note: the Trash tab is only there for the administrator and the manager; Accounts only for the administrator
28. **FETCH Assistant, ID 1 Description** — the robot button is now a red **Ask FETCH** button with a paw (30 Oct): Click **Ask FETCH** at the lower-right of any page (on a phone, the paw button). Only the Administrator plan has an assistant step.
9. **Inventory, Product images** (optional extra step): clear a product's picture box and press Enter → "Picture removed" is shown and the mark beside it changes from ✓ to a crossed-out picture. While the box is changed but not saved, a pencil shows instead of the ✓.

Already known to be out of date (system changed on purpose):
- Users, User restore: removed, see note 24.
- Suppliers, Price changes: its own "Price changes" tab, no longer inside Orders.
- Reports, Stock planning: see note 23.
- Suppliers, Supplier performance: the Rating cell is the button.

## Authentication module — Sign in

| T.S ID | Step | Actual result | Status | Comment |
|---|---|---|---|---|
| 1 | Open FETCH, Sign in page | The Sign in page opens with Username, Password, Keep me signed in and Sign in | Passed | |
| 2 | Eye icon twice | | Open | Fixed during the test: the eye showed in an empty Password box, where it does nothing. It now appears only once something is typed (sign-in page and every other password box) |
| 3 | Keep me signed in, sign in, reopen | | Open | |
| 4 | Forgot your password? | | Open | |
| 5 | Ask for a reset | | Open | |
| 6 | Open the reset email and link | | Open | |
| 7 | Save new password | | Open | |
