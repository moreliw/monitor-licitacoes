// Gera build/icon.png (512x512): prédio legislativo estilizado, sem dependências externas.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 512;
const px = Buffer.alloc(N * N * 4);
const set = (x, y, r, g, b, a = 255) => { const i = (y * N + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };

const inRound = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), N - 1 - r), cy = Math.min(Math.max(y, r), N - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    if (!inRound(x, y, 96)) { set(x, y, 0, 0, 0, 0); continue; }
    const t = y / N;
    let c = [Math.round(20 + 10 * t), Math.round(80 + 30 * t), Math.round(122 + 40 * t)];
    const white = [255, 255, 255];
    // frontão (triângulo)
    const apexY = 110, baseY = 200, half = 190;
    const inTri = y >= apexY && y <= baseY && Math.abs(x - N / 2) <= ((y - apexY) / (baseY - apexY)) * half;
    // arquitrave
    const arch = y >= 208 && y <= 232 && x >= 66 && x <= 446;
    // colunas
    const colXs = [100, 192, 284, 376];
    const col = y >= 240 && y <= 380 && colXs.some((cx) => x >= cx && x <= cx + 36);
    // degraus
    const base1 = y >= 388 && y <= 412 && x >= 66 && x <= 446;
    const base2 = y >= 420 && y <= 444 && x >= 46 && x <= 466;
    // círculo no frontão (vazado)
    const hole = (x - N / 2) ** 2 + (y - 168) ** 2 <= 16 * 16;
    if ((inTri && !hole) || arch || col || base1 || base2) c = white;
    set(x, y, ...c);
  }
}

// PNG
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log('icone gerado:', out, png.length, 'bytes');
