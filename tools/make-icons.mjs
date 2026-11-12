// Generates the app icons as PNGs with no dependencies: node tools/make-icons.mjs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#2b2d42');
const EMPTY = hex('#3a3d58');
const COLORS = { R: hex('#e63946'), P: hex('#ff8fab'), Y: hex('#e3b000'), B: hex('#4cc9f0') };
// 7x7 pixel heart on a puzzle grid, plus a couple of "clue" pixels.
const ART = [
  '.RR.RR.',
  'RPRRRRR',
  'RRRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
];

function iconPixel(size, padFrac) {
  const n = ART.length;
  const pad = size * padFrac;
  const cell = (size - 2 * pad) / n;
  const gap = Math.max(1, cell * 0.1);
  return (x, y) => {
    const gx = (x - pad) / cell;
    const gy = (y - pad) / cell;
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return BG;
    const cx = Math.floor(gx), cy = Math.floor(gy);
    const fx = (gx - cx) * cell, fy = (gy - cy) * cell;
    if (fx < gap / 2 || fy < gap / 2 || fx > cell - gap / 2 || fy > cell - gap / 2) return BG;
    const ch = ART[cy][cx];
    return ch === '.' ? EMPTY : COLORS[ch];
  };
}

const out = [
  ['icons/icon-192.png', 192, 0.14],
  ['icons/icon-512.png', 512, 0.14],
  ['icons/apple-touch-icon.png', 180, 0.14],
  ['icons/icon-maskable-512.png', 512, 0.22], // extra padding for the mask safe zone
];
for (const [file, size, padFrac] of out) {
  fs.writeFileSync(path.join(root, file), png(size, iconPixel(size, padFrac)));
  console.log('wrote', file);
}
