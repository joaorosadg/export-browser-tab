// Gerador mínimo de PDF (1.4) que só sabe fazer uma coisa: colocar imagens JPEG em páginas.
// Sem dependências — o JPEG é embutido tal como vem (filtro DCTDecode), sem re-compressão.

const enc = new TextEncoder();

/** Lê largura/altura diretamente do marcador SOF do JPEG. */
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + len;
  }
  throw new Error('JPEG inválido: marcador SOF não encontrado');
}

/** Texto PDF em UTF-16BE (suporta acentos e qualquer carácter). */
function pdfText(str) {
  let hex = 'FEFF';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())})`;
}

const n = (v) => (Math.round(v * 100) / 100).toString();

/**
 * @param {Array<{width:number,height:number,images:Array<{jpeg:Uint8Array,x:number,top:number,drawW:number,drawH:number}>}>} pages
 *        Dimensões em pontos (1/72"). `top` é medido a partir do topo da página.
 * @param {{title?:string, subject?:string}} meta
 * @returns {Blob}
 */
export function buildPdf(pages, meta = {}) {
  const chunks = [];
  const offsets = [];
  let offset = 0;
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    offset += b.length;
  };
  const beginObj = (id) => { offsets[id] = offset; push(`${id} 0 obj\n`); };
  const endObj = () => push('\nendobj\n');

  // Numeração: 1 catálogo, 2 árvore de páginas, 3 info, depois objetos por página/imagem.
  let next = 4;
  const layout = pages.map((page) => {
    const pageId = next++;
    const contentId = next++;
    const imageIds = page.images.map(() => next++);
    return { page, pageId, contentId, imageIds };
  });

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marca binária

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>');
  endObj();

  beginObj(2);
  push(`<< /Type /Pages /Count ${layout.length} /Kids [${layout.map((l) => `${l.pageId} 0 R`).join(' ')}] >>`);
  endObj();

  beginObj(3);
  const now = new Date();
  push('<< /Producer (Export Browser Tab)');
  if (meta.title) push(` /Title ${pdfText(meta.title)}`);
  if (meta.subject) push(` /Subject ${pdfText(meta.subject)}`);
  push(` /CreationDate ${pdfDate(now)} >>`);
  endObj();

  for (const { page, pageId, contentId, imageIds } of layout) {
    const xobjects = imageIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ');
    beginObj(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] ` +
        `/Resources << /XObject << ${xobjects} >> >> /Contents ${contentId} 0 R >>`,
    );
    endObj();

    const ops = page.images
      .map((img, i) => {
        const y = page.height - img.top - img.drawH;
        return `q ${n(img.drawW)} 0 0 ${n(img.drawH)} ${n(img.x)} ${n(y)} cm /Im${i} Do Q`;
      })
      .join('\n');
    const content = enc.encode(ops);
    beginObj(contentId);
    push(`<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push('\nendstream');
    endObj();

    page.images.forEach((img, i) => {
      const { width, height, components } = jpegSize(img.jpeg);
      const cs = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      beginObj(imageIds[i]);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
      );
      push(img.jpeg);
      push('\nendstream');
      endObj();
    });
  }

  const xrefStart = offset;
  push(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let id = 1; id < next; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${next} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}
