const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('crow PNGs and multi-size Windows ICO contain matching square frames', () => {
  const directory = path.resolve(__dirname, '../public/icons');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const ico = fs.readFileSync(path.join(directory, 'rift.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), sizes.length);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((size, i) => {
    const png = fs.readFileSync(path.join(directory, `rift-${size}.png`));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    const entry = 6 + 16 * i;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    assert.equal(ico.readUInt32LE(entry + 8), png.length);
    assert.equal(ico.readUInt32LE(entry + 12), offset);
    assert.deepEqual(ico.subarray(offset, offset + png.length), png);
    offset += png.length;
  });
  assert.equal(ico.length, offset);
});
