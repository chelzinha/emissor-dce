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
  ['#portal-return-csv', 'Escolher CSV'],
  ['#portal-return-pdfs', 'Escolher PDFs'],
  ['.label-setup-modal [data-stamp]', 'Selecionar chancela'],
  ['#rate-file', 'Escolher CSV'],
  ['#tracking-file', 'Escolher CSV'],
  ['#certificate', 'Selecionar certificado A1'],
  ['#history-certificate', 'Selecionar certificado A1'],
  ['#cert', 'Selecionar certificado A1'],
];

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* O input NAO e escondido: ele fica transparente por cima do botao.
       Assim o clique e do proprio usuario no input nativo, sem depender de
       disparo por codigo, que o navegador pode recusar em silencio. */
    .agf-native-file-hidden{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;opacity:0!important;cursor:pointer!important;z-index:22!important;font-size:0!important}
    .agf-file-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 8px;position:relative;z-index:20}
    .agf-file-picker .agf-file-slot{position:relative;display:inline-block}
    .agf-file-picker button{position:relative;z-index:21;pointer-events:none;cursor:pointer!important}
    .agf-file-picker strong{min-width:0;max-width:100%;font-size:11px;color:#526176;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .label-stamp-upload .agf-file-picker{display:grid;grid-template-columns:max-content minmax(0,1fr);margin:0 0 7px}
    .label-stamp-upload .agf-file-picker strong{align-self:center}
  `;
  document.head.appendChild(style);
}

export function selectionLabel(input) {
  const count = input?.files?.length || 0;
  if (!count) return 'Nenhum arquivo escolhido';
  if (count === 1) return input.files[0].name;
  return `${count} arquivos selecionados`;
}

/** Acha o input que o botao controla, sem depender de closure. */
export function inputForButton(button, root = document) {
  if (!button) return null;
  const id = button.dataset.agfTarget;
  if (id) {
    const byId = root.querySelector(`#${CSS.escape(id)}`);
    if (byId) return byId;
  }
  const slot = button.closest('.agf-file-slot');
  const noSlot = slot?.querySelector('input[type=file]');
  if (noSlot) return noSlot;
  const picker = button.closest('.agf-file-picker');
  return picker?.querySelector('input[type=file]')
    || picker?.parentElement?.querySelector('input[type=file]') || null;
}

function decorateInput(input, buttonText) {
  if (!input || input.dataset.agfPickerReady === '1') return;
  input.dataset.agfPickerReady = '1';
  input.classList.add('agf-native-file-hidden');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const picker = document.createElement('div');
  picker.className = 'agf-file-picker';
  const slot = document.createElement('span');
  slot.className = 'agf-file-slot';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = buttonText;
  // A referencia vive no DOM, nao numa closure: sobrevive a qualquer render.
  if (input.id) button.dataset.agfTarget = input.id;
  button.dataset.agfPicker = '1';
  const name = document.createElement('strong');
  name.dataset.agfPickerName = '1';
  name.textContent = selectionLabel(input);
  picker.append(slot, name);
  input.insertAdjacentElement('afterend', picker);
  // O input nativo cobre o botao, transparente. O clique e sempre do usuario.
  slot.append(button, input);
  // Contem o clique no proprio input. Sem isso ele sobe ate um [data-view] e
  // dispara app.innerHTML, que destroi o input antes de a janela abrir.
  // stopPropagation nao cancela a acao padrao: o seletor abre normalmente.
  input.addEventListener('click', (event) => event.stopPropagation());
}

function mount() {
  ensureStyle();
  for (const [seletor, texto] of CAMPOS) {
    document.querySelectorAll(seletor).forEach((input) => decorateInput(input, texto));
  }
}

/**
 * Abre o seletor nativo.
 *
 * input.click() em campo de arquivo escondido tem historico de recusa
 * silenciosa: a chamada e aceita, nao lanca erro, e nenhuma janela abre.
 * showPicker() foi criado para este caso e lanca excecao quando e recusado
 * (SecurityError, NotAllowedError, InvalidStateError), o que transforma uma
 * falha invisivel em diagnostico.
 *
 * @returns {string} 'showPicker', 'click' ou 'falhou'
 */
export function abrirSeletor(input) {
  if (!input) return 'falhou';
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return 'showPicker';
    } catch (erro) {
      console.warn('[picker] showPicker recusado:', erro?.name, erro?.message);
    }
  }
  try {
    input.click();
    return 'click';
  } catch (erro) {
    console.warn('[picker] input.click() falhou:', erro?.name, erro?.message);
    return 'falhou';
  }
}

/* Delegacao unica. Registrada uma vez, imune a innerHTML. */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-agf-picker]');
  if (!button) return;
  // Impede que o clique suba e dispare troca de tela antes do seletor abrir.
  event.preventDefault();
  event.stopImmediatePropagation();
  abrirSeletor(inputForButton(button));
}, true);

document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input?.matches?.('input[type=file]')) return;
  const rotulo = input.closest('.agf-file-picker')?.querySelector?.('[data-agf-picker-name]');
  if (rotulo) rotulo.textContent = selectionLabel(input);
});

const observer = new MutationObserver(() => queueMicrotask(mount));
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
