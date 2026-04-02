#!/usr/bin/env node
// Generates minimal PNG icons for the Chrome extension.
// Run once: node generate-icons.js
// Requires no external dependencies — writes raw PNG bytes.

const fs = require('fs');
const path = require('path');
const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

// ---- Minimal raw PNG writer (no canvas needed) ----
const zlib = require('zlib');

function writePng(size, outPath) {
  const fg = [0, 255, 102];   // #00ff66 green
  const bg = [10, 10, 10];    // #0a0a0a near-black

  // Draw a simple terminal ">" cursor icon on solid bg
  const pixels = new Uint8Array(size * size * 4);

  // Fill background
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4 + 0] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = 255;
  }

  // Draw ">" chevron in green
  // Scale to icon size
  const scale = size / 16;
  const thick = Math.max(1, Math.round(scale));

  function setPixel(x, y) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx + 0] = fg[0];
    pixels[idx + 1] = fg[1];
    pixels[idx + 2] = fg[2];
    pixels[idx + 3] = 255;
  }

  function line(x0, y0, x1, y1, t) {
    // Bresenham line, with thickness
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const steps = Math.max(dx, dy) + 1;
    let cx = x0, cy = y0;
    for (let i = 0; i < steps; i++) {
      for (let ox = -Math.floor(t / 2); ox <= Math.floor(t / 2); ox++) {
        for (let oy = -Math.floor(t / 2); oy <= Math.floor(t / 2); oy++) {
          setPixel(cx + ox, cy + oy);
        }
      }
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx)  { err += dx; cy += sy; }
    }
  }

  // ">" chevron centered
  const mid = size / 2;
  const h   = size * 0.5;
  const tip = mid + size * 0.18;
  const base = mid - size * 0.18;

  line(base, mid - h * 0.45, tip, mid, thick);
  line(tip, mid, base, mid + h * 0.45, thick);

  // Build PNG
  const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.concat([typeBytes, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf));
    return Buffer.concat([len, typeBytes, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  // IDAT: raw image rows (filter byte 0 + RGB per pixel)
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      row[1 + x * 3 + 0] = pixels[(y * size + x) * 4 + 0];
      row[1 + x * 3 + 1] = pixels[(y * size + x) * 4 + 1];
      row[1 + x * 3 + 2] = pixels[(y * size + x) * 4 + 2];
    }
    rows.push(row);
  }
  const rawData = Buffer.concat(rows);
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const png = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(outPath, png);
  console.log(`Written: ${outPath} (${size}x${size})`);
}

sizes.forEach(s => writePng(s, path.join(outDir, `icon${s}.png`)));
console.log('Done.');
