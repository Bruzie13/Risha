function formatNumber(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '0';
    return Number(val).toLocaleString('en-US');
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
