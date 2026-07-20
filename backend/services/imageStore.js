// Product-image storage. When CLOUDINARY_URL is set, images are uploaded to
// Cloudinary and we store the returned CDN URL. Until then it falls back to
// returning the base64 data URL unchanged, so the app keeps working exactly
// as before (no hard dependency on the credential being present).
const cloudinary = require('cloudinary').v2;

const isConfigured = !!process.env.CLOUDINARY_URL;
if (isConfigured) {
    // The SDK auto-reads CLOUDINARY_URL, but call config() so secure URLs win.
    cloudinary.config({ secure: true });
}

// Already-hosted URLs (http/https) are passed through untouched.
function isDataUrl(str) {
    return typeof str === 'string' && str.startsWith('data:');
}

// Accepts a base64 data URL (or an https URL). Returns a hosted URL when
// Cloudinary is configured, otherwise the input unchanged.
async function storeImage(input, folder = 'risha/products') {
    if (!input || !isDataUrl(input)) return input || null;
    if (!isConfigured) return input; // fallback: keep the data URL as-is
    const res = await cloudinary.uploader.upload(input, {
        folder,
        resource_type: 'image',
        transformation: [{ width: 800, height: 800, crop: 'limit' }, { quality: 'auto', fetch_format: 'auto' }]
    });
    return res.secure_url;
}

module.exports = { storeImage, isConfigured };
