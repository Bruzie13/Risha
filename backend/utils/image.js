/* Pictures sent with a product or a profile.

   The page shrinks every picture before sending it, so what arrives is
   small. This is the server's own check for anything sent another way: an
   uploaded picture has to be a real image of MAX_IMAGE_MB or less. A link to
   a picture hosted elsewhere (http/https), or one of the shop's own pictures
   in images/ (the first products use these), is not a file and passes. */

const MAX_IMAGE_MB = 10;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
const OWN_PICTURE = /^\/?images\/[A-Za-z0-9_\-/]+\.(png|jpe?g|webp|gif)$/i;
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+=*)$/;
// a picture kept in the database is sent as a link to it, not inside the data
// (speed fix, 3 Nov): /api/products/<id>/image?v=<first 10 of its hash>
const PICTURE_LINK = /^\/api\/products\/(\d+)\/image(\?v=[0-9a-f]+)?$/;

/** The size in bytes of the file inside a base64 data URL. */
function dataUrlBytes(base64) {
    const pad = (base64.match(/=+$/) || [''])[0].length;
    return Math.floor(base64.length * 3 / 4) - pad;
}

/** What is wrong with this picture, or null. Nothing at all is fine. */
function imageProblem(value) {
    if (value == null || value === '') return null;
    const text = String(value);
    if (/^https?:\/\//i.test(text) || OWN_PICTURE.test(text) || PICTURE_LINK.test(text)) return null;
    const m = text.match(IMAGE_DATA_URL);
    if (!m) return 'The picture must be a PNG, JPG, WEBP or GIF image.';
    if (dataUrlBytes(m[2]) > MAX_IMAGE_BYTES) return `The picture is larger than ${MAX_IMAGE_MB} MB. Choose a smaller one.`;
    return null;
}

/** A product row with a picture kept in the database: the picture becomes a
    short link the browser can download once and keep. Other rows unchanged. */
function withPictureLink(row) {
    if (!row || typeof row.image_url !== 'string' || !row.image_url.startsWith('data:')) return row;
    const v = require('crypto').createHash('sha1').update(row.image_url).digest('hex').slice(0, 10);
    return { ...row, image_url: `/api/products/${row.id}/image?v=${v}` };
}
/** The product id in one of those links, or null. */
function pictureLinkId(value) {
    const m = typeof value === 'string' ? value.match(PICTURE_LINK) : null;
    return m ? Number(m[1]) : null;
}

module.exports = { MAX_IMAGE_MB, MAX_IMAGE_BYTES, dataUrlBytes, imageProblem, withPictureLink, pictureLinkId };
