import './elections-return-stage-actions.css';

const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';
let scheduled = false;

function currentStage() {
  try {
    const stored = Number(sessionStorage.getItem(STAGE_KEY) || ROOT?.dataset.operationStage || 0);
    return stored >= 3 && stored <= 6 ? stored : 0;
  } catch {
    return Number(ROOT?.dataset.operationStage || 0);
  }
}

function activeView() {
  return ROOT?.querySelector('.app-nav button.active[data-view]')?.dataset.view || '';
}

function fileState(upload) {
  return {
    csv: Boolean(upload?.querySelector('#portal-return-csv')?.files?.[0]),
    pdf: Boolean(upload?.querySelector('#portal-return-pdfs')?.files?.length),
  };
}

function buttonMarkup(stage) {
  const next = stage === 3 ? 4 : 5;
  const label = stage === 3 ? 'Continuar: configurar etiqueta' : 'Continuar: auditar Data Matrix';
  return `<div class="return-stage-actions" data-return-stage-actions="${stage}">
    <div>
      <strong>${stage === 3 ? 'Arquivos selecionados' : 'Configuração concluída'}</strong>
      <small data-return-stage-status></small>
    </div>
    <button type="button" class="primary return-stage-next" data-process-stage="${next}" disabled>${label}</button>
  </div>`;
}

function updateStageThree(action, upload) {
  const state = fileState(upload);
  const ready = state.csv && state.pdf;
  const button = action.querySelector('.return-stage-next');
  const status = action.querySelector('[data-return-stage-status]');
  button.disabled = !ready;
  status.textContent = ready
    ? 'CSV e PDF prontos. Avance para marcar o Data Matrix e carregar a chancela.'
    : !state.csv && !state.pdf
      ? 'Selecione o CSV das postagens e pelo menos um PDF de etiquetas.'
      : !state.csv
        ? 'Falta selecionar o CSV das postagens.'
        : 'Falta selecionar o PDF das etiquetas.';
  action.classList.toggle('ready', ready);
}

function updateStageFour(action, upload) {
  const analyze = upload.querySelector('#analyze-portal-return');
  const ready = Boolean(analyze && !analyze.disabled);
  const button = action.querySelector('.return-stage-next');
  const status = action.querySelector('[data-return-stage-status]');
  button.disabled = !ready;
  status.textContent = ready
    ? 'Modelo da etiqueta pronto. Avance para executar a auditoria.'
    : 'Use o botão “Configurar etiqueta” e conclua a marcação do Data Matrix e da chancela.';
  action.classList.toggle('ready', ready);
}

function mount() {
  if (!ROOT || activeView() !== 'returns') return;
  const stage = currentStage();
  const upload = ROOT.querySelector('#portal-return-upload-card');
  if (!upload) return;

  upload.querySelectorAll('[data-return-stage-actions]').forEach((node) => {
    if (Number(node.dataset.returnStageActions) !== stage) node.remove();
  });

  if (![3, 4].includes(stage)) return;

  let action = upload.querySelector(`[data-return-stage-actions="${stage}"]`);
  if (!action) {
    const anchor = stage === 3
      ? upload.querySelector('.return-upload-grid')
      : upload.querySelector('.return-label-setup');
    if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', buttonMarkup(stage));
    action = upload.querySelector(`[data-return-stage-actions="${stage}"]`);
  }

  if (stage === 3) updateStageThree(action, upload);
  else updateStageFour(action, upload);
}

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    mount();
  });
}

ROOT?.addEventListener('change', (event) => {
  if (event.target?.matches('#portal-return-csv,#portal-return-pdfs')) scheduleMount();
});

const observer = new MutationObserver(scheduleMount);
if (ROOT) observer.observe(ROOT, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['disabled', 'class', 'data-operation-stage'],
});

scheduleMount();
