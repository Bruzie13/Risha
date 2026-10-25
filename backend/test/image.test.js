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
