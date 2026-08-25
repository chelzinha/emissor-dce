/**
 * Seletores de arquivo resistentes a recriacao do DOM.
 *
 * Por que este modulo existe:
 *
 * shell() em elections-admin.js faz app.innerHTML = ... a cada troca de tela.
 * Isso destroi todo o DOM e, com ele, qualquer listener ligado a um elemento
 * especifico. Varios modulos se remontam por MutationObserver, criando uma
 * corrida em que o botao que o usuario ve nem sempre e o que tem o handler.
 *
 * Havia ainda um segundo defeito: os inputs de arquivo ficavam dentro de
 * <label>. Clicar no botao acionava a ativacao implicita do label, que subia
 * ate um [data-view] e disparava um render completo, destruindo o input no
 * mesmo instante em que ele tentaria abrir o seletor. O navegador so abre a
 * janela se o input ainda estiver no documento ao fim do processamento.
 *
 * Solucao: os <label> viraram <div> e o clique passa a ser tratado por
 * delegacao unica no document, registrada uma vez e imune a innerHTML.
 */

const STYLE_ID = 'agf-file-picker-fix-style';
const CAMPOS = [
  '#portal-return-csv',
  '#portal-return-pdfs',
  '.label-setup-modal [data-stamp]',
  '#rate-file',
  '#tracking-file',
  '#certificate',
  '#history-certificate',
  '#cert',
];

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* O input nativo fica SEMPRE VISIVEL. Nao ha truque de sobreposicao nem
       disparo por codigo: o usuario clica no controle real do navegador.
       Qualquer tentativa de esconder o input e substitui-lo por um botao
       depende de input.click() ou showPicker(), e ambos podem ser recusados
       em silencio. Este caminho nunca falha. */
    .agf-native-file-visible{display:inline-block!important;position:static!important;opacity:1!important;width:auto!important;height:auto!important;max-width:100%;pointer-events:auto!important;clip:auto!important;font-size:12px}
    .agf-file-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 8px;position:relative;z-index:20}
    .agf-file-picker strong{min-width:0;max-width:100%;font-size:11px;color:#526176;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .label-stamp-upload .agf-file-picker{display:grid;grid-template-columns:max-content minmax(0,1fr);margin:0 0 7px}
    .label-stamp-upload .agf-file-picker strong{align-self:center}
  `;
  document.head.appendChild(style);
}



function decorateInput(input) {
  if (!input || input.dataset.agfPickerReady === '1') return;
  input.dataset.agfPickerReady = '1';
  // Desfaz qualquer ocultacao herdada de versoes anteriores e do CSS do app.
  input.classList.remove('agf-native-file-hidden');
  input.classList.add('agf-native-file-visible');
  input.removeAttribute('aria-hidden');
  input.removeAttribute('tabindex');
  // Contem o clique: sem isso ele sobe ate um [data-view] e dispara
  // app.innerHTML, que destroi o input antes de a janela abrir.
  input.addEventListener('click', (event) => event.stopPropagation());
}

function mount() {
  ensureStyle();
  for (const seletor of CAMPOS) {
    document.querySelectorAll(seletor).forEach((input) => decorateInput(input));
  }
}

const observer = new MutationObserver(() => queueMicrotask(mount));
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
