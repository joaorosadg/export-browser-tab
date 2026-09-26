# Export Browser Tab

Extensão Chrome (Manifest V3) para capturar a página atual e exportar para **PNG** ou **PDF**.

Feita para ser auditável: ~500 linhas de JavaScript, **zero dependências**, **zero pedidos de rede**, sem content scripts, sem telemetria. Tudo é processado localmente e guardado direto na pasta de transferências.

## Funcionalidades

| Área | PNG | PDF |
|---|---|---|
| Página inteira | ✅ (junta várias capturas se a página for muito longa) | ✅ imagem em páginas A4, imagem em página contínua, ou texto selecionável |
| Área visível | ✅ (sem debugger) | ✅ |

- Percorre a página antes da captura para forçar o carregamento de imagens *lazy* (opcional).
- Volta ao topo antes de capturar (cabeçalhos fixos ficam no sítio certo) e repõe o scroll no fim.
- Nome do ficheiro: `Título da página - AAAA-MM-DD HH.MM.SS.png`.
- Atalhos: `Alt+Shift+S` abre o painel, `Alt+Shift+P` página inteira → PNG. Configuráveis em `chrome://extensions/shortcuts` (há também "Página inteira → PDF" sem tecla definida).
- Tema claro/escuro automático.

## Instalar (modo programador)

1. `chrome://extensions` → ativar **Modo de programador** (canto superior direito).
2. **Carregar expandida** → escolher a pasta `src/`.
3. Afixar o ícone na barra de ferramentas.

Funciona em Chrome, Edge, Brave e outros baseados em Chromium (≥ 116).

## Permissões e porquê

| Permissão | Uso |
|---|---|
| `activeTab` | Acesso **apenas** ao separador onde clicas, e só nesse momento. |
| `debugger` | Chrome DevTools Protocol: renderizar a página inteira para lá do ecrã (`Page.captureScreenshot`) e gerar PDF com texto (`Page.printToPDF`). |
| `downloads` | Guardar o ficheiro. |
| `storage` | Lembrar as últimas opções escolhidas. |

Não há `host_permissions` nem `<all_urls>`: a extensão não consegue ler nenhuma página sem clicares nela. A CSP das páginas da extensão tem `connect-src 'none'`, portanto nem que quisesse conseguiria enviar dados para fora.

Durante capturas que usam o debugger, o Chrome mostra a barra *"Export Browser Tab começou a depurar este browser"*. É uma proteção do próprio Chrome e desaparece no fim. A captura PNG da área visível não usa o debugger.

## Estrutura

```
src/
  manifest.json
  background.js     captura (CDP), montagem de PNG/PDF, download
  popup.html/css/js interface
  lib/pdf.js        gerador de PDF mínimo (JPEG embutido, sem re-compressão)
  lib/defaults.js   opções por omissão
  icons/            gerados por tools/make-icons.mjs
tools/make-icons.mjs
```

## Limitações conhecidas

- Páginas internas (`chrome://`, Chrome Web Store) não podem ser capturadas — restrição do Chrome.
- Sites cujo scroll está num contentor interno (algumas apps SPA com `body { overflow: hidden }`) só mostram a parte visível desse contentor em "página inteira".
- Elementos com altura `100vh` podem ficar esticados na captura de página inteira.
- PNG tem o limite do canvas do Chrome (32 767 px de altura / ~120 megapíxeis): páginas acima disso são reduzidas proporcionalmente. Para páginas enormes usa PDF, que não tem esse limite (é dividido em páginas).
- Se o DevTools estiver aberto no separador, as capturas via debugger falham — fecha-o primeiro.
- "Texto selecionável" usa o motor de impressão: respeita o CSS `@media print` do site, por isso o aspeto pode diferir do ecrã.
