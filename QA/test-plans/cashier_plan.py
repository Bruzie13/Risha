"""System Test Plan (Cashier): the plan of 29 Oct 2026 (updcashier.pdf) with
the changes of 30 Oct: no colour words (note 17), the Log out button's new
name, and small messages now showing at the top right.
Draw it with:  python3 QA/test-plans/build_plan.py cashier <out.pdf>"""

from admin_plan import PROJECT

PLAN = {
    'title': 'SYSTEM TEST PLAN (CASHIER)',
    'project': PROJECT,
    'role': 'CASHIER',
    'modules': [
        ('AUTHENTICATION MODULE', [
            ('Sign in', [
                ('Open FETCH in the browser by going to https://risha-pets.onrender.com',
                 'The **Sign in** page opens with the **Username** and **Password** fields, the **Keep me signed in** box and the **Sign in** button'),
                ('Type a valid username and a valid password, then click the eye icon at the right of the **Password** field twice',
                 'The eye icon shows once something is typed. The password is shown as text, then hidden again in dot characters'),
                ('Tick the **Keep me signed in** box below the **Password** field',
                 'The box is ticked, and the note below it says the account stays signed in on this browser for 7 days and to leave it off on a shared till'),
                ('Click the **Sign in** button',
                 'The **Point of sale** opens. The sidebar is on the left side, and the account picture is at its lower-left'),
                ('Close the browser, then open https://risha-pets.onrender.com again',
                 'The **Point of sale** opens right away without asking to sign in again'),
                ('On the **Sign in** page, if you forgot your password, click **Forgot your password?** below the **Sign in** button',
                 'The **Reset your password** window opens. The username is already filled in if it was typed on the **Sign in** page'),
                ('Type a valid username or a valid email, then click **Ask for a reset**',
                 'A message says that the request is sent to an administrator for approval'),
                ('After an administrator approves the request, open the reset link sent to the email',
                 'The **Choose a new password** page opens'),
                ('Type a valid new password in both fields (example: Risha@2026), then click **Save new password**',
                 '"Password has been reset" is shown, then the page goes back to **Sign in**'),
            ]),
        ]),
        ('POINT OF SALE MODULE', [
            ('Starting cash', [
                ('Sign in as Cashier using a valid username and a valid password at the start of the day',
                 'The **Starting cash** window opens and asks for the cash in the drawer'),
                ('Enter the cash in **Cash in the drawer now (₱)** (example: 500), then click **Save starting cash**',
                 '"Starting cash saved: ₱500.00" is shown at the top right of the screen'),
            ]),
            ('Product search', [
                ('Scan a product\'s barcode, or type it in the **Scan barcode** box at the upper-left, then press Enter',
                 'The product is added to the **Current sale** on the right side'),
                ('Type a product name in the **Search products** box at the right of **Scan barcode** (example: Aozi)',
                 'Only the matching products are shown in the product list'),
                ('Click a category in the list at the left (example: Food)',
                 'Only the products in that category are shown'),
            ]),
            ('Current sale', [
                ('Click a product in the list, or its **Add** button',
                 '"(product) added to cart" is shown and the product is listed in the **Current sale**'),
                ('In the **Current sale**, click the **+** button of the item, then the **−** button',
                 'The quantity goes up by one, then down by one, and the total changes with it'),
                ('Type the customer\'s name and a valid contact number in **Customer (optional)** and **Phone (optional)** (example: Maria Santos)',
                 'If the customer\'s name and contact number are entered, they are shown on the receipt'),
                ('Enter a discount in the **Discount** box that is higher than the limit set by the administrator, shown beside the box (example: 15% when it says up to 10%)',
                 '"The largest discount allowed is 10%" is shown and the discount is changed to 10%'),
                ('Enter a discount within the administrator\'s limit (example: 5%)',
                 'The discount amount is computed and the total goes down'),
            ]),
            ('Payment', [
                ('Under **Cash received**, click **Exact**',
                 'The cash received is filled in with the total, and the change is computed and shown'),
                ('Click the number buttons beside **Exact** one at a time: **+20**, **+50**, **+100**, **+500** and **+1000**',
                 'Each button adds its amount to the cash received, and the change goes up by the same amount'),
                ('Click the **Charge** button at the lower-right',
                 'The **Confirm cash sale** window shows the items ordered, subtotal, discount, total, payment, cash received, change and customer'),
                ('Click **Complete sale**',
                 '"Sale completed!" is shown, the stock goes down and the receipt prints'),
            ]),
            ('My sales today', [
                ('Click **My sales** in the sidebar at the left',
                 'The **My sales today** window lists the cashier\'s sales for today with the time, sale number, customer, total and status'),
                ('Click **Reprint** on a sale',
                 'The receipt of that sale prints again'),
                ('Click **Ask for void** on a sale',
                 'A window asks what went wrong with the sale'),
                ('Type what went wrong (example: Customer changed his mind), then click **Send request**',
                 '"Sent to a manager" is shown, the sale is marked "Void requested" and the administrator sees the request'),
            ]),
            ('Cash in and out', [
                ('Click **Cash in/out** in the sidebar',
                 'The **Cash in or out of the drawer** window opens with the **Taken out** and **Put in** choices'),
            ]),
            ('Taken out', [
                ('Choose **Taken out**. In **Amount (₱)**, enter an amount that is not greater than the cash in the drawer (example: 200), type who took it and why, then click **Record cash taken out**',
                 'A question asks to confirm the cash taken out'),
                ('Click **Record it**',
                 '"Recorded: ₱200.00 taken out." is shown and the amount, time and reason are listed under **Today**'),
                ('Choose **Taken out** again, enter an amount greater than the cash in the drawer (example: 100,000), type who took it and why, then click **Record cash taken out**',
                 'A question asks to confirm the cash taken out'),
                ('Click **Record it**',
                 '"That is more cash than the drawer should hold." is shown and nothing is recorded'),
            ]),
            ('Put in', [
                ('Choose **Put in**. In **Amount (₱)**, enter the amount (example: 100), type who put it in and why, then click **Record cash put in**',
                 'A question asks to confirm the cash put in'),
                ('Click **Record it**',
                 '"Recorded: ₱100.00 put in." is shown and the amount, time and reason are listed under **Today**'),
            ]),
            ('End of day', [
                ('Click **End of day** in the sidebar',
                 'The **End of day cash count** window opens with the starting cash, today\'s cash sales and the cash put in and taken out'),
                ('Enter the cash counted in **Cash counted in the drawer (₱)**, then click **Save count and close drawer**',
                 'A question asks to close the drawer for the day'),
                ('Click **Close the drawer**',
                 'The count is saved with the expected amount and "Balanced", "Over by" or "Short by", and no more sales can be made today'),
            ]),
        ]),
        ('SETTINGS MODULE', [
            ('Profile', [
                ('Click the account picture at the lower-left of the sidebar',
                 'The **Settings** page opens on the **Profile** tab with the cashier\'s name and email'),
                ('Click **Upload photo**, then choose a picture from the computer',
                 '"Profile photo updated" is shown and the picture appears at the lower-left of the sidebar'),
            ]),
            ('Password', [
                ('Click the **Password** tab, enter the valid current password and a valid new password twice, then click **Update password**',
                 '"Password changed" is shown'),
            ]),
        ]),
        ('LOGOUT MODULE', [
            ('Sign out', [
                ('Click the logout icon at the lower-left corner of the sidebar',
                 'A question asks "Are you sure you want to logout?"'),
                ('Click **Log out**',
                 'The user is signed out and the **Sign in** page opens'),
            ]),
        ]),
    ],
}
