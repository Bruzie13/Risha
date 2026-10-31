"""System Test Plan (Supplier): the plan of 29 Oct 2026 (updsupplier.pdf)
with the changes of 30 Oct: no colour words (note 17) and the Log out
button's new name.
Draw it with:  python3 QA/test-plans/build_plan.py supplier <out.pdf>"""

from admin_plan import PROJECT

PLAN = {
    'title': 'SYSTEM TEST PLAN (SUPPLIER)',
    'project': PROJECT,
    'role': 'SUPPLIER',
    'modules': [
        ('AUTHENTICATION MODULE', [
            ('Sign in', [
                ('Open FETCH in the browser by going to https://risha-pets.onrender.com',
                 'The **Sign in** page opens with the **Username** and **Password** fields, the **Keep me signed in** box and the **Sign in** button'),
                ('Type a valid username and a valid password, then click the eye icon at the right of the **Password** field twice',
                 'The eye icon shows once something is typed. The password is shown as text, then hidden again in dot characters'),
                ('Tick the **Keep me signed in** box below the **Password** field',
                 'The box is ticked, and the note below it says the account stays signed in on this browser for 7 days'),
                ('Click the **Sign in** button',
                 'The **Supplier portal** opens. The sidebar is on the left side, and the account picture is at its lower-left'),
                ('Close the browser, then open https://risha-pets.onrender.com again',
                 'The **Supplier portal** opens right away without asking to sign in again'),
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
        ('SUPPLIER PORTAL MODULE', [
            ('Portal overview', [
                ('Sign in as Supplier using a valid username and a valid password',
                 'The **Supplier portal** opens with **Waiting for you**, **To ship**, **On the way** and **Your rating** at the top, and the tabs below them'),
                ('Look at the **Open orders** tab',
                 'Only the supplier\'s own orders are shown, each with its progress and next step'),
            ]),
            ('Order offer', [
                ('Click the **Offer an order** button at the upper-right of **Open orders**',
                 'The **Offer an order** window opens with the supplier\'s products. The ones running low at the shop are filled in'),
                ('Enter a quantity not greater than 10,000, choose a date not greater than a year in **Date you could deliver**, then click **Send offer**',
                 '"Offer sent. It becomes an order if the shop accepts it." is shown, and the offer is listed as waiting for the shop'),
            ]),
            ('Order confirmation', [
                ('Click the **Confirm order** button on an order waiting for confirmation',
                 'A window asks for the **Date you will deliver** and **How many of each you can send**'),
                ('Choose the delivery date (today or later, and not more than a year away), check the quantities (each not more than ordered, at least one above 0), then click **Confirm order**',
                 '"Order confirmed." is shown and the order is marked confirmed'),
            ]),
            ('Shipping', [
                ('Click the **Mark as shipped** button on a confirmed order',
                 'A window asks for the delivery receipt or invoice number'),
                ('Enter the receipt number (example: DR-10452), then click **Mark as shipped**',
                 '"Order marked as shipped." is shown and the order is marked **Shipped**'),
            ]),
            ('Delivery date', [
                ('Click **Change delivery date** on an order, choose the new date (today or later, and not more than a year away), type the reason in **Why it changed**, then click **Save new date**',
                 '"Delivery date updated." is shown with the new date'),
            ]),
            ('Order notes', [
                ('Click **Notes** on an order, type a note, then click **Send**',
                 'The note is added under the order and the shop can read it'),
            ]),
            ('Payments', [
                ('Click the **Payments** tab',
                 'The delivered orders that the shop has not paid yet are listed with the amount and due date, together with the supplier\'s payment terms. A payment that is overdue or due within 3 days is said at the top, and the tab shows how many are overdue'),
                ('Under **Paid**, click **Receipt** on an order the shop has paid',
                 'The **Payment receipt** opens with its receipt number, the order, the amount, how it was paid and the reference, with a **Print** button'),
            ]),
            ('Price changes', [
                ('Click the **Products** tab',
                 'The products the supplier supplies are listed with the shop\'s stock, reorder level, status, expected sales for the next 30 days and the price'),
                ('Click **Change price** at the right of a product',
                 'The **Propose a new price** window opens with the current price'),
                ('Enter the new price in **New price (₱)** and the reason, then click **Send to the shop**',
                 '"Sent to the shop for approval. The current price stays until they agree." is shown'),
            ]),
            ('Supplier rating', [
                ('Click the **Rating** tab',
                 '**How you are doing** shows the supplier\'s star rating out of 5 and the conditions behind it'),
            ]),
            ('Past orders', [
                ('Click the **Past orders** tab',
                 'The orders already received or cancelled are listed with the items, status and total'),
            ]),
        ]),
        ('SETTINGS MODULE', [
            ('Profile', [
                ('Click the account picture at the lower-left of the sidebar',
                 'The **Settings** page opens on the **Profile** tab with the supplier\'s name and email'),
                ('Click **Upload photo**, then choose a picture from the computer',
                 '"Profile photo updated" is shown and the picture appears at the lower-left of the sidebar'),
                ('Under **Company details** on the same page, change the phone number (example: 0928 123 4567), then click **Save company details**',
                 '"Your details were updated." is shown'),
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
