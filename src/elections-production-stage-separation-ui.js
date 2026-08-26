import './elections-production-stage-separation-ui.css';

const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';

function stage() {
  const value = Number(ROOT?.dataset.operationStage || (() => {
    try { return sessionStorage.getItem(STAGE_KEY) || 0; }
    catch { return 0; }
  })());
  return value >= 1 && value <= 11 ? value : 0;
}

function isProductionView() {
  return Boolean(ROOT?.querySelector('.app-nav button.active[data-view="production"]'));
}

function gate(card, label) {
  return [...card.querySelectorAll('.production-gate')]
    .find((item) => item.querySelector('span')?.textContent?.trim() === label);
}

function setVisible(node, visible) {
  if (!node) return;
  node.hidden = !visible;
  node.classList.toggle('stage-control-hidden', !visible);
}

function note(host, kind, message) {
  if (!host) return;
  host.querySelector('[data-production-stage-note]')?.remove();
  if (!message) return;
  const box = document.createElement('div');
  box.dataset.productionStageNote = kind;
  box.className = `production-stage-note ${kind}`;
  box.innerHTML = message;
  host.appendChild(box);
}

function resetCard(card) {
  card.classList.remove('production-stage-7', 'production-stage-8');
  card.querySelectorAll('.stage-control-hidden').forEach((node) => {
    node.hidden = false;
    node.classList.remove('stage-control-hidden');
  });
  card.querySelectorAll('[data-production-stage-note]').forEach((node) => node.remove());
}

function decorateStageSeven(card) {
  card.classList.add('production-stage-7');
  const documents = card.querySelector('.production-documents');
  const volumeList = documents?.querySelector('.production-volume-list');
  const finalFilesReady = Boolean(volumeList?.querySelector('[data-generate-volume]'));
  const labelTestOk = Boolean(gate(card, 'Etiqueta teste')?.classList.contains('ok'));

  setVisible(card.querySelector('[data-op="print"]'), false);
  if (finalFilesReady) setVisible(volumeList, false);

  if (labelTestOk) {
    note(documents, 'ok', '<strong>Produção concluída.</strong><span>O documento está liberado, o Data Matrix foi conferido e a etiqueta teste foi aprovada. Avance para a etapa 8 - Impressão para gerar os arquivos finais dos volumes.</span>');
  } else {
    note(documents, 'info', '<strong>Conclua a produção antes de imprimir.</strong><span>Nesta etapa ficam a liberação documental, a auditoria do Data Matrix e a etiqueta teste. Os PDFs finais dos volumes aparecem somente na etapa 8.</span>');
  }
}

function decorateStageEight(card) {
  card.classList.add('production-stage-8');
  const documents = card.querySelector('.production-documents');
  const volumeList = documents?.querySelector('.production-volume-list');
  const printButton = card.querySelector('[data-op="print"]');
  const labelTestOk = Boolean(gate(card, 'Etiqueta teste')?.classList.contains('ok') || printButton);

  setVisible(card.querySelector('[data-dce-preflight]'), false);
  setVisible(card.querySelector('[data-dce-client-access]'), false);
  setVisible(card.querySelector('[data-op="setup"]'), false);
  setVisible(card.querySelector('[data-op="matrix"]'), false);
  setVisible(card.querySelector('[data-op="test"]'), false);
  setVisible(documents?.querySelector('[data-generate-test]'), false);

  if (!labelTestOk) {
    setVisible(volumeList, false);
    setVisible(printButton, false);
    note(documents, 'warn', '<strong>Impressão ainda bloqueada.</strong><span>Retorne à etapa 7 - Produção e conclua a auditoria do Data Matrix e a aprovação da etiqueta teste.</span>');
    return;
  }

  setVisible(volumeList, true);
  setVisible(printButton, true);
  note(documents, 'info', '<strong>Arquivos finais de impressão.</strong><span>Gere cada bloco de impressão e registre as baixas de quantidade impressa. Quando o total estiver completo, avance para a etapa 9 - Entrega à operação.</span>');
}

function decorate() {
  if (!ROOT || !isProductionView()) return;
  const current = stage();
  ROOT.querySelectorAll('.page .card').forEach((card) => {
    if (!card.querySelector('[data-volumes]')) return;
    resetCard(card);
    if (current === 7) decorateStageSeven(card);
    if (current === 8) decorateStageEight(card);
  });
}

ROOT?.addEventListener('click', (event) => {
  if (event.target.closest('[data-operation-stage],[data-process-stage]')) {
    setTimeout(decorate, 0);
    setTimeout(decorate, 120);
  }
});

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorate();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-operation-stage'] });
decorate();
