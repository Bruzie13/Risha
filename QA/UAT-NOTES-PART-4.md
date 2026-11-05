# UAT notes, part 4 (3 Nov 2026)

From `UAT NOTES PART 4.pdf` ("Revisions sa system part 2"). Each note is numbered so it can be referred to; ✓ = done (3 Nov, not yet committed or deployed). **Needs a server restart** to add the new database pieces (see the end).

## Before the notes (3 Nov)
- ✓ **D0** Dashboard **Live** chip does something: clicking it opens a small panel with how long the page has been online (and since what time), when you signed in, when the server last answered, and how often the page updates. Goes red with "Offline for …" when the server stops answering.

## All accounts
- ✓ **S1** (Carlo, 3 Nov, after the PDF) "kunware may mga bagay na parang di na pwede ma enter … dapat agad ng warning sign kahit typing palang, hindi yung lalabas lang ang warning kapag nag click ng button": a box whose value cannot be accepted shows its warning while typing, not only after the button is pressed.
  - Done: Boxes are checked a moment after typing stops (shared `liveCheck` in auth.js): product form, supplier form, Users (full name, email, password), Settings (full name, new password, confirm), supplier portal (price, new product name/price) and every question window with a rule (void reason, decline reasons). An empty box is only flagged on leaving it or on Save. Reorder, bulk, stock and End of day boxes already checked while typing.

## Cashier account
- ✓ **C1** The till's pop-up notices (void news etc.) cover the Current sale: move them (to the middle).
  - Done: On the till, pop-up notices sit at the top middle (over the product list), not the top right.
- ✓ **C2** The spinning loader inside a notice does not fit its box.
  - Done: The countdown line is sized from its own box and refitted if the notice changes size, so it runs exactly along the edge.
- ✓ **C3** "Cash in the drawer now" becomes **"Expected cash in the drawer now"**.
  - Done: Cash in/out and End of day say "Expected cash in the drawer now".
- ✓ **C4** End of day: an amount counted that is more than expected turns red.
  - Done: End of day: a count above the expected cash turns the box red with "This is ₱X more than the expected cash in the drawer. Count again before you save." (does not stop the save). An over result shows in red too.
- ✓ **C5** The drawer amount is hidden (•••• with an eye icon to show it).
  - Done: The drawer amount shows •••• with an eye button; hidden again each time the window opens.
- ✓ **C6** (Carlo, 3 Nov) "5k lang ung nasa cash in pero take out nya 50k, dapat may lalabas na agad sa ilalim ng text box": Cash in/out → Amount says what is wrong under the box while typing: more than the expected cash in the drawer (Taken out only; the amount itself stays behind the eye), not a number, 0, more than 2 decimals, over ₱1,000,000. Switching Taken out / Put in re-checks it; the button checks the same before the confirm window. The server already refused it.
- ✓ **C7** (Carlo, 3 Nov) "pag same product ung inaadd … imbis na madaming notif nagbabago lang ung numbers": adding the same product again updates the one notice already showing ("PEDIGREE ADULT added to cart · 4 in this sale") and starts its 5 seconds over, instead of stacking new ones. Any notice with exactly the same words does the same, on every page.
- ✓ **C8** (Carlo, 3 Nov) "haba ng text na toh": Cash in/out's intro is now one line: "For cash taken out or put in that is not a sale, like paying a supplier or adding coins for change. The administrator is told." (was four lines).

## Supplier account
- ✓ **SP1** The logo covers the "Show menu" button.
  - Done: The "show menu" arrow stays on the logo's bottom-right corner, the same place as on the admin sidebar, and is now drawn in front of the logo so the logo cannot cover it. Logo size and spacing unchanged. (A "Menu" tab under the logo and an arrow beside it were tried first; Carlo asked for the original place with the arrow in front, 3 Nov.)
  - The real problem (found by hovering): the logo's "Show the menu" label opens below the logo and the truck button covered it. It stays below the logo and is now drawn in front of the buttons (the logo area sits above the menu buttons). Opening it to the right was tried first; Carlo wanted it where it was, only in front. The label no longer tilts with the logo on hover: it reads level, like "Orders and products". Same everywhere (Carlo: "ganyan din gawin mo sa admin at sa supplier"): admin open sidebar ("Hide the menu"), folded admin sidebar and the supplier/till strip all show the label below the logo, level, in front of the button under it.
