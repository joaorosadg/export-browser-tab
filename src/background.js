import { buildPdf } from './lib/pdf.js';
import { DEFAULTS } from './lib/defaults.js';

// ---------- Configuração ----------

const A4 = { width: 595.28, height: 841.89 }; // pontos
const MAX_PDF_PAGE = 14400; // limite de altura de página imposto pela especificação PDF (200")
const STRIP_PX = 8000; // altura máxima (px físicos) por captura individual
const MAX_CANVAS_DIM = 32767;
const MAX_CANVAS_AREA = 120_000_000; // ~480 MB de RAM — acima disto reduz-se a escala do PNG
const PDF_TARGET_DENSITY = 2; // resolução mínima das imagens no PDF (px por px CSS)


// ---------- Mensagens ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'capture') return false;
  run(msg.tab, msg.options).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: friendlyError(err) }),
  );
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const presets = {
    'full-png': { area: 'full', format: 'png' },
    'full-pdf': { area: 'full', format: 'pdf', pdfMode: 'a4' },
  };
  if (!presets[command] || !tab) return;
  const stored = await chrome.storage.local.get(DEFAULTS);
  try {
    await run(tab, { ...stored, ...presets[command] });
  } catch (err) {
    console.error(err);
    flashBadge('ERR', '#d93025');
  }
});

let busy = false;

async function run(tab, options) {
  if (busy) throw new Error('Já existe uma captura em curso.');
  busy = true;
  try {
    const opts = { ...DEFAULTS, ...options };
    assertCapturable(tab.url);
    const file = await capture(tab, opts);
    await download(file, fileName(tab, file.ext), opts.saveAs);
    flashBadge('OK', '#188038');
  } finally {
    busy = false;
  }
}

async function capture(tab, opts) {
  // Área visível em PNG não precisa do debugger (sem barra de aviso do Chrome).
  if (opts.area === 'visible' && opts.format === 'png') {
    progress('A capturar área visível…');
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { dataUrl, ext: 'png' };
  }

  return withDebugger(tab.id, async (cdp) => {
    if (opts.format === 'pdf' && opts.pdfMode === 'print') {
      progress('A gerar PDF com texto…');
      const { data } = await cdp('Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        paperWidth: 8.27, // A4 em polegadas (a menos que a página defina @page)
        paperHeight: 11.69,
        marginTop: 0.4,
        marginBottom: 0.4,
        marginLeft: 0.4,
        marginRight: 0.4,
      });
      return { dataUrl: `data:application/pdf;base64,${data}`, ext: 'pdf' };
    }

    const restoreScroll = opts.area === 'full' ? await prepareFullPage(cdp, opts.lazyLoad) : null;
    try {
      const m = await metrics(cdp);
      const region = opts.area === 'full' ? { x: 0, y: 0, width: m.width, height: m.height } : m.viewport;
      return opts.format === 'pdf'
        ? await capturePdf(cdp, region, m.dpr, opts.pdfMode, tab.title)
        : await capturePng(cdp, region, m.dpr, opts.area === 'full');
    } finally {
      if (restoreScroll) await restoreScroll();
    }
  });
}

// ---------- PNG ----------

async function capturePng(cdp, region, dpr, beyondViewport) {
  const { width: w, height: h } = region;
  const scale = Math.min(
    1,
    MAX_CANVAS_DIM / (w * dpr),
    MAX_CANVAS_DIM / (h * dpr),
    Math.sqrt(MAX_CANVAS_AREA / (w * h * dpr * dpr)),
  );
  const stripCss = Math.max(1, Math.floor(STRIP_PX / (dpr * scale)));

  // Cabe numa única captura: devolve o PNG tal como o Chrome o gera.
  if (h <= stripCss) {
    progress('A capturar…');
    const data = await shot(cdp, { ...region, scale }, 'png', beyondViewport);
    return { dataUrl: `data:image/png;base64,${data}`, ext: 'png' };
  }

  const canvas = new OffscreenCanvas(Math.round(w * dpr * scale), Math.round(h * dpr * scale));
  const ctx = canvas.getContext('2d');
  const total = Math.ceil(h / stripCss);
  for (let i = 0, y = 0; y < h; i++, y += stripCss) {
    progress(`A capturar ${i + 1}/${total}…`);
    const data = await shot(
      cdp,
      { x: region.x, y: region.y + y, width: w, height: Math.min(stripCss, h - y), scale },
      'png',
      beyondViewport,
    );
    const bmp = await createImageBitmap(new Blob([b64ToBytes(data)], { type: 'image/png' }));
    ctx.drawImage(bmp, 0, Math.round(y * dpr * scale));
    bmp.close();
  }
  progress('A codificar PNG…');
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { blob, ext: 'png' };
}

// ---------- PDF (imagem) ----------

