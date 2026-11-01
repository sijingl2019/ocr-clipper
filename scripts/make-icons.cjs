// Generate simple PNG icons (rounded green square with a white page and text lines) without dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      // rounded square mask
      const dx = Math.max(0, Math.abs(x + 0.5 - size / 2) - (size / 2 - r));
      const dy = Math.max(0, Math.abs(y + 0.5 - size / 2) - (size / 2 - r));
      const inside = dx * dx + dy * dy <= r * r;
      let c = [0, 0, 0, 0];
      if (inside) {
        c = [47, 111, 94, 255];
        const page = u > 0.24 && u < 0.76 && v > 0.16 && v < 0.84;
        if (page) {
          c = [255, 255, 255, 255];
          const line = [0.3, 0.42, 0.54, 0.66].some((ly) => v > ly && v < ly + 0.055) && u > 0.32 && u < (v > 0.6 ? 0.56 : 0.68);
          if (line) c = [47, 111, 94, 255];
        }
        // scan bar
        if (v > 0.47 && v < 0.53 && u > 0.12 && u < 0.88) c = [240, 170, 60, 255];
      }
      raw.set(c, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(__dirname, '..', 'icons', `icon${s}.png`), png(s));
console.log('icons written');
