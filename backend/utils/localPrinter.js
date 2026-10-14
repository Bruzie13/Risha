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
 * Windows only. Anywhere else (the hosted deployment included) this reports
 * itself unavailable and the page falls back to the browser's print dialog.
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

let lastStatus = null;             // { at, value }

/** { available, printer, reason } — cached briefly: the POS page asks on every load. */
async function status() {
    if (!WIN) return { available: false, printer: null, reason: 'not Windows' };
    if (lastStatus && Date.now() - lastStatus.at < STATUS_TTL_MS) return lastStatus.value;
    let value;
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
    if (!WIN) throw new Error('Server-side receipt printing is only available on Windows');
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Nothing to print');
    if (bytes.length > MAX_BYTES) throw new Error('Receipt is too large');
    const file = path.join(os.tmpdir(), `fetch-receipt-${process.pid}-${Date.now()}.bin`);
    fs.writeFileSync(file, bytes);
    try {
        await powershell(SEND_SCRIPT, { FETCH_PRINTER: PRINTER, FETCH_PRINT_FILE: file });
    } catch (e) {
        lastStatus = null;         // ask Windows again next time rather than trust the cache
        throw e;
    } finally {
        fs.unlink(file, () => {});
    }
}

module.exports = { status, print, PRINTER, MAX_BYTES };
