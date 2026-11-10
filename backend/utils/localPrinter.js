/**
 * Receipts on the printer plugged into the computer the server runs on.
 *
 * The POS page prefers WebUSB (src/js/escpos-print.js), but on Windows the
 * system's own USB printing driver holds the device and Chrome is refused.
 * When the shop runs the server on the till computer itself, the server can
 * print instead: the page builds the same ESC/POS bytes and posts them here,
 * and they go to the Windows print queue untouched (datatype RAW), so the
 * queue needs no maker's driver — "Generic / Text Only" is enough.
 *
 * On a Mac or Linux computer the same bytes go to the printer's CUPS queue
 * with `lp -o raw`. The queue is the one named in RECEIPT_PRINTER, or the
 * first whose name looks like a receipt printer (POS, 58, XP-, YICHIP...).
 *
 * Where there is no such printer (the hosted deployment included) this
 * reports itself unavailable and the page falls back to the browser's print
 * window.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRINTER = process.env.RECEIPT_PRINTER || 'POS58';
const WIN = process.platform === 'win32';
const STATUS_TTL_MS = 30 * 1000;
const MAX_BYTES = 64 * 1024;       // a receipt is a few hundred bytes

// winspool's RAW path: the bytes reach the printer exactly as sent.
const SEND_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO doc);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
    public static void Send(string printer, byte[] data) {
        IntPtr handle;
        if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            DOCINFO doc = new DOCINFO();
            doc.pDocName = "FETCH receipt";
            doc.pDataType = "RAW";
            if (StartDocPrinter(handle, 1, doc) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                int written;
                if (!WritePrinter(handle, data, data.Length, out written)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (written != data.Length) throw new Exception("Only " + written + " of " + data.Length + " bytes were accepted");
            } finally { EndDocPrinter(handle); }
        } finally { ClosePrinter(handle); }
    }
}
'@
[RawPrint]::Send($env:FETCH_PRINTER, [IO.File]::ReadAllBytes($env:FETCH_PRINT_FILE))
`;

// Is the queue there, and is its printer plugged in and switched on?
const STATUS_SCRIPT = `
$p = Get-CimInstance Win32_Printer -Filter ("Name='" + $env:FETCH_PRINTER.Replace("'", "''") + "'")
if (-not $p) { 'missing' } elseif ($p.WorkOffline) { 'offline' } else { 'ready' }
`;

function powershell(script, env) {
    return new Promise((resolve, reject) => {
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
            env: { ...process.env, ...env },
            encoding: 'utf8',
            timeout: 20000,
            windowsHide: true,
        }, (err, stdout, stderr) => {
            if (err) return reject(new Error(String(stderr || err.message).split('\n')[0].trim() || 'PowerShell failed'));
            resolve(stdout.trim());
        });
    });
}

/* ----- Mac and Linux: the CUPS queue ----- */
const LOOKS_LIKE_RECEIPT_PRINTER = /pos|58|80mm|xp[-_ ]?\d|yichip|receipt|thermal|epson[-_ ]?tm/i;

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { encoding: 'utf8', timeout: 15000 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(String(stderr || err.message).split('\n')[0].trim() || cmd + ' failed'));
            resolve(stdout);
        });
    });
}

/** Pick the queue from `lpstat -p` output. Exported for the tests. */
function pickCupsPrinter(lpstatOutput, wanted) {
    const queues = String(lpstatOutput || '').split('\n')
        .map(l => /^printer (\S+) (.*)$/.exec(l.trim()))
        .filter(Boolean)
        .map(m => ({ name: m[1], off: /disabled/i.test(m[2]) }));
    const found = wanted ? queues.find(q => q.name === wanted) : queues.find(q => LOOKS_LIKE_RECEIPT_PRINTER.test(q.name));
    if (!found) return { available: false, printer: wanted || null, reason: 'no receipt printer is set up on this computer' };
    if (found.off) return { available: false, printer: found.name, reason: 'printer is paused or switched off' };
    return { available: true, printer: found.name, reason: null };
}

async function cupsStatus() {
    try {
        return pickCupsPrinter(await run('lpstat', ['-p']), process.env.RECEIPT_PRINTER || '');
    } catch (e) {
        return { available: false, printer: null, reason: 'no receipt printer is set up on this computer' };
    }
}

let lastStatus = null;             // { at, value }

/** { available, printer, reason } — cached briefly: the POS page asks on every load. */
async function status() {
    if (lastStatus && Date.now() - lastStatus.at < STATUS_TTL_MS) return lastStatus.value;
    let value;
    if (!WIN) {
        value = await cupsStatus();
        lastStatus = { at: Date.now(), value };
        return value;
    }
    try {
        const state = await powershell(STATUS_SCRIPT, { FETCH_PRINTER: PRINTER });
        value = state === 'ready'
            ? { available: true, printer: PRINTER, reason: null }
            : { available: false, printer: PRINTER, reason: state === 'offline' ? 'printer is unplugged or switched off' : 'no such printer in Windows' };
    } catch (e) {
        value = { available: false, printer: PRINTER, reason: e.message };
    }
    lastStatus = { at: Date.now(), value };
    return value;
}

/** Send ESC/POS bytes to the receipt printer. Rejects with a readable reason. */
async function print(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Nothing to print');
    if (bytes.length > MAX_BYTES) throw new Error('Receipt is too large');
    const file = path.join(os.tmpdir(), `fetch-receipt-${process.pid}-${Date.now()}.bin`);
    fs.writeFileSync(file, bytes);
    try {
        if (WIN) await powershell(SEND_SCRIPT, { FETCH_PRINTER: PRINTER, FETCH_PRINT_FILE: file });
        else {
            const queue = await status();
            if (!queue.available) throw new Error(queue.reason);
            await run('lp', ['-d', queue.printer, '-o', 'raw', file]);
        }
    } catch (e) {
        lastStatus = null;         // ask Windows again next time rather than trust the cache
        throw e;
    } finally {
        fs.unlink(file, () => {});
    }
}

module.exports = { status, print, pickCupsPrinter, PRINTER, MAX_BYTES };
