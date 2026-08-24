import './elections-internal-delivery-ui.css';
import { dataAction } from './api.js';
import { generateInternalDeliveryManifest, generateInternalDeliveryVolumeLabels } from './internal-delivery-generator.js';

const ROOT = document.querySelector('#elections-app');
let renderToken = 0;

function h(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function fmt(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function cid() { return document.querySelector('#campaign-select')?.value || ''; }
function today() { return new Date().toISOString().slice(0, 10); }
function short(value) { return String(value || '').slice(0, 8); }
function uuid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._internalDeliveryTimer);
  box._internalDeliveryTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}
function isStageEight() { return String(ROOT?.dataset.operationStage || sessionStorage.getItem('AGF_OPERATION_STAGE_1_8') || '') === '8'; }
function modeLabel(value) { return String(value || '') === 'DCE_AUTHORIZED' ? 'DC-e autorizada' : 'Declaração Simplificada'; }

async function saveProfile(campaign, profile) {
  return dataAction('campaign.upsert', {
    id: campaign.id, name: campaign.name, cnpj: campaign.cnpj, candidateName: campaign.candidateName,
    office: campaign.office, status: campaign.status, profile,
  });
}

function plans(campaign) { return Array.isArray(campaign?.profile?.internalDeliveries) ? campaign.profile.internalDeliveries : []; }
function latestPlanned(campaign) { return [...plans(campaign)].reverse().find((item) => item?.status === 'PLANNED') || null; }

function selectorMarkup(rows) {
  if (!rows.length) return '<div class="internal-delivery-empty">Nenhum lote está pronto para a entrega à operação. Conclua a etiqueta teste e a impressão integral primeiro.</div>';
  return `<div class="internal-delivery-selector">
    <div class="internal-delivery-lots">${rows.map(({ batch, gates }) => `<label class="internal-delivery-lot">
      <input type="checkbox" value="${h(batch.ID || batch.id)}" data-delivery-batch>
      <div><strong>Lote ${h(short(batch.ID || batch.id))}</strong><span>${h(modeLabel(batch.DOCUMENT_MODE || batch.documentMode))}</span></div>
      <div class="internal-delivery-lot-metrics"><span>${fmt(batch.TOTAL)} objetos</span><span>PAC ${fmt(batch.PAC)}</span><span>SEDEX ${fmt(batch.SEDEX)}</span></div>
      <span class="internal-delivery-ready">Impressão ${fmt(gates.printed)}/${fmt(gates.total)}</span>
    </label>`).join('')}</div>
    <div class="internal-delivery-create"><label class="field"><span>Data da entrega interna</span><input id="internal-delivery-date" type="date" value="${today()}" required></label><button class="primary" id="link-internal-delivery" type="button">Vincular lotes e numerar volumes</button></div>
    <p class="internal-delivery-help">As etiquetas de controle dos volumes só serão liberadas depois desta vinculação. A numeração será única para a entrega selecionada, por exemplo 1/4, 2/4, 3/4 e 4/4.</p>
  </div>`;
}

function planMarkup(plan) {
  return `<div class="internal-delivery-plan" data-plan-id="${h(plan.id)}">
    <div class="internal-delivery-plan-head"><div><span>Entrega vinculada</span><strong>${h(new Date(`${plan.date}T12:00:00`).toLocaleDateString('pt-BR'))}</strong><small>${fmt(plan.batchIds.length)} lote(s) · ${fmt(plan.totalObjects)} objetos · ${fmt(plan.totalVolumes)} volumes</small></div><span class="status ok">Planejada</span></div>
    <div class="internal-delivery-volume-preview">${plan.volumes.map((volume) => `<div><b>${volume.sequence}/${plan.totalVolumes}</b><span>${h(volume.service)}</span><strong>${fmt(volume.quantity)}</strong><small>${h(volume.firstTracking || '—')} → ${h(volume.lastTracking || '—')}</small><em>Lote ${h(short(volume.batchId))}</em></div>`).join('')}</div>
    <div class="internal-delivery-downloads"><button type="button" class="secondary" data-download-volume-labels>Baixar etiquetas dos volumes</button><button type="button" class="secondary" data-download-manifest>Baixar controle da entrega</button><button type="button" class="ghost" data-unlink-delivery>Desfazer vínculo</button></div>
    <div class="internal-delivery-confirm"><div><strong>Confirmar entrega física</strong><span>Registre somente quando os volumes selecionados forem efetivamente entregues à operação.</span></div><div class="internal-delivery-confirm-grid"><label class="field"><span>Recebido por</span><input id="internal-delivery-received" placeholder="Nome de quem recebeu"></label><label class="field"><span>Responsável pela entrega</span><input id="internal-delivery-delivered" placeholder="Opcional"></label><button type="button" class="primary" data-confirm-internal-delivery>Confirmar entrega à operação</button></div></div>
  </div>`;
}