- ✓ **SP2** Buttons take the theme colour (example blue) so they read as buttons.
  - Done: Outlined buttons are tinted with the theme colour; in Navy & Sky that is the sky blue (navy came out grey).
- ✓ **SP3** Offer an order: searchable.
  - Done: Offer an order has a search box; quantities typed stay while searching.
- ✓ **SP4** Offer an order: an **Offer New Product** button to add a new offer. *Carlo (3 Nov): a product the shop does not sell yet (name, price, photo); the admin sees it and can add it to Inventory. Needs a new table.*
  - Done: Offer a new product (button in Open orders and inside Offer an order): name, brand, what it is, pet, unit, price, about, picture. Products tab → New products you offered (status, details, Cancel). Shop: Suppliers → New products tab (N to decide): Details, Add to Inventory (opens Add product filled in; saving marks it added), Decline with reason.
- ✓ **SP5** Offer an order: a **Cancel Offer** button (example: stock ran out).
  - Done: Offers waiting for the shop have Cancel offer (optional reason); the shop is told; Past orders says "Cancelled by you" with the reason.
- ✓ **SP6** Payments: the word "Paid" is out of place (heading above the table).
  - Done: "Paid" is now a section heading "Paid by the shop" with a line under it.
- ✓ **SP7** Payments: a sign when a payment's due date is near.
  - Done: Each unpaid row has a badge: Due in N days (amber, within 7), Due today / N days overdue (red); the note above counts within 7 days.
- ✓ **SP8** Products: a **Cancel Proposal** button for a price change waiting for the shop.
  - Done: A price change waiting for the shop has Cancel proposal (instead of Change price).
- ✓ **SP9** Products: the declined reason is clickable and opens more details.
  - Done: The red "₱X declined: reason" is a link that opens what was proposed, the price then and now, your reason, when sent and declined, by whom, the shop's reason, and Propose another price.
- ✓ **SP10** Rating: fix the layout.
  - Done: Rating: stars, badge and summary on the left; the five checks with ✓/✗ and their values on the right; the four figures as tiles underneath.
- ✓ **SP11** Past orders: filter or search.
  - Done: Past orders: search (order number or product) and a filter (Received / Received and paid / not yet paid / Cancelled) with "N of M past orders".

## Admin account
- ✓ **A1** Tables: alternate row colours so they are not plain.
  - Done: Every other row of every table is tinted with the theme colour; headings a shade deeper.
- ✓ **A2** Dashboard: the "N items need attention" line links to the items.
  - Done: "N items need attention" is a link: a window with Restock needed and Expiring soon, what to do today, and buttons to each Inventory list.
- ✓ **A3** Dashboard: something critical says what to do about it ("Act today: …").
  - Done: Needs restocking and Expiring products start with an "Act today" line (what to do, with Reorder now / See which); each product expiring within 30 days says what to do (Sell today: discount it / Put it in front, discount or bundle); the Within 30 days list has the same advice.
- ✓ **A4** Inventory: improve the look; product pictures and names bigger than the price.
  - Done: Carlo picked option A of three mock-ups (QA/mockups/Inventory - Option A). Cards: picture on top (190px, category icon when there is none), tick box and status on the picture, name 17.5px bold over two lines, SKU · brand · pet, paw-print stock with "N in stock", price small at the side, category, expiry strip with the date, View / Reorder / delete.
- ✓ **A5** Suppliers → Orders: the orders as boxes (cards in a grid) like Inventory.
  - Done: Suppliers → Orders: offers and orders on the way are boxes in a grid (2–3 across on a laptop).
