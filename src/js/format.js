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