function historyMarkup(campaign) {
  const confirmed = plans(campaign).filter((item) => item?.status === 'CONFIRMED').slice(-5).reverse();
  if (!confirmed.length) return '';
  return `<details class="internal-delivery-history"><summary>Entregas anteriores (${confirmed.length})</summary>${confirmed.map((plan) => `<div><span>${h(plan.date)}</span><strong>${fmt(plan.totalVolumes)} volumes</strong><span>${fmt(plan.totalObjects)} objetos</span><small>Recebido por ${h(plan.receivedBy || '—')}</small></div>`).join('')}</details>`;
}

async function eligibleBatches(batches) {
  const rows = await Promise.all((batches || []).map(async (batch) => {
    try {
      const batchId = String(batch.ID || batch.id || '');
      const gates = await dataAction('production.gates', { campaignId: cid(), productionBatchId: batchId });
      return { batch, gates };
    } catch { return null; }
  }));
  return rows.filter((row) => row && row.gates?.labelTestApproved && row.gates?.printComplete && !row.gates?.handedOff);
}

async function buildPlan(batchIds, date) {
  const volumesByBatch = await Promise.all(batchIds.map(async (batchId) => ({
    batchId,
    volumes: await dataAction('volumes.list', { campaignId: cid(), productionBatchId: batchId }),
  })));
  const draft = [];
  volumesByBatch.forEach(({ batchId, volumes }) => {
    volumes.forEach((volume) => {
      const codes = Array.isArray(volume.trackingCodes) ? volume.trackingCodes : [];
      draft.push({
        batchId, volumeId: String(volume.id || ''), service: String(volume.service || ''),
        quantity: Number(volume.quantity || codes.length || 0), firstTracking: String(codes[0] || ''),
        lastTracking: String(codes[codes.length - 1] || ''),
      });
    });
  });
  if (!draft.length) throw new Error('Os lotes selecionados não possuem blocos de impressão para formar a entrega.');
  const totalVolumes = draft.length;
  const volumes = draft.map((volume, index) => ({ ...volume, sequence: index + 1, totalVolumes }));
  return {
    id: uuid(), date, status: 'PLANNED', batchIds, totalVolumes,
    totalObjects: volumes.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    volumes, createdAt: new Date().toISOString(),
  };
}

