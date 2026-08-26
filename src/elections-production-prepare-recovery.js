import { dataAction } from './api.js';

const RESUME_KEY = 'AGF_OPERATIONS_RESUME_V1';
const BUTTON_SELECTOR = '[data-return][data-mode]';
let running = false;

function value(row, upper, camel) {
  return row?.[upper] ?? row?.[camel] ?? '';
}

export function findProductionForReturn(rows, portalReturnId, documentMode = '') {
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const sameReturn = String(value(row, 'PORTAL_RETURN_ID', 'portalReturnId')) === String(portalReturnId || '');
    const mode = String(value(row, 'DOCUMENT_MODE', 'documentMode'));
    return sameReturn && (!documentMode || !mode || mode === String(documentMode));
  }) || null;
}

export function isPartialAssociationError(error) {
  return /Quantidade de objetos do lote diverge do total registrado|Nenhum objeto associado ao lote de producao/i
    .test(String(error?.message || error || ''));
}

function campaignId() {
  return document.querySelector('#campaign-select')?.value || '';
}

function productionId(batch) {
  return String(value(batch, 'ID', 'id'));
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._productionRecoveryTimer);
  box._productionRecoveryTimer = setTimeout(() => { box.className = 'elections-toast'; }, 7000);
}

function busy(message) {
  document.querySelector('#production-prepare-recovery-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'production-prepare-recovery-overlay';
  overlay.className = 'busy-overlay';
  overlay.innerHTML = `<div class="busy-card"><div class="spinner"></div><strong>${message}</strong><small style="display:block;margin-top:7px;color:#607085">Aguarde a conferência do lote antes de repetir a ação.</small></div>`;
  document.body.appendChild(overlay);
  return (nextMessage = '') => {
    if (nextMessage) {
      const strong = overlay.querySelector('strong');
      if (strong) strong.textContent = nextMessage;
      return;
    }
    overlay.remove();
  };
}

function resumeInProduction(cid) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      view: 'production',
      campaignId: cid,
      savedAt: Date.now(),
    }));
  } catch {}
  location.reload();
}

async function verifyBatch(cid, batch) {
  const batchId = productionId(batch);
  if (!batchId) return false;
  await dataAction('production.gates', {
    campaignId: cid,
    productionBatchId: batchId,
  });
  return true;
}

async function recoverExistingBatch(cid, portalReturnId, documentMode, progress) {
  progress('Conferindo se o lote foi criado');
  const batches = await dataAction('production.list', { campaignId: cid });
  const batch = findProductionForReturn(batches, portalReturnId, documentMode);
  if (!batch) return null;

  try {
    if (await verifyBatch(cid, batch)) return batch;
  } catch (gateError) {
    if (!isPartialAssociationError(gateError)) throw gateError;

    progress('Reparando associações do lote');
    await dataAction('production.prepare', {
      campaignId: cid,
      portalReturnId,
      documentMode,
    });
    await verifyBatch(cid, batch);
    return batch;
  }
  return null;
}

async function prepareWithRecovery(button) {
  const cid = campaignId();
  const portalReturnId = button.dataset.return || '';
  const documentMode = button.dataset.mode || '';
  if (!cid || !portalReturnId || !documentMode) {
    notify('Não foi possível identificar a campanha, o retorno ou o documento escolhido.', 'error');
    return;
  }

  running = true;
  button.disabled = true;
  const progress = busy('Preparando lote de produção…');
  try {
    let result;
    try {
      result = await dataAction('production.prepare', {
        campaignId: cid,
        portalReturnId,
        documentMode,
      });
      const batch = { ...result, id: result?.id, portalReturnId, documentMode };
      progress('Conferindo o lote criado');
      await verifyBatch(cid, batch);
    } catch (firstError) {
      try {
        result = await recoverExistingBatch(cid, portalReturnId, documentMode, progress);
      } catch (recoveryError) {
        if (isPartialAssociationError(recoveryError)) {
          throw new Error('O lote foi criado parcialmente, mas alguns objetos ainda não foram associados aos volumes. Não repita a geração. A operação precisa ser reconciliada antes da impressão.');
        }
        throw recoveryError;
      }
      if (!result) throw firstError;
    }

    notify('Lote conferido. Abrindo a etapa de Produção.', 'success');
    progress('Lote conferido. Abrindo Produção…');
    setTimeout(() => resumeInProduction(cid), 450);
  } catch (error) {
    progress();
    button.disabled = false;
    notify(error.message || 'Não foi possível preparar o lote de produção.', 'error');
  } finally {
    running = false;
  }
}

function intercept(event) {
  const button = event.target.closest?.(BUTTON_SELECTOR);
  if (!button || button.disabled || running) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  prepareWithRecovery(button);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', intercept, { capture: true });
}
