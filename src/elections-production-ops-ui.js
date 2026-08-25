import './elections-production-ops-ui.css';
import { dataAction } from './api.js';
import { getPortalReturnAssets, updatePortalReturnLabelSetup } from './portal-assets.js';
import { auditPdfDocuments, loadPdfDocuments, verifyCrops } from './matrix-engine.js';
import { loadPostalVendors } from './postal-vendors.js';
import { configureLabelSetup } from './label-setup-ui.js';
import { isLabelSetupComplete } from './label-setup.js';

const ROOT = document.querySelector('#elections-app');

function h(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;'
  }[char]));
}

function campaignId() {
  return document.querySelector('#campaign-select')?.value || '';
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._opsTimer);
  box._opsTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}

function productionCards() {
  return [...(ROOT?.querySelectorAll('.page .card') || [])]
    .filter((card) => card.querySelector('[data-volumes]') && card.querySelector('h2'));
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function gateBox(label, ok, text) {
  return `<div class="production-gate ${ok ? 'ok' : 'warn'}"><span>${h(label)}</span><strong>${h(text)}</strong></div>`;
}

function labelsReady(gates) {
  return String(gates?.status || '') === 'READY_FOR_UNIFIED_LABEL';
}

function documentGateText(gates) {
  const mode = String(gates?.documentMode || '');
  const status = String(gates?.status || '');
  if (status === 'READY_FOR_UNIFIED_LABEL') {
    return mode === 'DCE_AUTHORIZED' ? 'DC-e autorizada e liberada' : 'Declaração Simplificada liberada';
  }
  if (mode !== 'DCE_AUTHORIZED') return 'Aguardando liberação documental';
  const labels = {
    AWAITING_DCE_PREPARATION: 'Aguardando validação fiscal da agência',
    DCE_PREPARED: 'Lote DC-e preparado; autorização do cliente pendente',
    DCE_RESERVED: 'Autorização fiscal iniciada',
    DCE_PARTIAL: 'Autorização fiscal parcial',
  };
  return labels[status] || 'DC-e ainda não liberada para produção';
}

function overallStatus(gates) {
  if (gates.handedOff) return ['ok', 'ENTREGUE À OPERAÇÃO'];
  if (gates.printComplete) return ['warn', 'IMPRESSÃO COMPLETA'];
  if (!labelsReady(gates)) return ['warn', 'AGUARDANDO DOCUMENTO'];
  return ['', 'EM PREPARAÇÃO'];
}

function gateMarkup(gates, setupReady) {
  const ready = labelsReady(gates);
  const [statusClass, statusLabel] = overallStatus(gates);
  const actions = [];
  if (!setupReady) actions.push('<button type="button" class="secondary" data-op="setup">Configurar Data Matrix e chancela</button>');
  if (ready && setupReady && !gates.matrixVerified) actions.push('<button type="button" class="secondary" data-op="matrix">Conferir 100% Data Matrix</button>');
  if (ready && setupReady && gates.matrixVerified && !gates.labelTestApproved) actions.push('<button type="button" class="secondary" data-op="test">Validar etiqueta teste</button>');
  if (ready && gates.labelTestApproved && !gates.printComplete) actions.push('<button type="button" class="secondary" data-op="print">Confirmar impressão</button>');

  const message = !ready
    ? 'As etapas de Data Matrix, etiqueta teste e impressão permanecem bloqueadas até o documento do lote estar liberado.'
    : gates.printComplete && !gates.handedOff
      ? 'Impressão integral concluída. Continue na etapa 9 - Entrega à operação para vincular e entregar os volumes.'
      : gates.handedOff
        ? 'Entrega à operação já registrada para este lote.'
        : '';

  return `<div class="production-ops-title"><strong>Gates de produção</strong><span class="status ${statusClass}">${statusLabel}</span></div>
    <div class="production-ops-grid">
      ${gateBox('Documento do lote', ready, documentGateText(gates))}
      ${gateBox('Modelo da etiqueta', setupReady, setupReady ? 'Data Matrix + chancela configurados' : 'Configuração pendente')}
      ${gateBox('Data Matrix 100%', gates.matrixVerified, gates.matrixVerified ? 'Confirmado' : ready ? 'Pendente' : 'Bloqueado até liberação documental')}
      ${gateBox('Etiqueta teste', gates.labelTestApproved, gates.labelTestApproved ? 'SRO validado' : ready ? `Pendente · ${gates.testTrackingCode || '—'}` : 'Bloqueada até liberação documental')}
      ${gateBox('Impressão', gates.printComplete, gates.printComplete ? `${gates.printed}/${gates.total}` : ready ? `${gates.printed}/${gates.total} · faltam ${gates.printRemaining}` : 'Bloqueada até liberação documental')}
      ${gateBox('Entrega à operação', gates.handedOff, gates.handedOff ? `Recebido por ${gates.receivedBy || 'confirmado'}` : gates.printComplete ? 'Disponível na etapa 9' : 'Pendente')}
    </div>
    <div class="production-ops-actions">${actions.join('')}</div>
    <div class="production-ops-message${message ? ' production-ops-progress' : ''}">${h(message)}</div>`;
}

async function batchInfo(batchId) {
  const rows = await dataAction('production.list', { campaignId: campaignId() });
  return rows.find((row) => String(row.ID || row.id) === String(batchId)) || null;
}

function portalReturnIdFromBatch(batch) {
  return String(batch?.PORTAL_RETURN_ID || batch?.portalReturnId || '');
}

function documentModeFromBatch(batch) {
  return String(batch?.DOCUMENT_MODE || batch?.documentMode || '');
}

function isAssociationMismatch(error) {
  const message = String(error?.message || error || '');
  return /Quantidade de objetos do lote diverge do total registrado|Nenhum objeto associado ao lote de producao/i.test(message);
}

async function gatesWithRecovery(batchId, batch) {
  try {
    return await dataAction('production.gates', {
      campaignId: campaignId(),
      productionBatchId: batchId,
    });
  } catch (error) {
    if (!isAssociationMismatch(error)) throw error;
    const portalReturnId = portalReturnIdFromBatch(batch);
    const documentMode = documentModeFromBatch(batch);
    if (!portalReturnId || !documentMode) throw error;

    await dataAction('production.prepare', {
      campaignId: campaignId(),
      portalReturnId,
      documentMode,
    });

    return dataAction('production.gates', {
      campaignId: campaignId(),
      productionBatchId: batchId,
    });
  }
}

async function loadGates(card, batchId) {
  const slot = card.querySelector('.production-ops-gates');
  try {
    const batch = await batchInfo(batchId);
    if (!batch) throw new Error('Lote de produção não localizado.');
    const gates = await gatesWithRecovery(batchId, batch);
    const portalReturnId = portalReturnIdFromBatch(batch);
    const assets = portalReturnId ? await getPortalReturnAssets(portalReturnId) : null;
    const setupReady = isLabelSetupComplete(assets?.labelSetup);
    slot.innerHTML = gateMarkup(gates, setupReady);
    slot.querySelectorAll('[data-op]').forEach((button) => {
      button.onclick = () => runAction(card, batchId, button.dataset.op, gates);
    });
  } catch (error) {
    slot.innerHTML = `<div class="production-ops-error">${h(error.message)}</div>`;
  }
}

async function configureBatchLabel(batchId) {
  const batch = await batchInfo(batchId);
  if (!batch) throw new Error('Lote de produção não localizado.');
  const portalReturnId = portalReturnIdFromBatch(batch);
  if (!portalReturnId) throw new Error('O lote não possui retorno do Portal associado.');
  const assets = await getPortalReturnAssets(portalReturnId);
  if (!assets?.pdfFiles?.length) {
    throw new Error('Os PDFs originais deste retorno não estão disponíveis neste navegador. Reimporte o retorno do Portal neste computador para configurar a etiqueta.');
  }
  const configured = await configureLabelSetup({
    pdfFiles: assets.pdfFiles,
    initialSetup: assets.labelSetup,
  });
  if (!configured) return false;
  await updatePortalReturnLabelSetup(portalReturnId, configured);
  notify('Área do Data Matrix e chancela salvas para este retorno.', 'success');
  return true;
}

async function verifyMatrix(card, batchId) {
  const message = card.querySelector('.production-ops-message');
  message.className = 'production-ops-message production-ops-progress';
  message.textContent = 'Recuperando PDFs originais do Portal e verificando os Data Matrix...';

  const batch = await batchInfo(batchId);
  if (!batch) throw new Error('Lote de produção não localizado.');
  const portalReturnId = portalReturnIdFromBatch(batch);
  if (!portalReturnId) throw new Error('O lote não possui retorno do Portal associado.');
  const assets = await getPortalReturnAssets(portalReturnId);
  if (!assets?.pdfFiles?.length) {
    throw new Error('Os PDFs originais deste retorno não estão disponíveis no cache local deste navegador. Reimporte o retorno do Portal neste computador antes de produzir.');
  }
  if (!isLabelSetupComplete(assets.labelSetup)) {
    throw new Error('Configure primeiro a área do Data Matrix e a chancela da etiqueta.');
  }

  const { pdfjsLib, ZXing } = await loadPostalVendors();
  const documents = await loadPdfDocuments(assets.pdfFiles, pdfjsLib);
  const audit = await auditPdfDocuments(documents, ZXing, {
    region: assets.labelSetup.matrixRegion,
    onProgress: (progress) => {
      message.textContent = `Verificando Data Matrix: ${progress.processed || 0} de ${progress.totalPages || 0} páginas...`;
    },
  });
  const verified = await verifyCrops(audit.crops, ZXing);
  const ok = verified.filter((row) => row.ok).map((row) => row.object);
  if (ok.length !== verified.length) {
    throw new Error(`${verified.length - ok.length} Data Matrix não puderam ser confirmados na releitura local.`);
  }

  await dataAction('production.matrix.confirm', {
    campaignId: campaignId(),
    productionBatchId: batchId,
    verifiedTrackingCodes: ok,
  });
  notify('100% dos Data Matrix foram confirmados para o lote.', 'success');
}

async function approveTest(batchId) {
  const data = await dataAction('production.labelTest.data', {
    campaignId: campaignId(),
    productionBatchId: batchId,
  });
  const read = window.prompt(
    `Etiqueta teste do lote\nSRO esperado: ${data.trackingCode}\n\nDigite ou leia com o scanner o SRO impresso fisicamente:`,
    ''
  );
  if (read == null) return;
  await dataAction('production.labelTest.approve', {
    campaignId: campaignId(),
    productionBatchId: batchId,
    readTrackingCode: read,
  });
  notify('Etiqueta teste aprovada pelo SRO lido fisicamente.', 'success');
}

async function confirmPrint(batchId, gates) {
  const raw = window.prompt(
    `Quantas etiquetas foram impressas nesta baixa?\nSaldo atual: ${gates.printRemaining}`,
    String(gates.printRemaining || '')
  );
  if (raw == null) return;
  const quantity = Number(String(raw).replace(/\D/g, ''));
  if (!quantity) return;
  await dataAction('production.print.confirm', {
    campaignId: campaignId(),
    productionBatchId: batchId,
    quantity,
    confirmationId: uuid(),
  });
  notify(`${quantity.toLocaleString('pt-BR')} etiquetas registradas como impressas.`, 'success');
}

async function runAction(card, batchId, action, gates) {
  const buttons = [...card.querySelectorAll('.production-ops-actions button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (action === 'setup') await configureBatchLabel(batchId);
    if (action === 'matrix') await verifyMatrix(card, batchId);
    if (action === 'test') await approveTest(batchId);
    if (action === 'print') await confirmPrint(batchId, gates);
    await loadGates(card, batchId);
  } catch (error) {
    const message = card.querySelector('.production-ops-message');
    if (message) {
      message.className = 'production-ops-message production-ops-error';
      message.textContent = error.message;
    }
    notify(error.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function mount() {
  productionCards().forEach((card) => {
    const volumeButton = card.querySelector('[data-volumes]');
    const batchId = volumeButton?.dataset.volumes;
    if (!batchId || card.querySelector('.production-ops-gates')) return;
    const slot = document.createElement('div');
    slot.className = 'production-ops-gates';
    slot.innerHTML = '<div class="production-ops-progress">Carregando gates operacionais...</div>';
    card.appendChild(slot);
    loadGates(card, batchId);
  });
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