async function linkPlan(panel, campaign) {
  const ids = [...panel.querySelectorAll('[data-delivery-batch]:checked')].map((input) => input.value);
  const date = panel.querySelector('#internal-delivery-date')?.value || '';
  if (!ids.length) return notify('Selecione pelo menos um lote para esta entrega.', 'error');
  if (!date) return notify('Escolha a data da entrega interna.', 'error');
  const button = panel.querySelector('#link-internal-delivery');
  button.disabled = true;
  button.textContent = 'Vinculando…';
  try {
    const plan = await buildPlan(ids, date);
    const profile = { ...(campaign.profile || {}), internalDeliveries: [...plans(campaign), plan].slice(-50) };
    await saveProfile(campaign, profile);
    notify(`Entrega criada com ${fmt(plan.totalVolumes)} volumes numerados.`, 'success');
    await renderPanel(panel, { ...campaign, profile });
  } catch (error) {
    notify(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Vincular lotes e numerar volumes';
  }
}

async function unlinkPlan(panel, campaign, plan) {
  if (!window.confirm('Desfazer esta vinculação de lotes? Nenhuma baixa de entrega será feita.')) return;
  const profile = { ...(campaign.profile || {}), internalDeliveries: plans(campaign).filter((item) => item.id !== plan.id) };
  await saveProfile(campaign, profile);
  notify('Vínculo da entrega removido.', 'success');
  await renderPanel(panel, { ...campaign, profile });
}

async function confirmPlan(panel, campaign, plan) {
  const receivedBy = panel.querySelector('#internal-delivery-received')?.value.trim() || '';
  const deliveredBy = panel.querySelector('#internal-delivery-delivered')?.value.trim() || '';
  if (!receivedBy) return notify('Informe quem recebeu os volumes.', 'error');
  const button = panel.querySelector('[data-confirm-internal-delivery]');
  button.disabled = true;
  button.textContent = 'Confirmando…';
  try {
    for (const batchId of plan.batchIds) {
      await dataAction('production.handoff.confirm', { campaignId: cid(), productionBatchId: batchId, receivedBy, deliveredBy });
    }
    const updated = { ...plan, status: 'CONFIRMED', confirmedAt: new Date().toISOString(), receivedBy, deliveredBy };
    const profile = { ...(campaign.profile || {}), internalDeliveries: plans(campaign).map((item) => item.id === plan.id ? updated : item) };
    await saveProfile(campaign, profile);
    notify('Entrega à operação confirmada para todos os lotes vinculados.', 'success');
    await renderPanel(panel, { ...campaign, profile });
  } catch (error) {
    notify(`${error.message} As confirmações já concluídas foram preservadas; tente novamente para finalizar os lotes restantes.`, 'error');
    button.disabled = false;
    button.textContent = 'Confirmar entrega à operação';
  }
}

async function renderPanel(panel, campaignOverride = null) {
  const token = ++renderToken;
  const campaignId = cid();
  panel.hidden = !isStageEight();
  if (panel.hidden || !campaignId) return;
  panel.innerHTML = '<div class="internal-delivery-loading">Carregando lotes prontos para entrega…</div>';
  try {
    const [campaign, batches] = await Promise.all([
      campaignOverride ? Promise.resolve(campaignOverride) : dataAction('campaign.get', { campaignId }),
      dataAction('production.list', { campaignId }),
    ]);
    if (token !== renderToken || cid() !== campaignId) return;
    const activePlan = latestPlanned(campaign);
    const eligible = activePlan ? [] : await eligibleBatches(batches);
    if (token !== renderToken) return;
    panel.innerHTML = `<div class="internal-delivery-head"><div><p class="eyebrow">ETAPA 8</p><h2>Entrega à operação</h2><p>Selecione os lotes que serão entregues juntos, escolha a data e só então gere as etiquetas de controle dos volumes.</p></div></div>${activePlan ? planMarkup(activePlan) : selectorMarkup(eligible)}${historyMarkup(campaign)}`;
    if (activePlan) {
      panel.querySelector('[data-download-volume-labels]')?.addEventListener('click', () => generateInternalDeliveryVolumeLabels(activePlan, campaign));
      panel.querySelector('[data-download-manifest]')?.addEventListener('click', () => generateInternalDeliveryManifest(activePlan, campaign));
      panel.querySelector('[data-unlink-delivery]')?.addEventListener('click', () => unlinkPlan(panel, campaign, activePlan));
      panel.querySelector('[data-confirm-internal-delivery]')?.addEventListener('click', () => confirmPlan(panel, campaign, activePlan));
    } else {
      panel.querySelector('#link-internal-delivery')?.addEventListener('click', () => linkPlan(panel, campaign));
    }
  } catch (error) {
    panel.innerHTML = `<div class="notice warn">${h(error.message)}</div>`;
  }
}

function mount() {
  const page = ROOT?.querySelector('.page');
  const productionCard = page?.querySelector('[data-volumes]')?.closest('.card');
  if (!page || !productionCard) return;
  let panel = page.querySelector('#internal-delivery-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'internal-delivery-panel';
    panel.className = 'card internal-delivery-panel';
    // A timeline antiga (.approved-process) foi removida; a atual e .workflow-8-process.
    const process = page.querySelector(':scope > .workflow-8-process');
    if (process) process.insertAdjacentElement('afterend', panel);
    else page.querySelector(':scope > .page-head')?.insertAdjacentElement('afterend', panel);
  }
  const shouldShow = isStageEight();
  panel.hidden = !shouldShow;
  if (shouldShow && (!panel.dataset.loaded || !panel.childElementCount)) {
    panel.dataset.loaded = '1';
    renderPanel(panel);
  }
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
