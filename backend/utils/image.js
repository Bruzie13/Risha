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

/** The size in bytes of the file inside a base64 data URL. */
function dataUrlBytes(base64) {
    const pad = (base64.match(/=+$/) || [''])[0].length;
    return Math.floor(base64.length * 3 / 4) - pad;
}

/** What is wrong with this picture, or null. Nothing at all is fine. */
function imageProblem(value) {
    if (value == null || value === '') return null;
    const text = String(value);
    if (/^https?:\/\//i.test(text) || OWN_PICTURE.test(text)) return null;
    const m = text.match(IMAGE_DATA_URL);
    if (!m) return 'The picture must be a PNG, JPG, WEBP or GIF image.';
    if (dataUrlBytes(m[2]) > MAX_IMAGE_BYTES) return `The picture is larger than ${MAX_IMAGE_MB} MB. Choose a smaller one.`;
    return null;
}

module.exports = { MAX_IMAGE_MB, MAX_IMAGE_BYTES, dataUrlBytes, imageProblem };