- ✓ **A6** Supplier status: Active, Inactive, On vacation, Deactivated. *Carlo (3 Nov): the admin sets any status; the supplier can turn On vacation on/off from the portal. Needs a new column.*
  - Done: Supplier status Active / Inactive / On vacation / Deactivated: in Edit supplier, the list's Status column, the Active suppliers count, a warning on order boxes, the supplier's portal (status chip; Go on vacation / I'm back). Deactivated: portal login refused and Reorder skips their products with a reason; Inactive / On vacation: order sent with a warning.
- ✓ **A7** Only payments have receipts. *Carlo (3 Nov): "yung may mga payment lang yung may receipt kase meron dyan part na may receipt button pero di naman siya parang babayaran" — an order that is not paid (offer, on the way, cancelled) has no Receipt button.*
  - Done: Receipt buttons removed from open orders (shop and portal); receipts stay on paid orders only (Paid tables, portal Past orders when paid).
- ✓ **A8** "Confirm order" becomes **"Confirm offer"**.
  - Done: "Confirm order" on an offer is "Confirm offer" (Suppliers → Orders, Dashboard).
- ✓ **A9** Confirm offer: the supplier is the one who confirms. *Carlo (3 Nov): show which supplier made the offer in the Confirm offer window; the admin still accepts it.*
  - Done: Confirm offer opens a window naming the supplier: contact, phone, email, status, offered on, could deliver on, their note, what they offered and the total.
- ✓ **A10** Include cancelled offers.
  - Done: Suppliers → Orders → Cancelled offers (last 30 days): supplier took it back (with reason) or you declined it.
- ✓ **A11** Price changes: a proposal opens to more details when clicked.
  - Done: Price changes: the product name and a Details button open the supplier and contact, who proposed it and when, price now and proposed (+%), selling price, margin now and after, stock, sold in 30 days, their reason, earlier changes, with Accept / Decline.
- ✓ **A12** Reports → What sold: every row is a link to its details.
  - Done: Reports → What sold: every product and category line opens its details (units, number of sales, sold for, average price, share, price and stock now; Open in Inventory).
- ✓ **A13** Forecast: highlight the important details (example: Sales used).
  - Done: Sales used: the days, the dates and "Not counted: N days" stand out, the left-out ranges as a list.
- ✓ **A14** Forecast: a breakdown of Expected revenue and Expected items.
  - Done: Under Expected to sell and Expected revenue: the top 4 categories with bar, value and share, then the rest, and how the figure adds up.
- ✓ **A15** About this forecast: keep only Sales used and Forecast accuracy; Forecast accuracy gets a breakdown.
  - Done: About this forecast keeps only Sales used and Forecast accuracy (the model table, feature weights and the terms list were removed). Forecast accuracy shows the test: days tested, what the forecast said, what sold, off by, the accuracy sum, and each method's score on the same days.

## While checking part 4 (3 Nov)
- ✓ **A16** "HINDI PANTAY TOH": Sales history's View, Void and bin buttons now sit in one centred row at the same height (the bin is square).
- ✓ **A18** "lagyan mo na eto ung products … walang label": every order box in Suppliers → Orders has a heading over its list, "PRODUCTS (N)" on the left and "QUANTITY" on the right.
- ✓ **SP12** "nakakalito … masyadong random ung placement" (supplier Open orders): the column headings across a wide screen (Order / Progress / Total / Next step) are gone. Each open order is a box like the shop's Orders: order number and status, total, progress line, dates, "Products (N) / Quantity" list, buttons along the bottom. Offer an order and Offer a new product sit on their own row under the heading with one line saying what they are for.
- ✓ **A17** "padaliin intindihin pano nag wowork yung forecast … sa mga di masyado marunong na user": Reports → Stock planning starts with "How the forecast works": three numbered steps in plain words (what you sold → the next 30 days → compared with your shelf, and which list a product lands in), an example worked out from one of the shop's own products, and "How far to trust it" with the last test's guess vs what sold. Open until closed once (remembered on that browser).
  - Simpler (Carlo, 3 Nov: "mas simplehan at padaliin … hindi masyado techy"): titled "How does the forecast work?"; three one-line steps with icons (It remembers what you sell / It guesses the next 30 days: sold about 10 a week, expects about 40 next month / It checks your shelf: order more, sell it first, or stop ordering); the example as four boxes with arrows (Sold last month → Expects next month → On your shelf → So: Order more / Sell it first / Too much, stop ordering / Enough, nothing to do); one closing line "It is a guess, not a promise. The more you sell, the better it gets." The accuracy figures are no longer in the guide (they stay in About this forecast).

## Database (done 3 Nov, server restarted with Carlo's yes)
The new code expects these, added by `ensureSupplierOffers()` in backend/server.js when the server starts:
- `suppliers.status` ENUM('active','inactive','vacation','deactivated') DEFAULT 'active'
- `price_proposals.status` gains 'cancelled'
- `purchase_orders.cancelled_at`, `cancel_note`, `cancelled_by_supplier`
- new table `product_offers`
Until then the Supplier portal, Suppliers → Orders and Suppliers list read a column that is not there yet. Tested on a private database (127.0.0.1:3307, structure copied, TEST_ rows): 37 checks passed, migration safe to run twice; backend unit tests 216 passed.

## Taken over in another session (3 Nov)
- ✓ **A7b** The supplier's Performance window still had a Receipt on every order: now only on paid orders, and it opens the payment receipt.
- ✓ **AI1** Ask FETCH (written by the earlier session) tested: sales questions answered from the real figures (last 7 days ₱2,140.00, 2 sales, matches the database); "add a product" gives a card with Confirm / Cancel and saves nothing until Confirm. Fixed: the card made up a brand and pet that were not said, and it could say "check the card" when no card was made.
- ✓ **Plans** The three test plans have all of part 4 (30 changes + the Ask FETCH steps); PDFs rebuilt.

## Forecast upgrade (3 Nov, from the three mock-ups Carlo approved: "Build all three")
- ✓ **F1** Order this week (To reorder tab): one line per product with why, how many and the cost, the order-by date and Reorder; red today/tomorrow, amber this week, later weeks under "Later"; Order all orders this week's list. The order-by date and amount use each supplier's own average delivery time (Roger Enteria 4 days; 7 when there is no record) and include the safety buffer.
- ✓ **F2** Every product in plain words: Lasts / Next month (a range) / How sure (Sure, Rough guess, Too new to tell) / Do this. The product detail starts with what really sold and what FETCH expects, and the chart is weekly bars (8 weeks sold, 4 expected).
- ✓ **F3** Did it guess right?: the last test (expected 164, sold 85: too high), the best sellers one by one, and why ("it expected about 106 sales from 82 slow products that sold nothing … and too few of your best sellers").
- Finding: today no product is "Sure" (sales are irregular, so the model's own confidence is low for all), and the best sellers are under-forecast while slow sellers are over-forecast. A next step would be a simpler forecast for slow sellers.

## After the forecast upgrade (3 Nov, evening)
- ✓ **SP13** "bakit vacation nalang nakalagay sa supplier dapat may ibang option din": the supplier portal's header has a status menu, **Your status: Active: taking orders / On vacation: away for a while / Inactive: not taking orders**, with a confirm question; the shop gets a notice for each change. Deactivated stays the shop's own (it turns the login off). Server: `PUT /api/supplier-portal/me/status` (replaces `/me/vacation`; refuses anything but the three). Tested on the private database: all three save, the shop is told, "deactivated" refused.
- ✓ **SP14** "ung offer to the shop lagyan mo sariling page" → then "no just here put it here" (the tab row): **Offer to the shop** is the last tab of the supplier portal (Open orders, Payments, Products, Rating, Past orders, Offer to the shop): "What would you like to offer?" (Offer an order, Offer a new product), **Offers waiting for the shop** (each with Cancel offer), and **New products you offered** (moved from the Products tab). supplier.html#offer opens it. A separate sidebar page was tried first; Carlo wanted it as a tab. Also fixed: on a supplier's other pages the sidebar check for its link now also matches addresses with a #.
- Ask FETCH tools re-tested on the private database and with a real Gemini call (TEST_ data only): sales report, product look-up, add-product card (nothing saved until Confirm; Confirm adds it), reorder card, a viewer refused.

## Test plan notes (Carlo's handwritten page, 3 Nov evening) — left column done
- ✓ **Supplier UAT, New product offer:** step split in two (open the window; then fill in), each detail on its own line with an example: Product name, Brand (optional), Product type (optional), Pet type (optional), Sold by (optional), Your price to the shop (₱), About it (optional), Picture (optional), then Send to the shop. The form's boxes "What it is" / "For which pet" were renamed **Product type** / **Pet type** to match (supplier form and both details windows).
- ✓ **Supplier UAT, Order confirmation 2:** expected result says the order is marked **Confirmed** (bold).
- ✓ **Cashier UAT, End of day 2:** the step is only "enter the cash counted (example: 1,500.50), then Save"; the red over-the-expected warning moved to the expected result.
- ✓ **Admin UAT, Product addition:** new step 3, "Click **More details (optional)** … then fill in" Brand, Species, Sold by, Max stock level, Image, one per line (Species moved there from step 2); expected results fixed (step 2: each box takes its value, SKU filled in, * on Expiration date; save: "Product added" with its SKU, in the list with its picture).
- ✓ **Admin UAT, User addition:** examples one per line: step 2 Full name / Username / Email then Send code; step 3 Password / Email code / Role then Create user.
- ✓ Also brought in tonight's changes: supplier **Your status** menu (On vacation / Inactive / Active), **Offer to the shop** tab (Offer an order, Cancel offer under Offers waiting for the shop, New products you offered in the same tab).
- PDFs rebuilt (QA/test-plans/upd*.pdf) and copied to ~/Downloads/updadmin.pdf, updcashier.pdf, updsupplier.pdf at 8:34 PM.
- **Dropped (Carlo: "dont mind it"):** the right-hand "System" column of the page was cut off in the photo (Open orders "lagyan ulit nung "C…" button", Payments badge, Price changes "declined", Ratings "How you…", End of day "starting … chachange?", Purchase orders, Inventory reorder, Suppliers).
- ✓ **SP15** (Carlo, 3 Nov) "bakit di pantay toh sa ibang box, dapat lahat pantay pantay": order boxes in one row now line up part by part (heading, progress, dates, products, buttons), in the supplier's Open orders and in Suppliers → Orders. Checked at 1300px: dates, products and buttons start at the same height in all three boxes.
- ✓ **SP16** (Carlo, 3 Nov) "this part pede kaya mas organize and align pa" (the buttons at the foot of an order box): the main action (Mark as shipped, Confirm order, Receive into stock, Confirm offer) is full width; the other buttons sit side by side in equal halves (Change delivery date | Notes, Cancel offer | Notes); a lone second button is full width; the waiting note goes under them. Same in Suppliers → Orders.

## After the Nov 5 deploy (local, not deployed yet)
- ✓ **SP17** (Carlo, 5 Nov) "pag tabihin mo nalang toh para di masyado matabi": Payments shows **Waiting to be paid** and **Paid by the shop** side by side (stacked again under 1000px wide); the card's line under "Payments" is now just the payment terms. The tables fit their half at 1300px (no cut-off Amount, no scrollbar).
- ✓ **SP18** (Carlo, 5 Nov) "dapat pantay pantay yung mga labels etc kahit may long text": the two halves share their rows, so the headings, their lines and the table headers sit level even when one side's text is longer (checked with a two-line description on one side: both tables start at the same line).
- ✓ **SP19** (Carlo, 5 Nov) "dis status should what is the status not just saying your status": the chip beside the status menu now says the status itself: **● Active** (green dot), **● On vacation** (amber), **● Inactive** (grey dot); the menu beside it changes it.
- ✓ **A19** (Carlo, 5 Nov) "lagyan mo din sorting ng suppliers sa admin part": Suppliers → the supplier list has a **Sort** menu beside the search box: Name A → Z (default) / Z → A, Rating: Highest first / Lowest first (not rated yet goes last), Status: Active first (then On vacation, Inactive, Deactivated), Most products supplied, Most open orders, Newest added. It works with the search, is remembered on the browser, and hides on the Orders / Price changes / New products tabs. Checked every order on a preview copy.
