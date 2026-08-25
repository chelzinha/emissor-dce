import './elections-production-documents-ui.css';
import { dataAction } from './api.js';
import { getPortalReturnAssets } from './portal-assets.js';
import { isLabelSetupComplete } from './label-setup.js';

const ROOT = document.querySelector('#elections-app');
let generatorPromise;

function loadGenerator() {
  generatorPromise ||= import('./production-label-generator.js');
  return generatorPromise;
}

function h(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function campaignId() {
  return document.querySelector('#campaign-select')?.value || '';
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._docsTimer);
  box._docsTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}

function productionCards() {
  return [...(ROOT?.querySelectorAll('.page .card') || [])]
    .filter((card) => card.querySelector('[data-volumes]') && card.querySelector('h2'));
}

function setStatus(slot, message, type = '') {
  slot.className = `production-documents-status ${type}`;
  slot.textContent = message;
}

function batchPortalReturnId(batch) {
  return String(batch?.PORTAL_RETURN_ID || batch?.portalReturnId || '');
}

function batchDocumentMode(batch) {
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
    const portalReturnId = batchPortalReturnId(batch);
    const documentMode = batchDocumentMode(batch);
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

function senderFromCampaign(campaign) {
  const profile = campaign?.profile || {};
  const sender = profile.sender || profile.issuer || {};
  const address = sender.address || profile.address || {};
  return {
    name: String(sender.name || profile.senderName || profile.name || campaign?.name || ''),
    document: digits(sender.document || sender.cnpj || profile.cnpj || campaign?.cnpj || ''),
    address: {
      street: String(address.street || ''),
      number: String(address.number || ''),
      complement: String(address.complement || ''),
      district: String(address.district || ''),
      city: String(address.city || ''),
      uf: String(address.uf || '').toUpperCase(),
      zip: digits(address.zip || ''),
    },
  };
}

function senderReady(sender) {
  const documentOk = [11, 14].includes(digits(sender?.document).length);
  const zipOk = digits(sender?.address?.zip).length === 8;
  return Boolean(
    sender?.name && documentOk && zipOk &&
    sender?.address?.street && sender?.address?.number &&
    sender?.address?.city && String(sender?.address?.uf || '').length === 2
  );
}

function senderFormMarkup(campaign) {
  const sender = senderFromCampaign(campaign);
  return `<form class="production-sender-form" data-sender-form style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;width:100%;margin-top:10px">
    <label class="field"><span>Nome do remetente</span><input name="name" value="${h(sender.name)}" required></label>
    <label class="field"><span>CPF/CNPJ</span><input name="document" value="${h(sender.document)}" inputmode="numeric" required></label>
    <label class="field"><span>CEP</span><input name="zip" value="${h(sender.address.zip)}" inputmode="numeric" required></label>
    <label class="field"><span>Endereço</span><input name="street" value="${h(sender.address.street)}" required></label>
    <label class="field"><span>Número</span><input name="number" value="${h(sender.address.number)}" required></label>
    <label class="field"><span>Complemento</span><input name="complement" value="${h(sender.address.complement)}"></label>
    <label class="field"><span>Bairro</span><input name="district" value="${h(sender.address.district)}"></label>
    <label class="field"><span>Cidade</span><input name="city" value="${h(sender.address.city)}" required></label>
    <label class="field"><span>UF</span><input name="uf" value="${h(sender.address.uf)}" maxlength="2" required></label>
    <div style="grid-column:1/-1;display:flex;gap:7px;flex-wrap:wrap">
      <button type="submit" class="primary">Salvar remetente</button>
      <button type="button" class="ghost" data-cancel-sender>Cancelar</button>
    </div>
  </form>`;
}

async function saveSender(card, batchId, campaign, form) {
  const values = Object.fromEntries(new FormData(form));
  const sender = {
    name: String(values.name || '').trim(),
    document: digits(values.document),
    address: {
      zip: digits(values.zip),
      street: String(values.street || '').trim(),
      number: String(values.number || '').trim(),
      complement: String(values.complement || '').trim(),
      district: String(values.district || '').trim(),
      city: String(values.city || '').trim(),
      uf: String(values.uf || '').trim().toUpperCase(),
    },
  };
  if (!senderReady(sender)) {
    throw new Error('Preencha nome, CPF/CNPJ, CEP, endereço, número, cidade e UF do remetente.');
  }

  const profile = {
    ...(campaign.profile || {}),
    sender: {
      ...((campaign.profile || {}).sender || {}),
      ...sender,
      address: {
        ...(((campaign.profile || {}).sender || {}).address || {}),
        ...sender.address,
      },
    },
  };

  await dataAction('campaign.upsert', {
    id: campaign.id,
    name: campaign.name,
    cnpj: campaign.cnpj,
    candidateName: campaign.candidateName,
    office: campaign.office,
    status: campaign.status,
    profile,
  });

  notify('Dados do remetente salvos. A etiqueta unificada já pode usar essas informações.', 'success');
  await loadControls(card, batchId);
}

function showSenderForm(card, batchId, campaign) {
  const host = card.querySelector('.production-documents');
  const actions = host.querySelector('.production-documents-actions');
  const list = host.querySelector('.production-volume-list');
  const status = host.querySelector('.production-documents-status');
  actions.innerHTML = '';
  list.innerHTML = senderFormMarkup(campaign);
  setStatus(status, 'Esses dados entram na parte de remetente da etiqueta unificada e da declaração simplificada.', 'busy');
  const form = list.querySelector('[data-sender-form]');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await saveSender(card, batchId, campaign, form);
    } catch (error) {
      setStatus(status, error.message, 'error');
      notify(error.message, 'error');
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
  list.querySelector('[data-cancel-sender]').onclick = () => loadControls(card, batchId);
}

async function loadControls(card, batchId) {
  const host = card.querySelector('.production-documents');
  const status = host.querySelector('.production-documents-status');
  const actions = host.querySelector('.production-documents-actions');
  const list = host.querySelector('.production-volume-list');

  try {
    setStatus(status, 'Conferindo o lote e os documentos disponíveis...', 'busy');
    const batches = await dataAction('production.list', { campaignId: campaignId() });
    const batch = batches.find((row) => String(row.ID || row.id) === String(batchId));
    if (!batch) throw new Error('Lote de produção não localizado.');

    const [gates, volumes, campaign] = await Promise.all([
      gatesWithRecovery(batchId, batch),
      dataAction('volumes.list', { campaignId: campaignId(), productionBatchId: batchId }),
      dataAction('campaign.get', { campaignId: campaignId() }),
    ]);

    const portalReturnId = batchPortalReturnId(batch);
    const assets = portalReturnId ? await getPortalReturnAssets(portalReturnId) : null;
    const setupReady = isLabelSetupComplete(assets?.labelSetup);
    const sender = senderFromCampaign(campaign);
    const senderConfigured = senderReady(sender);
    const mode = batchDocumentMode(batch);
    const modeLabel = mode === 'DCE_AUTHORIZED'
      ? 'Etiqueta unificada + DACE autorizada'
      : 'Etiqueta unificada + Declaração Simplificada';

    host.querySelector('.production-documents-head').innerHTML = `<div><strong>${h(modeLabel)}</strong><small>Cada página do PDF é a etiqueta final 10 × 15 cm, com a etiqueta postal, o Data Matrix original, a chancela e o documento de conteúdo na mesma página.</small></div>`;
    actions.innerHTML = '';
    list.innerHTML = '';

    if (!setupReady) {
      setStatus(status, 'Configure primeiro a área do Data Matrix e a chancela no gate “Modelo da etiqueta” acima.');
      return;
    }

    if (!senderConfigured) {
      actions.innerHTML = '<button type="button" class="primary" data-configure-sender>Configurar remetente da etiqueta</button>';
      actions.querySelector('[data-configure-sender]').onclick = () => showSenderForm(card, batchId, campaign);
      setStatus(status, 'Faltam os dados do remetente. Eles são obrigatórios para montar a etiqueta unificada com a Declaração Simplificada.', 'error');
      return;
    }

    if (!gates.matrixVerified) {
      setStatus(status, 'Primeiro confirme 100% dos Data Matrix no gate acima.');
      return;
    }

    if (!gates.labelTestApproved) {
      actions.innerHTML = '<button type="button" class="primary" data-generate-test>Gerar etiqueta unificada teste</button>';
      actions.querySelector('[data-generate-test]').onclick = () => generateTest(card, batchId);
      setStatus(status, `Etiqueta teste prevista para o SRO ${gates.testTrackingCode || '—'}. Gere o PDF, imprima somente essa página e valide o SRO no gate acima.`);
      return;
    }

    if (!volumes.length) {
      setStatus(status, 'Nenhum volume físico planejado para este lote.', 'error');
      return;
    }

    list.innerHTML = volumes.map((volume) => `<div class="production-volume-item">
      <div><span>Volume ${Number(volume.number).toLocaleString('pt-BR')}/${Number(volume.totalVolumes).toLocaleString('pt-BR')} · ${h(volume.service)}</span><strong>${Number(volume.quantity).toLocaleString('pt-BR')} etiquetas unificadas</strong></div>
      <button type="button" class="secondary" data-generate-volume="${h(volume.id)}">Gerar PDF unificado</button>
    </div>`).join('');

    list.querySelectorAll('[data-generate-volume]').forEach((button) => {
      button.onclick = () => generateVolume(card, batchId, button.dataset.generateVolume);
    });

    setStatus(
      status,
      gates.printComplete
        ? 'Impressão integral já confirmada para este lote.'
        : 'Gere os PDFs unificados dos volumes. A confirmação da impressão continua separada no gate operacional.'
    );
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

async function generateTest(card, batchId) {
  const host = card.querySelector('.production-documents');
  const status = host.querySelector('.production-documents-status');
  const buttons = [...host.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const { generateProductionTestPdf } = await loadGenerator();
    await generateProductionTestPdf(campaignId(), batchId, (message) => setStatus(status, message, 'busy'));
    setStatus(status, 'Etiqueta unificada teste gerada com a chancela configurada. Imprima somente esta página e valide o SRO no leitor físico antes de liberar os volumes.', 'ok');
    notify('PDF da etiqueta unificada teste gerado.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
    notify(error.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function generateVolume(card, batchId, volumeId) {
  const host = card.querySelector('.production-documents');
  const status = host.querySelector('.production-documents-status');
  const buttons = [...host.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const { generateProductionVolumePdf } = await loadGenerator();
    const data = await generateProductionVolumePdf(
      campaignId(),
      batchId,
      volumeId,
      (message) => setStatus(status, message, 'busy')
    );
    await dataAction('operation.record', {
      campaignId: campaignId(),
      type: 'LABEL_GENERATED',
      quantity: Number(data.volume.quantity || 0),
      service: String(data.volume.service || ''),
      sourceType: 'DELIVERY_VOLUME',
      sourceId: String(data.volume.id || volumeId),
      idempotencyKey: `label-generated-volume:${String(data.volume.id || volumeId)}`,
      metadata: {
        productionBatchId: batchId,
        volumeNumber: Number(data.volume.number || 0),
        totalVolumes: Number(data.volume.totalVolumes || 0),
        origin: 'FINAL_VOLUME_PDF',
      },
    });
    setStatus(status, `PDF unificado do volume ${data.volume.number}/${data.volume.totalVolumes} gerado com ${data.volume.quantity} etiquetas. A impressão ainda precisa ser confirmada no gate operacional.`, 'ok');
    notify('PDF unificado gerado e baixa de etiquetas geradas registrada.', 'success');
  } catch (error) {
    setStatus(status, error.message, 'error');
    notify(error.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function mount() {
  productionCards().forEach((card) => {
    const button = card.querySelector('[data-volumes]');
    const batchId = button?.dataset.volumes;
    if (!batchId || card.querySelector('.production-documents')) return;
    const host = document.createElement('div');
    host.className = 'production-documents';
    host.innerHTML = '<div class="production-documents-head"><div><strong>Documentos de produção</strong><small>Carregando disponibilidade...</small></div></div><div class="production-documents-actions"></div><div class="production-volume-list"></div><div class="production-documents-status"></div>';
    card.appendChild(host);
    loadControls(card, batchId);
  });
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
