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
    .agf-native-file-hidden{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}
    .agf-file-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 8px;position:relative;z-index:20}
    .agf-file-picker button{position:relative;z-index:21;pointer-events:auto!important;cursor:pointer!important}
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
  const picker = button.closest('.agf-file-picker');
  const previous = picker?.previousElementSibling;
  if (previous?.matches?.('input[type=file]')) return previous;
  return picker?.parentElement?.querySelector('input[type=file]') || null;
}

function decorateInput(input, buttonText) {
  if (!input || input.dataset.agfPickerReady === '1') return;
  input.dataset.agfPickerReady = '1';
  input.classList.add('agf-native-file-hidden');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const picker = document.createElement('div');
  picker.className = 'agf-file-picker';
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
  picker.append(button, name);
  input.insertAdjacentElement('afterend', picker);
}

function mount() {
  ensureStyle();
  for (const [seletor, texto] of CAMPOS) {
    document.querySelectorAll(seletor).forEach((input) => decorateInput(input, texto));
  }
}

/* Delegacao unica. Registrada uma vez, imune a innerHTML. */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-agf-picker]');
  if (!button) return;
  // Impede que o clique suba e dispare troca de tela antes do seletor abrir.
  event.preventDefault();
  event.stopImmediatePropagation();
  inputForButton(button)?.click();
}, true);

document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input?.matches?.('input[type=file]')) return;
  const rotulo = input.nextElementSibling?.querySelector?.('[data-agf-picker-name]');
  if (rotulo) rotulo.textContent = selectionLabel(input);
});

const observer = new MutationObserver(() => queueMicrotask(mount));
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
