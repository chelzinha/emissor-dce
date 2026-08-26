import { dataAction } from './api.js';
import { getPortalReturnAssets } from './portal-assets.js';
import { auditPdfDocuments, loadPdfDocuments } from './matrix-engine.js';
import { loadPostalVendors } from './postal-vendors.js';
import { isLabelSetupComplete } from './label-setup.js';

const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';
const RESUME_KEY = 'AGF_OPERATIONS_RESUME_V1';
const confirmedBatches = new Set();
const runningBatches = new Set();

function campaignId() {
  return document.querySelector('#campaign-select')?.value || '';
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function batchIdFromCard(card) {
  return String(card?.querySelector('[data-volumes]')?.dataset.volumes || '');
}

function batchStatus(batch) {
  return String(batch?.STATUS || batch?.status || '').toUpperCase();
}

function batchTotal(batch) {
  return Number(batch?.TOTAL || batch?.total || 0);
}

function batchPortalReturnId(batch) {
  return String(batch?.PORTAL_RETURN_ID || batch?.portalReturnId || '');
}

function matrixSummary(batch) {
  return parseJson(batch?.MATRIX_SUMMARY_JSON || batch?.matrixSummary || {}, {});
}

function completeImportedAudit(batch) {
  const total = batchTotal(batch);
  const summary = matrixSummary(batch);
  const matched = Number(summary.matched || 0) || [
    summary.autoVerified,
    summary.verified,
    summary.textOnly,
    summary.manualReview,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  return Boolean(
    total > 0 &&
    matched === total &&
    Number(summary.missing || 0) === 0 &&
    Number(summary.divergent || 0) === 0
  );
}

function preserveProductionView() {
  const selectedCampaignId = campaignId();
  try {
    sessionStorage.setItem(STAGE_KEY, '7');
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      view: 'production',
      campaignId: selectedCampaignId,
      savedAt: Date.now(),
    }));
  } catch {}
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._matrixInheritanceTimer);
  box._matrixInheritanceTimer = setTimeout(() => {
    box.className = 'elections-toast';
  }, 5200);
}

function setMessage(card, message, type = 'progress') {
  const slot = card?.querySelector('.production-ops-message');
  if (!slot) return;
  slot.className = type === 'error'
    ? 'production-ops-message production-ops-error'
    : 'production-ops-message production-ops-progress';
  slot.textContent = message;
}

async function productionBatch(batchId) {
  const rows = await dataAction('production.list', { campaignId: campaignId() });
  return rows.find((row) => String(row.ID || row.id) === String(batchId)) || null;
}

function refreshGates(card) {
  const slot = card?.querySelector('.production-ops-gates');
  slot?.remove();
  card?.querySelector('.production-documents')?.remove();
}

async function inheritImportedAudit(card, batch) {
  const batchId = String(batch?.ID || batch?.id || '');
  if (!batchId || confirmedBatches.has(batchId)) return confirmedBatches.has(batchId);
  if (batchStatus(batch) !== 'READY_FOR_UNIFIED_LABEL' || !completeImportedAudit(batch)) return false;

  const total = batchTotal(batch);
  const summary = matrixSummary(batch);
  setMessage(card, 'Reconhecendo a auditoria já concluída na etapa 5...');
  preserveProductionView();

  await dataAction('operation.record', {
    campaignId: campaignId(),
    type: 'MATRIX_100_VERIFIED',
    quantity: total,
    sourceType: 'PRODUCTION_BATCH',
    sourceId: batchId,
    idempotencyKey: `matrix-100:${batchId}`,
    metadata: {
      verifiedBy: 'PORTAL_RETURN_AUDIT',
      portalReturnId: batchPortalReturnId(batch),
      matrix: summary,
    },
  });

  confirmedBatches.add(batchId);
  notify('A auditoria da etapa 5 foi reconhecida. Não é necessário ler os 500 PDFs novamente.', 'success');
  refreshGates(card);
  return true;
}

