/* Printing a sale's receipt, the same way from the till and from Sales.

   Three ways, tried in this order, so a receipt prints with no dialog
   whenever the computer can do it:

     1. straight to a USB receipt printer the browser was allowed to use
        (js/escpos-print.js, the Connect printer button)
     2. through the server, to the receipt printer set up on the computer the
        system runs on (backend/utils/localPrinter.js)
     3. the browser's own print window, on paper cut to the receipt's length
        (printReceiptPaper in js/auth.js)

   The third is the only one that asks: a browser may not print by itself
   unless it was started for that (Chrome's --kiosk-printing). */

/* The receipt printer on the computer the system runs on.
   null until asked; the name of the printer once it is known to be ready. */
let serverPrinter = null;
async function serverPrinterReady(refresh) {
    if (serverPrinter !== null && !refresh) return !!serverPrinter;
    try {
        const res = await fetch(`${API_BASE}/receipt-printer/status`, { headers: getAuthHeaders() });
        const data = await res.json();
        serverPrinter = data.success && data.data.available ? data.data.printer : '';
    } catch (e) { serverPrinter = ''; }
    return !!serverPrinter;
}

async function printOnServerPrinter(sale, tendered, change) {
    const res = await fetch(`${API_BASE}/receipt-printer/print`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/octet-stream' },
        body: escposPrint.buildReceipt(sale, tendered, change)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'The printer did not accept the receipt');
}

/* The receipt as a page, for the browser's print window. It is laid out like
   the one sent straight to the printer: each item on its own line with
   "quantity x price" and its amount under it, so nothing is squeezed into
   four columns on 58mm paper. Black only: grey prints faint on thermal paper. */
const SALE_RECEIPT_CSS = `
    body{font-family:'Courier New',monospace;font-size:10px;line-height:1.2;text-align:center;}
    h2{margin:0;font-size:13px;letter-spacing:.3px;}
    .rc-left{text-align:left;}
    .rc-row{display:flex;justify-content:space-between;gap:4px;text-align:left;}
    .rc-row span:last-child{white-space:nowrap;}
    .rc-item{text-align:left;margin-top:1px;}
    .rc-sub{padding-left:6px;}
    .rc-total{font-size:13px;font-weight:bold;border-top:1px solid #000;border-bottom:1px solid #000;padding:2px 0;margin:3px 0;}
    hr{border:none;border-top:1px dashed #000;margin:3px 0;}
    .rc-no{letter-spacing:1px;margin-top:2px;}
`;

function saleReceiptBody(sale, tendered, change) {
    const money = v => formatCurrency(Number(v) || 0);
    const number = String(sale.sale_number || sale.id || '').padStart(6, '0');
    // total_amount is before the discount, final_amount what the customer paid;
    // the discount percent is stored as `discount`
    const subtotal = parseFloat(sale.total_amount || 0);
    const total = parseFloat(sale.final_amount ?? sale.total_amount ?? 0);
    const disc = parseFloat(sale.discount_percent ?? sale.discount ?? 0) || 0;
    const discAmount = sale.final_amount != null ? subtotal - total : subtotal * disc / 100;
    const date = new Date(sale.created_at || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const items = (sale.items || []).map(item => {
        const qty = parseFloat(item.quantity);
        const price = parseFloat(item.unit_price);
        const unit = typeof getUnitLabel === 'function' ? getUnitLabel(item.unit_type) : '';
        return `<div class="rc-item">${escHtml(item.product_name)}</div>
            <div class="rc-row rc-sub"><span>${qty}${unit} x ${money(price)}</span><span>${money(parseFloat(item.subtotal || qty * price))}</span></div>`;
    }).join('');
    const customer = sale.customer_name || sale.customer_phone
        ? `<div>Customer: ${escHtml(sale.customer_name || '')}${sale.customer_phone ? ' (' + escHtml(sale.customer_phone) + ')' : ''}</div>` : '';
    const cash = typeof tendered === 'number' && tendered > 0
        ? `<div class="rc-row"><span>Cash:</span><span>${money(tendered)}</span></div><div class="rc-row"><span>Change:</span><span>${money(change || 0)}</span></div>` : '';
    return `
        <h2>RISHA PET SUPPLIES</h2>
        <div>7 Bagumbong Road, Brgy. 171, North Caloocan</div>
        <div>Tel: (02) 8123-4567</div>
        <hr>
        <div class="rc-left">
            <div>Receipt #: <strong>${escHtml(number)}</strong></div>
            <div>Date: ${escHtml(date)}</div>
            <div>Cashier: ${escHtml(sale.staff_name || 'N/A')}</div>
            ${customer}
        </div>
        <hr>
        ${items}
        <hr>
        ${disc > 0 ? `<div class="rc-row"><span>Subtotal:</span><span>${money(subtotal)}</span></div>
        <div class="rc-row"><span>Discount (${disc}%):</span><span>-${money(discAmount)}</span></div>` : ''}
        <div class="rc-row rc-total"><span>TOTAL:</span><span>${money(total)}</span></div>
        ${cash || `<div class="rc-row"><span>Paid by:</span><span>${escHtml(String(sale.payment_method || 'cash').toUpperCase())}</span></div>`}
        <hr>
        <div>Thank you for your purchase!</div>
        <div>Items are non-returnable.</div>
        <div>This serves as your official receipt.</div>`;
}

/* Print the receipt of one sale. `tendered` and `change` are given at the
   till, right after the sale; a reprint has neither. */
async function printSaleReceipt(saleId, tendered, change) {
    try {
        const res = await fetch(`${API_BASE}/sales/${saleId}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success) { showToast('Could not load receipt data', 'error'); return; }
        const sale = data.data;
        const direct = window.escposPrint;

        // 1. A USB printer this browser was allowed to use: pick it up again
        //    without asking if the page was reloaded since.
        if (direct && direct.available()) {
            let connected = direct.isConnected();
            if (!connected) { try { connected = await direct.tryReconnect(); } catch (e) { connected = false; } }
            if (connected) {
                try {
                    await direct.printReceipt(sale, tendered, change);
                    showToast('Receipt printed', 'success');
                    return;
                } catch (e) {
                    console.error('Direct print failed, using the print window:', e);
                    showToast('The receipt printer did not answer. Opening the print window instead.', 'info');
                }
            }
        }
        // 2. The receipt printer on the computer the system runs on.
        if (direct && await serverPrinterReady()) {
            try {
                await printOnServerPrinter(sale, tendered, change);
                showToast('Receipt printed', 'success');
                return;
            } catch (e) {
                console.error('Server print failed, using the print window:', e);
                showToast('The receipt printer did not answer. Opening the print window instead.', 'info');
                serverPrinter = null;   // ask again next time: it may have been unplugged
                if (typeof reflectPrinterState === 'function') reflectPrinterState();
            }
        }
        // 3. The browser's print window, on paper as long as the receipt.
        printReceiptPaper('Receipt ' + String(sale.sale_number || sale.id), SALE_RECEIPT_CSS, saleReceiptBody(sale, tendered, change));
    } catch (error) {
        console.error('Error printing receipt:', error);
        showToast(typeof couldNot === 'function' ? couldNot('print receipt', error) : 'Could not print the receipt', 'error');
    }
}
