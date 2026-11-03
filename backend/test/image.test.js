const test = require('node:test');
const assert = require('node:assert');

const { MAX_IMAGE_BYTES, dataUrlBytes, imageProblem } = require('../utils/image');

const dataUrl = (bytes, type = 'jpeg') => `data:image/${type};base64,` + Buffer.alloc(bytes, 1).toString('base64');

test('picture: none, a hosted link, or a small image is accepted', () => {
    assert.equal(imageProblem(null), null);
    assert.equal(imageProblem(''), null);
    assert.equal(imageProblem('https://res.cloudinary.com/x/image/upload/a.jpg'), null);
    assert.equal(imageProblem('images/products/aozi-adult.jpg'), null, "the shop's own pictures");
    assert.equal(imageProblem(dataUrl(80 * 1024)), null);
    assert.equal(imageProblem(dataUrl(1000, 'png')), null);
});

test('picture: the size is read from the base64 text', () => {
    for (const n of [1, 2, 3, 4, 1000, 1001]) {
        assert.equal(dataUrlBytes(Buffer.alloc(n).toString('base64')), n);
    }
});

test('picture: exactly 10 MB passes, one byte more is refused', () => {
    assert.equal(imageProblem(dataUrl(MAX_IMAGE_BYTES)), null);
    assert.equal(imageProblem(dataUrl(MAX_IMAGE_BYTES + 1)), 'The picture is larger than 10 MB. Choose a smaller one.');
});

test('picture: anything that is not an image is refused', () => {
    assert.match(imageProblem('data:text/html;base64,PHNjcmlwdD4='), /PNG, JPG, WEBP or GIF/);
    assert.match(imageProblem('data:image/svg+xml;base64,PHN2Zz4='), /PNG, JPG, WEBP or GIF/, 'svg can carry script');
    assert.match(imageProblem('javascript:alert(1)'), /PNG, JPG, WEBP or GIF/);
    assert.match(imageProblem('images/../.env'), /PNG, JPG, WEBP or GIF/);
});

test('a picture kept in the database is sent as a link the browser can keep', () => {
    const { withPictureLink, pictureLinkId, imageProblem } = require('../utils/image');
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const row = withPictureLink({ id: 126, name: 'AOZI', image_url: data });
    assert.match(row.image_url, /^\/api\/products\/126\/image\?v=[0-9a-f]{10}$/);
    assert.equal(withPictureLink({ id: 1, image_url: 'https://cdn.example/x.png' }).image_url, 'https://cdn.example/x.png', 'hosted links stay');
    assert.equal(withPictureLink({ id: 1, image_url: null }).image_url, null);
    assert.notEqual(withPictureLink({ id: 126, image_url: data + 'A' }).image_url, row.image_url, 'a changed picture is a new link');
    assert.equal(pictureLinkId(row.image_url), 126);
    assert.equal(pictureLinkId('/api/products/12/other'), null);
    assert.equal(imageProblem(row.image_url), null, 'its own link is accepted when a product is saved');
});
