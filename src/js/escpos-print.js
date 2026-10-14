/* Direct thermal-printer receipts over WebUSB (ESC/POS) — the Loyverse-style
 * path. The app is hosted remotely, so the server can't reach a local USB
 * printer; instead Chrome talks to the printer directly from the POS page.
 *
 * Usage: escposPrint.available() to feature-test, escposPrint.connect() once
 * (from a click) to grant/select the printer, then escposPrint.printReceipt(...).
 * Falls back to the browser print dialog when WebUSB is unavailable or the
 * printer isn't connected — callers should catch a thrown error and fall back.
 *
 * Known 58mm receipt printers. The XP-58H reports YICHIP 0x0fe6; a few common
 * ESC/POS clones are added so the picker pre-filters to likely devices. */
(function () {
    const KNOWN_VENDORS = [0x0fe6, 0x0416, 0x28e9, 0x0483, 0x1a86, 0x04b8, 0x0dd4];
    const FILTERS = KNOWN_VENDORS.map(v => ({ vendorId: v }));

    let device = null;      // the open USBDevice
    let epOut = null;       // bulk OUT endpoint number
    let ifaceNum = null;

    const enc = new TextEncoder();
    const ESC = 0x1b, GS = 0x1d;

    function available() {
        return typeof navigator !== 'undefined' && !!navigator.usb && window.isSecureContext;
    }

    function isConnected() {
        return !!(device && device.opened && epOut !== null);
    }

    // Locate a printer-class bulk OUT endpoint and claim its interface.
    async function bindEndpoint(dev) {
        await dev.open();
        if (dev.configuration === null) await dev.selectConfiguration(1);
        for (const cfg of dev.configurations) {
            for (const intf of cfg.interfaces) {
                for (const alt of intf.alternates) {
                    // USB printer class is 7; many clones expose vendor-specific (0xff)
                    if (alt.interfaceClass === 7 || alt.interfaceClass === 0xff) {
                        const out = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
                        if (out) {
                            if (dev.configuration.configurationValue !== cfg.configurationValue) {
                                await dev.selectConfiguration(cfg.configurationValue);
                            }
                            await dev.claimInterface(intf.interfaceNumber);
                            if (alt.alternateSetting !== 0) {
                                await dev.selectAlternateInterface(intf.interfaceNumber, alt.alternateSetting);
                            }
                            ifaceNum = intf.interfaceNumber;
                            epOut = out.endpointNumber;
                            device = dev;
                            return true;
                        }
                    }
                }
            }
        }
        throw new Error('No printer endpoint found on the selected device');
    }

    // Reconnect to a previously granted printer without prompting (getDevices
    // returns devices the user already authorised in past sessions).
    async function tryReconnect() {
        if (!available() || isConnected()) return isConnected();
        try {
            const devs = await navigator.usb.getDevices();
            const known = devs.find(d => KNOWN_VENDORS.includes(d.vendorId));
            if (known) { await bindEndpoint(known); return true; }
        } catch (e) { /* fall through — needs an explicit connect() */ }
        return false;
    }

    // Must be called from a user gesture (click): shows Chrome's device picker.
    async function connect() {
        if (!available()) throw new Error('WebUSB is not supported in this browser');
        if (isConnected()) return true;
        if (await tryReconnect()) return true;
        const dev = await navigator.usb.requestDevice({ filters: FILTERS });
        await bindEndpoint(dev);
        return true;
    }

    async function disconnect() {
        try {
            if (device && ifaceNum !== null) await device.releaseInterface(ifaceNum);
            if (device && device.opened) await device.close();
        } catch (e) { /* ignore */ }
        device = null; epOut = null; ifaceNum = null;
    }

    async function write(bytes) {
        if (!isConnected()) throw new Error('Printer not connected');
        // Chunk to keep transfers small for slow USB stacks
        const CHUNK = 4096;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            const res = await device.transferOut(epOut, bytes.slice(i, i + CHUNK));
            if (res.status !== 'ok') throw new Error('USB transfer ' + res.status);
        }
    }

    /* ---- ESC/POS receipt builder ---------------------------------------- */

    const COLS = 32;        // characters per line: 58mm paper, font A, normal width

    // Peso sign isn't in the printer's default codepage; render as "P". Browsers
    // put a non-breaking space before AM/PM in dates; keep it as a plain space.
    function ascii(s) {
        return String(s == null ? '' : s).replace(/₱/g, 'P').replace(/[  ]/g, ' ').replace(/[^\x00-\x7f]/g, '');
    }

    // Break text into lines the paper can hold, at spaces where it can. The
    // printer wraps by itself otherwise, mid-word and ignoring the alignment.
    function wrap(s, width) {
        const out = [];
        let cur = '';
        ascii(s).split(/\s+/).filter(Boolean).forEach(word => {
            while (word.length > width) {            // one word wider than the paper
                if (cur) { out.push(cur); cur = ''; }
                out.push(word.slice(0, width));
                word = word.slice(width);
            }
            if (!cur) cur = word;
            else if (cur.length + 1 + word.length <= width) cur += ' ' + word;
            else { out.push(cur); cur = word; }
        });
        if (cur) out.push(cur);
        return out.length ? out : [''];
    }

    class Receipt {
        constructor() { this.parts = []; this.push([ESC, 0x40]); } // init
        push(arr) { this.parts.push(Uint8Array.from(arr)); return this; }
        text(s) { this.parts.push(enc.encode(ascii(s))); return this; }
        line(s) { return this.text((s == null ? '' : s) + '\n'); }
        // Text that may be longer than the paper is wide: one line per wrapped line
        para(s) { wrap(s, COLS).forEach(l => this.line(l)); return this; }
        align(a) { return this.push([ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]); }
        bold(on) { return this.push([ESC, 0x45, on ? 1 : 0]); }
        // GS ! n — low nibble = height mult, high nibble = width mult (0..7).
        // Width above 0 divides the columns a line holds (COLS assumes 0).
        size(w, h) { return this.push([GS, 0x21, ((w & 7) << 4) | (h & 7)]); }
        feed(n) { return this.push([ESC, 0x64, n || 1]); }
        rule(ch) { return this.line((ch || '-').repeat(COLS)); }
        cut() { return this.push([GS, 0x56, 0x00]); }                 // full cut (ignored if no cutter)
        // Two-column row padded to the full width. When both do not fit on one
        // line the left text goes above and the right stays against the edge.
        row(left, right) {
            left = ascii(left); right = ascii(right);
            if (left.length + right.length + 1 > COLS) {
                this.para(left);
                return this.line(' '.repeat(Math.max(0, COLS - right.length)) + right);
            }
            return this.line(left + ' '.repeat(COLS - left.length - right.length) + right);
        }
        build() {
            let len = 0;
            for (const p of this.parts) len += p.length;
            const out = new Uint8Array(len);
            let o = 0;
            for (const p of this.parts) { out.set(p, o); o += p.length; }
            return out;
        }
    }

    // Build the ESC/POS byte stream for a sale (same content as the HTML receipt).
    function buildReceipt(sale, tendered, change) {
        const money = v => 'P' + Number(v || 0).toFixed(2);
        const r = new Receipt();
        // Double height only: at double width the name is wider than the paper.
        r.align('center').size(0, 1).bold(true).line('RISHA PET SUPPLIES').bold(false).size(0, 0);
        r.para('7 Bagumbong Road, Brgy. 171, North Caloocan');
        r.line('Tel: (02) 8123-4567');
        r.rule();
        r.align('left');
        r.line('Receipt #: ' + String(sale.sale_number || sale.id || '').padStart(6, '0'));
        r.para('Date: ' + new Date(sale.created_at || Date.now()).toLocaleString());
        r.para('Cashier: ' + (sale.staff_name || 'N/A'));
        r.para('Customer: ' + (sale.customer_name || 'Walk-in'));
        r.line('Payment: ' + String(sale.payment_method || 'cash').toUpperCase());
        r.rule();
        (sale.items || []).forEach(it => {
            const qty = parseFloat(it.quantity);
            const price = parseFloat(it.unit_price);
            const sub = parseFloat(it.subtotal || qty * price);
            r.para(it.product_name);
            r.row('  ' + qty + ' x ' + money(price), money(sub));
        });
        r.rule();
        const subtotal = parseFloat(sale.total_amount || 0);
        const discPct = parseFloat(sale.discount_percent || sale.discount || 0);
        if (discPct > 0) {
            r.row('Subtotal:', money(subtotal));
            r.row('Discount (' + discPct + '%):', '-' + money(subtotal * discPct / 100));
        }
        const total = parseFloat(sale.final_amount || sale.total_amount || 0);
        // Tall and bold, but normal width, so the amount stays on the TOTAL line.
        r.bold(true).size(0, 1).row('TOTAL:', money(total)).size(0, 0).bold(false);
        if (typeof tendered === 'number' && tendered > 0) {
            r.row('Cash:', money(tendered));
            r.row('Change:', money(change || 0));
        }
        r.rule();
        r.align('center');
        r.para('Thank you for your purchase!');
        r.para('Items are non-returnable');
        r.feed(1).line('*' + String(sale.sale_number || sale.id || '').padStart(6, '0') + '*');
        r.para('This serves as your official receipt');
        r.feed(4).cut();
        return r.build();
    }

    async function printReceipt(sale, tendered, change) {
        if (!isConnected()) {
            const back = await tryReconnect();
            if (!back) throw new Error('Printer not connected');
        }
        await write(buildReceipt(sale, tendered, change));
    }

    // Re-scan if the printer is unplugged/replugged mid-session
    if (available()) {
        navigator.usb.addEventListener('disconnect', e => {
            if (device && e.device === device) { device = null; epOut = null; ifaceNum = null; }
        });
    }

    window.escposPrint = {
        available, isConnected, connect, disconnect, tryReconnect, printReceipt, buildReceipt
    };
})();
