const { writeFileSync, mkdirSync } = require('node:fs');
const zlib = require('node:zlib');

mkdirSync('icons', { recursive: true });

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) | 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function solidPng(size, r, g, b) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // RGB

  const row = Buffer.alloc(size * 3 + 1);
  row[0] = 0; // filter type
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const rows = Buffer.concat(Array(size).fill(row));
  const idat = zlib.deflateSync(rows);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('icons/icon-192.png', solidPng(192, 10, 13, 16));
writeFileSync('icons/icon-512.png', solidPng(512, 10, 13, 16));
writeFileSync('icons/icon-512-maskable.png', solidPng(512, 10, 13, 16));
console.log('Placeholder icons written (solid #0a0d10) — replace before launch');