async function verifyMatrixSafely(card, batch) {
  const batchId = String(batch?.ID || batch?.id || '');
  const portalReturnId = batchPortalReturnId(batch);
  if (!portalReturnId) throw new Error('O lote não possui retorno do Portal associado.');

  const assets = await getPortalReturnAssets(portalReturnId);
  if (!assets?.pdfFiles?.length) {
    throw new Error('Os PDFs originais não estão disponíveis neste navegador. Reabra o retorno no computador que fez a importação.');
  }
  if (!isLabelSetupComplete(assets.labelSetup)) {
    throw new Error('Configure primeiro a área do Data Matrix e a chancela da etiqueta.');
  }

  preserveProductionView();
  const { pdfjsLib, ZXing } = await loadPostalVendors();
  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);
  let audit;
  try {
    audit = await auditPdfDocuments(documents, ZXing, {
      region: assets.labelSetup.matrixRegion,
      keepCrops: false,
      onProgress: (progress) => {
        setMessage(card, `Verificando Data Matrix: ${progress.processed || 0} de ${progress.totalPages || 0} páginas...`);
      },
    });
  } finally {
    for (const item of documents) {
      try { await item.doc.destroy?.(); } catch {}
    }
  }

  const expected = batchTotal(batch);
  const validRows = audit.audit.filter((row) => {
    const object = String(row.object || '').toUpperCase();
    const payload = String(row.payload || '').toUpperCase();
    return row.origin === 'codigo' && object && payload.includes(object);
  });
  const verifiedTrackingCodes = [...new Set(validRows.map((row) => String(row.object).toUpperCase()))];

  if (audit.totalPages !== expected) {
    throw new Error(`Os PDFs possuem ${audit.totalPages} páginas, mas o lote possui ${expected} objetos.`);
  }
  if (audit.diagnostics.divergent.length || audit.diagnostics.duplicates.length) {
    throw new Error('A releitura encontrou Data Matrix divergente ou SRO duplicado. Revise os PDFs antes de continuar.');
  }
  if (verifiedTrackingCodes.length !== expected) {
    throw new Error(`${expected - verifiedTrackingCodes.length} Data Matrix não puderam ser confirmados diretamente no código.`);
  }

  await dataAction('production.matrix.confirm', {
    campaignId: campaignId(),
    productionBatchId: batchId,
    verifiedTrackingCodes,
  });

  confirmedBatches.add(batchId);
  notify('100% dos Data Matrix foram confirmados sem recarregar a página.', 'success');
  refreshGates(card);
}

async function handleMatrixAction(card, button) {
  const batchId = batchIdFromCard(card);
  if (!batchId || runningBatches.has(batchId)) return;
  runningBatches.add(batchId);
  button.disabled = true;
  preserveProductionView();
  try {
    const batch = await productionBatch(batchId);
    if (!batch) throw new Error('Lote de produção não localizado.');
    const inherited = await inheritImportedAudit(card, batch);
    if (!inherited) await verifyMatrixSafely(card, batch);
  } catch (error) {
    setMessage(card, error.message, 'error');
    notify(error.message, 'error');
  } finally {
    runningBatches.delete(batchId);
    button.disabled = false;
  }
}

ROOT?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-op="matrix"]');
  if (!button) return;
  const card = button.closest('.card');
  if (!card) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  handleMatrixAction(card, button);
}, true);

async function healVisibleBatches() {
  const cards = [...(ROOT?.querySelectorAll('.page .card') || [])]
    .filter((card) => card.querySelector('[data-volumes]') && card.querySelector('[data-op="matrix"]'));

  for (const card of cards) {
    const batchId = batchIdFromCard(card);
    if (!batchId || runningBatches.has(batchId) || confirmedBatches.has(batchId)) continue;
    runningBatches.add(batchId);
    try {
      const batch = await productionBatch(batchId);
      if (batch) await inheritImportedAudit(card, batch);
    } catch {
      // A ação manual continua disponível caso a recuperação automática falhe.
    } finally {
      runningBatches.delete(batchId);
    }
  }
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    healVisibleBatches();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
healVisibleBatches();