async function capturePdf(cdp, region, dpr, mode, title) {
  const { width: w, height: h } = region;
  const ptPerCss = A4.width / w;
  const pageCss = (mode === 'continuous' ? MAX_PDF_PAGE : A4.height) / ptPerCss;
  const scale = Math.max(1, PDF_TARGET_DENSITY / dpr);
  const stripCss = Math.max(1, Math.floor(STRIP_PX / (dpr * scale)));
  const totalPages = Math.ceil(h / pageCss);
  const pages = [];

  for (let p = 0, pageY = 0; pageY < h; p++, pageY += pageCss) {
    progress(`A capturar página ${p + 1}/${totalPages}…`);
    const pageH = Math.min(pageCss, h - pageY);
    const images = [];
    for (let y = 0; y < pageH; y += stripCss) {
      const stripH = Math.min(stripCss, pageH - y);
      const data = await shot(
        cdp,
        { x: region.x, y: region.y + pageY + y, width: w, height: stripH, scale },
        'jpeg',
        true,
      );
      images.push({ jpeg: b64ToBytes(data), x: 0, top: y * ptPerCss, drawW: A4.width, drawH: stripH * ptPerCss });
    }
    pages.push({
      width: A4.width,
      height: mode === 'continuous' ? pageH * ptPerCss : A4.height,
      images,
    });
  }

  progress('A montar PDF…');
  return { blob: buildPdf(pages, { title }), ext: 'pdf' };
}

// ---------- CDP helpers ----------

async function withDebugger(tabId, fn) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (err) {
    if (/already attached/i.test(err.message)) {
      throw new Error('O DevTools (ou outra extensão) já está ligado a este separador. Fecha-o e tenta de novo.');
    }
    throw err;
  }
  const cdp = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
  try {
    return await fn(cdp);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

function shot(cdp, clip, format, captureBeyondViewport) {
  return cdp('Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' ? { quality: 92 } : {}),
    clip,
    captureBeyondViewport,
    fromSurface: true,
  }).then((r) => r.data);
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || 'Erro ao avaliar script');
  return result.value;
}

async function metrics(cdp) {
  const m = await cdp('Page.getLayoutMetrics');
  const content = m.cssContentSize || m.contentSize;
  const vv = m.cssVisualViewport || m.visualViewport;
  const dpr = (await evaluate(cdp, 'window.devicePixelRatio')) || 1;
  return {
    dpr,
    width: Math.ceil(content.width),
    height: Math.ceil(content.height),
    viewport: {
      x: vv.pageX,
      y: vv.pageY,
      width: Math.floor(vv.clientWidth),
      height: Math.floor(vv.clientHeight),
    },
  };
}

/**
 * Página inteira: opcionalmente percorre a página para forçar lazy-loading,
 * depois volta ao topo (cabeçalhos fixos/sticky ficam no sítio certo).
 * Devolve uma função que repõe a posição de scroll original.
 */
async function prepareFullPage(cdp, lazyLoad) {
  const original = await evaluate(cdp, '({ x: scrollX, y: scrollY })');
  if (lazyLoad) {
    progress('A carregar conteúdo da página…');
    await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const step = Math.max(200, innerHeight * 0.9);
        for (let i = 0, y = 0; i < 80 && y < document.documentElement.scrollHeight; i++, y += step) {
          scrollTo(0, y);
          await wait(120);
        }
        await wait(250);
      })()`,
    );
  }
  await evaluate(cdp, 'scrollTo(0, 0); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  return () => evaluate(cdp, `scrollTo(${original.x}, ${original.y})`).catch(() => {});
}

// ---------- Download ----------

async function download(file, filename, saveAs) {
  progress('A guardar…');
  const url = file.dataUrl ?? (await blobToDataUrl(file.blob));
  const opts = { url, saveAs, conflictAction: 'uniquify' };
  try {
    await chrome.downloads.download({ ...opts, filename });
  } catch (err) {
    if (!/filename/i.test(err.message)) throw err;
    // Alguns sistemas (ex. Linux com locale não-UTF-8) rejeitam acentos: tenta versão ASCII.
    const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
    await chrome.downloads.download({ ...opts, filename: ascii.startsWith('.') ? `captura${ascii}` : ascii });
  }
}

function fileName(tab, ext) {
  let host = '';
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {}
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  const title = (tab.title || host || 'captura')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return `${title || 'captura'} - ${stamp}.${ext}`;
}

// ---------- Utilitários ----------

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(bin)}`;
}

function assertCapturable(url = '') {
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(url) || /^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/i.test(url)) {
    throw new Error('O Chrome não permite capturar esta página (páginas internas e Web Store).');
  }
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (/Cannot access|cannot be scripted|chrome:\/\//i.test(msg)) return 'O Chrome não permite capturar esta página.';
  if (/Detached|Canceled by the user/i.test(msg)) return 'Captura cancelada (a barra de depuração foi fechada).';
  return msg;
}

function progress(text) {
  chrome.runtime.sendMessage({ type: 'progress', text }).catch(() => {});
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}
