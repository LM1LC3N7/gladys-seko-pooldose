// Draws cover.png (800x534) for the store: plain Node, no dependency.
// A wall-mounted dosing controller (screen, two dosing pumps, two tubes) above
// pool water, a pH drop and a thermometer, on a teal gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = x / W;
    const s = y / H;
    set(x, y, [12 + 20 * t, 80 + 40 * s, 110 + 50 * t]);
  }
}
const white = [255, 255, 255];
const casing = [236, 240, 244];
const screen = [24, 40, 56];
const water = [40, 170, 220];
const deep = [20, 110, 180];
const red = [230, 80, 70];
const blue = [70, 140, 240];
const green = [90, 210, 140];
const warm = [255, 150, 60];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color, alpha = 1) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};

// The pool water at the bottom, with waves.
for (let y = 400; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, water, 0.9);
    set(x, y, deep, (0.6 * (y - 400)) / (H - 400));
  }
}
for (const [y0, alpha] of [
  [420, 0.8],
  [470, 0.55],
]) {
  for (let x = 0; x < W; x += 1) {
    disc(x, y0 + 7 * Math.sin((x / 60) * Math.PI), 3, white, alpha);
  }
}

// The controller: a casing, a screen with three bars, two round pumps.
box(150, 70, 470, 340, 28, casing);
box(180, 100, 440, 200, 14, screen);
box(205, 125, 290, 140, 6, green);
box(205, 152, 360, 167, 6, blue);
box(205, 179, 320, 194, 6, warm, 0.9);
disc(240, 270, 42, [210, 216, 224]);
disc(240, 270, 30, red);
disc(240, 270, 8, white);
disc(380, 270, 42, [210, 216, 224]);
disc(380, 270, 30, blue);
disc(380, 270, 8, white);
// The tubes down to the water.
line(240, 312, 240, 420, 9, red, 0.9);
line(380, 312, 380, 420, 9, blue, 0.9);

// A pH drop, top right.
const dropY = 215;
const dropR = 46;
for (let y = dropY - 2.3 * dropR; y < dropY; y += 1) {
  const t = (y - (dropY - 2.3 * dropR)) / (1.95 * dropR);
  const half = Math.min(1, t) * dropR * 0.94;
  for (let x = -half; x <= half; x += 1) set(630 + x, y, green);
}
disc(630, dropY, dropR, green);
disc(614, dropY + 10, 10, white, 0.6);
// A thermometer, below it.
box(616, 290, 644, 370, 14, white);
disc(630, 380, 24, white);
disc(630, 380, 15, warm);
box(624, 320, 636, 382, 6, warm);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
