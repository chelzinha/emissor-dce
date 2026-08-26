import { parsePortalReturnCsv } from './portal-return.js';

const ROOT = document.querySelector('#elections-app');
const STYLE_ID = 'portal-return-package-ui-style';
const PDF_SELECTION_EVENT = 'portal-return:pdf-selection';
let scheduled = false;
let accumulatedPdfFiles = [];

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .return-package-summary{display:block;margin-top:8px;padding:9px 11px;border-radius:10px;background:#eef6fb;color:#31506c;font-size:12px;line-height:1.45}
    .return-package-summary.warn{background:#fff6df;color:#8a5a00}
    .return-package-summary strong{color:inherit}
  `;
  document.head.appendChild(style);
}

function summaryNode(input, kind) {
  let node = input.parentElement?.querySelector(`[data-return-package-summary="${kind}"]`);
  if (!node) {
    node = document.createElement('small');
    node.className = 'return-package-summary';
    node.dataset.returnPackageSummary = kind;
    input.insertAdjacentElement('afterend', node);
  }
  return node;
}

async function updateCsvSummary(input) {
  const node = summaryNode(input, 'csv');
  const file = input.files?.[0];
  if (!file) {
    node.textContent = 'Nenhum CSV selecionado.';
    return;
  }
  try {
    const parsed = parsePortalReturnCsv(await file.text());
    const total = new Intl.NumberFormat('pt-BR').format(parsed.rows.length);
    node.innerHTML = `<strong>${file.name}</strong> · ${total} objetos no CSV.`;
    node.classList.toggle('warn', Boolean(parsed.errors.length));
  } catch {
    node.innerHTML = `<strong>${file.name}</strong> · não foi possível contar os objetos antes da auditoria.`;
    node.classList.add('warn');
  }
}

function updatePdfSummary(input, files = accumulatedPdfFiles) {
  const node = summaryNode(input, 'pdf');
  const selected = [...(files || [])];
  if (!selected.length) {
    node.textContent = 'Nenhum PDF selecionado.';
    node.classList.add('warn');
    return;
  }
  const names = selected.map((file) => file.name).join(', ');
  node.innerHTML = `<strong>${selected.length} PDF${selected.length > 1 ? 's' : ''} acumulado${selected.length > 1 ? 's' : ''}:</strong> ${names}. Você pode escolher os arquivos em seleções sucessivas; os anteriores serão mantidos.`;
  node.classList.remove('warn');
}

function clearStaleAnalysis() {
  const slot = ROOT?.querySelector('#portal-return-analysis');
  if (slot?.childElementCount) slot.replaceChildren();
}

function mount() {
  ensureStyle();
  const csv = ROOT?.querySelector('#portal-return-csv');
  const pdf = ROOT?.querySelector('#portal-return-pdfs');
  if (csv && !csv.dataset.packageSummaryReady) {
    csv.dataset.packageSummaryReady = '1';
    csv.addEventListener('change', () => {
      clearStaleAnalysis();
      updateCsvSummary(csv);
    });
    updateCsvSummary(csv);
  }
  if (pdf) updatePdfSummary(pdf, accumulatedPdfFiles.length ? accumulatedPdfFiles : [...(pdf.files || [])]);
}

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    mount();
  });
}

document.addEventListener(PDF_SELECTION_EVENT, (event) => {
  accumulatedPdfFiles = [...(event.detail?.files || [])];
  clearStaleAnalysis();
  const input = ROOT?.querySelector('#portal-return-pdfs');
  if (input) updatePdfSummary(input, accumulatedPdfFiles);
});

const observer = new MutationObserver(scheduleMount);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
scheduleMount();
