import { DEFAULTS, normalize } from './lib/defaults.js';

const form = document.getElementById('form');
const go = document.getElementById('go');
const statusEl = document.getElementById('status');
const hint = document.getElementById('hint');

// Lê pelos elementos e não por FormData: FormData ignora inputs desativados
// (a área fica desativada em "Texto selecionável") e devolvia `null`.
const read = () => {
  const el = form.elements;
  return normalize({
    area: el.area.value,
    format: el.format.value,
    pdfMode: el.pdfMode.value,
    lazyLoad: el.lazyLoad.checked,
    saveAs: el.saveAs.checked,
  });
};

const write = (stored) => {
  const o = normalize(stored);
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
  hint.textContent = [
    printMode && 'O PDF com texto inclui sempre a página inteira.',
    !(o.area === 'visible' && o.format === 'png') &&
      'O Chrome mostra a barra "começou a depurar este browser" durante a captura. É normal e desaparece no fim.',
  ]
    .filter(Boolean)
    .join(' ');
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
