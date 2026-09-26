import { DEFAULTS } from './lib/defaults.js';

const form = document.getElementById('form');
const go = document.getElementById('go');
const statusEl = document.getElementById('status');
const hint = document.getElementById('hint');

const read = () => {
  const f = new FormData(form);
  return {
    area: f.get('area'),
    format: f.get('format'),
    pdfMode: f.get('pdfMode'),
    lazyLoad: f.has('lazyLoad'),
    saveAs: f.has('saveAs'),
  };
};

const write = (o) => {
  for (const name of ['area', 'format', 'pdfMode']) {
    form.querySelector(`input[name=${name}][value=${o[name]}]`).checked = true;
  }
  form.lazyLoad.checked = o.lazyLoad;
  form.saveAs.checked = o.saveAs;
};

const sync = () => {
  const o = read();
  const printMode = o.format === 'pdf' && o.pdfMode === 'print';
  document.getElementById('pdf-opts').hidden = o.format !== 'pdf';
  document.getElementById('lazy-row').hidden = o.area !== 'full' || printMode;
  form.querySelectorAll('input[name=area]').forEach((i) => (i.disabled = printMode));
  hint.textContent =
    o.area === 'visible' && o.format === 'png'
      ? ''
      : 'O Chrome mostra a barra "começou a depurar este browser" durante a captura. É normal e desaparece no fim.';
};

const setStatus = (text, isError = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', isError);
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'progress') setStatus(msg.text);
});

form.addEventListener('change', () => {
  sync();
  chrome.storage.local.set(read());
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return setStatus('Nenhum separador ativo.', true);
  go.disabled = true;
  setStatus('A iniciar…');
  const res = await chrome.runtime.sendMessage({ type: 'capture', tab, options: read() });
  go.disabled = false;
  if (res?.ok) {
    setStatus('Guardado ✓');
    setTimeout(() => window.close(), 900);
  } else {
    setStatus(res?.error || 'Erro desconhecido.', true);
  }
});

write(await chrome.storage.local.get(DEFAULTS));
sync();
