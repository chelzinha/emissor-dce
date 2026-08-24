import './elections-file-picker-fix.css';
const ROOT = document.querySelector('#elections-app');

const PICKERS = {
  'portal-return-csv': { label: 'Selecionar CSV' },
  'portal-return-pdfs': { label: 'Selecionar PDF(s)' },
};

function fileNames(input) {
  const files = [...(input.files || [])];
  if (!files.length) return 'Nenhum arquivo selecionado';
  if (files.length === 1) return files[0].name;
  return `${files.length} arquivos selecionados`;
}

function enhance(input, options = {}) {
  if (!input || input.dataset.pickerEnhanced === '1') return;
  input.dataset.pickerEnhanced = '1';
  input.classList.add('return-native-file-hidden');

  const control = document.createElement('div');
  control.className = 'return-file-control';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost return-file-button';
  button.textContent = options.label || 'Selecionar arquivo';
  const name = document.createElement('span');
  name.className = 'return-file-name';
  name.textContent = fileNames(input);
  control.append(button, name);
  input.insertAdjacentElement('afterend', control);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  });
  input.addEventListener('change', () => { name.textContent = fileNames(input); });
}

function mount() {
  Object.entries(PICKERS).forEach(([id, options]) => enhance(document.getElementById(id), options));
  document.querySelectorAll('input[data-stamp][type="file"]').forEach((input) => enhance(input, { label: 'Selecionar chancela' }));
}

let queued = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; mount(); });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
observer.observe(document.body, { childList: true, subtree: true });
mount();
