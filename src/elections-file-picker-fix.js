const ROOT = document.querySelector('#elections-app');

const STYLE_ID = 'agf-file-picker-fix-style';

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

function selectionLabel(input) {
  const count = input.files?.length || 0;
  if (!count) return 'Nenhum arquivo escolhido';
  if (count === 1) return input.files[0].name;
  return `${count} arquivos selecionados`;
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
  const name = document.createElement('strong');
  name.textContent = selectionLabel(input);
  picker.append(button, name);
  input.insertAdjacentElement('afterend', picker);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.click();
  });
  input.addEventListener('change', () => {
    name.textContent = selectionLabel(input);
  });
}

function mount() {
  ensureStyle();
  decorateInput(document.querySelector('#portal-return-csv'), 'Escolher CSV');
  decorateInput(document.querySelector('#portal-return-pdfs'), 'Escolher PDFs');
  decorateInput(document.querySelector('.label-setup-modal [data-stamp]'), 'Selecionar chancela');
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
observer.observe(document.body, { childList: true, subtree: true });
mount();
