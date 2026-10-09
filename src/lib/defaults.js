export const DEFAULTS = {
  area: 'full', // 'full' | 'visible'
  format: 'png', // 'png' | 'pdf'
  pdfMode: 'a4', // 'a4' | 'continuous' | 'print'
  lazyLoad: true,
  saveAs: false,
};

const CHOICES = {
  area: ['full', 'visible'],
  format: ['png', 'pdf'],
  pdfMode: ['a4', 'continuous', 'print'],
};

/** Devolve opções válidas: valores desconhecidos (ou `null` guardado por versões antigas) voltam ao omissão. */
export function normalize(o = {}) {
  const out = { ...DEFAULTS };
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (allowed.includes(o[key])) out[key] = o[key];
  }
  for (const key of ['lazyLoad', 'saveAs']) {
    if (typeof o[key] === 'boolean') out[key] = o[key];
  }
  return out;
}
