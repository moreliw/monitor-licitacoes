// Ícone do Monitor de Licitações: pórtico legislativo com lupa dourada sobre fundo índigo.
// Desenhado em vetor (canvas Skia) em cada tamanho; nos tamanhos pequenos usa uma versão simplificada.
// Gera: build/icon.png (512), build/icon.ico (16–256), public/logo.png (256, usado na interface).
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Desenha no espaço 512×512 (escalado para `size`). */
function draw(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const s = size / 512;
  ctx.scale(s, s);
  const small = size <= 24;   // 16–24 px: menos detalhes e traços mais grossos
  const medium = size <= 48;

  // fundo: quadrado arredondado índigo com leve luz no topo
  const pad = small ? 8 : 24;
  const r = small ? 96 : 112;
  roundRect(ctx, pad, pad, 512 - pad * 2, 512 - pad * 2, r);
  const bg = ctx.createLinearGradient(0, pad, 0, 512 - pad);
  bg.addColorStop(0, '#3a5bf0');
  bg.addColorStop(1, '#1c2a86');
  ctx.fillStyle = bg;
  ctx.fill();
  if (!small) {
    ctx.save();
    ctx.clip();
    const gloss = ctx.createLinearGradient(0, pad, 0, 300);
    gloss.addColorStop(0, 'rgba(255,255,255,0.16)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, 512, 300);
    ctx.restore();
    roundRect(ctx, pad + 2, pad + 2, 512 - pad * 2 - 4, 512 - pad * 2 - 4, r - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // pórtico (frontão, arquitrave, colunas, degraus)
  const white = '#ffffff';
  ctx.fillStyle = white;
  ctx.strokeStyle = white;
  ctx.lineJoin = 'round';
  const ox = small ? 0 : -12; // abre espaço para a lupa
  const oy = small ? 6 : -6;
  ctx.save();
  ctx.translate(ox, oy);
  // frontão
  ctx.beginPath();
  ctx.moveTo(256, small ? 104 : 112);
  ctx.lineTo(small ? 420 : 404, 196);
  ctx.lineTo(small ? 92 : 108, 196);
  ctx.closePath();
  ctx.lineWidth = small ? 22 : 18;
  ctx.fill();
  ctx.stroke();
  // arquitrave
  roundRect(ctx, small ? 92 : 112, 212, small ? 328 : 288, small ? 34 : 26, 8); ctx.fill();
  // colunas
  const cols = small ? [150, 256, 362] : medium ? [158, 256, 354] : [148, 220, 292, 364];
  const cw = small ? 52 : medium ? 42 : 36;
  for (const cx of cols) { roundRect(ctx, cx - cw / 2, small ? 262 : 252, cw, small ? 104 : 112, 8); ctx.fill(); }
  // degraus
  roundRect(ctx, small ? 80 : 100, small ? 380 : 378, small ? 352 : 312, small ? 40 : 26, 8); ctx.fill();
  if (!small) { roundRect(ctx, 84, 414, 344, 24, 8); ctx.fill(); }
  ctx.restore();

  // lupa dourada (monitorar), com recorte do fundo para separar do prédio
  if (!small) {
    const lx = 350, ly = 338, lr = medium ? 66 : 60;
    ctx.save();
    ctx.beginPath(); ctx.arc(lx, ly, lr + (medium ? 26 : 22), 0, Math.PI * 2);
    ctx.fillStyle = '#22339a'; ctx.fill();
    ctx.restore();
    const gold = ctx.createLinearGradient(lx - lr, ly - lr, lx + lr, ly + lr);
    gold.addColorStop(0, '#ffd56a');
    gold.addColorStop(1, '#f2a516');
    // cabo
    ctx.strokeStyle = gold;
    ctx.lineCap = 'round';
    ctx.lineWidth = medium ? 40 : 34;
    ctx.beginPath();
    ctx.moveTo(lx + lr * 0.72, ly + lr * 0.72);
    ctx.lineTo(lx + lr * 1.36, ly + lr * 1.36);
    ctx.stroke();
    // lente
    ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
    ctx.lineWidth = medium ? 30 : 26;
    ctx.stroke();
    if (!medium) {
      // reflexo
      ctx.beginPath(); ctx.arc(lx, ly, lr - 26, Math.PI * 1.1, Math.PI * 1.45);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 10; ctx.stroke();
    }
  }
  return c.toBuffer('image/png');
}

/** ICO com várias resoluções (entradas PNG, aceitas pelo Windows desde o Vista). */
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'build', 'icon.png'), draw(512));
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
writeFileSync(join(root, 'build', 'icon.ico'), ico(sizes.map((size) => ({ size, png: draw(size) }))));
writeFileSync(join(root, 'public', 'logo.png'), draw(256));
console.log('ícones gerados: build/icon.png, build/icon.ico, public/logo.png');
