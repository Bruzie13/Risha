function formatNumber(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '0';
    return Number(val).toLocaleString('en-US');
}

// Stock/quantity display. Values come from a DECIMAL column as "8.000"; show
// the real amount without trailing zeros — "8" for pieces, "0.5" for kg/L.
function formatQty(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '0';
    return Number(val).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatDecimal(val, decimals) {
    if (decimals === undefined) decimals = 2;
    if (val === null || val === undefined || isNaN(Number(val))) return Number(0).toFixed(decimals);
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(val) {
    return '₱' + formatDecimal(val, 2);
}

// Compact form for tight spaces (stat cards): ₱8.06M / ₱231K
function formatCompactCurrency(val) {
    const n = Number(val) || 0;
    if (Math.abs(n) >= 1e6) return '₱' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e5) return '₱' + (n / 1e3).toFixed(0) + 'K';
    return formatCurrency(n);
}
