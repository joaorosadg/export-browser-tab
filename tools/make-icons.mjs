// Gera os ícones PNG da extensão sem dependências: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Forma em coordenadas normalizadas 0..1: quadrado arredondado azul com
// cantos de "visor" brancos e uma seta de download ao centro.
function sample(x, y) {
  const r = 0.2;
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  if (dx * dx + dy * dy > r * r) return null; // fora
  const white = [255, 255, 255, 255];
  const bg = [31, 111, 235, 255];
  const t = 0.075; // espessura
  const a = 0.18, b = 0.82, len = 0.2;
  const inCorner = (cx, cy, sx, sy) => {
    const lx = (x - cx) * sx, ly = (y - cy) * sy;
    return (lx >= 0 && lx <= len && ly >= 0 && ly <= t) || (ly >= 0 && ly <= len && lx >= 0 && lx <= t);
  };
  if (inCorner(a, a, 1, 1) || inCorner(b, a, -1, 1) || inCorner(a, b, 1, -1) || inCorner(b, b, -1, -1)) return white;
  // seta: haste + ponta
  if (Math.abs(x - 0.5) <= t / 2 + 0.005 && y >= 0.3 && y <= 0.56) return white;
  const tipTop = 0.5, tipBottom = 0.68, half = 0.15;
  if (y >= tipTop && y <= tipBottom && Math.abs(x - 0.5) <= half * (1 - (y - tipTop) / (tipBottom - tipTop))) return white;
  return bg;
}

function png(size) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
        if (c) { rr += c[0] * c[3]; gg += c[1] * c[3]; bb += c[2] * c[3]; aa += c[3]; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = aa ? Math.round(rr / aa) : 0;
      raw[o + 1] = aa ? Math.round(gg / aa) : 0;
      raw[o + 2] = aa ? Math.round(bb / aa) : 0;
      raw[o + 3] = Math.round(aa / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`../src/icons/icon${s}.png`, import.meta.url), png(s));
console.log('ok');
