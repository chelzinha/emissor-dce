import './elections-operation-settings-ui.css';
import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
let loadingFor = '';

function h(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function digits(value) { return String(value ?? '').replace(/\D/g, ''); }
function campaignId() { return document.querySelector('#campaign-select')?.value || ''; }
function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._operationSettingsTimer);
  box._operationSettingsTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}
function value(object, ...keys) { for (const key of keys) if (object?.[key] != null) return String(object[key]); return ''; }

function addressFields(prefix, address = {}) {
  return `<div class="operation-settings-address">
    <label class="field"><span>CEP</span><input name="${prefix}Zip" value="${h(digits(address.zip))}" inputmode="numeric" maxlength="8"></label>
    <label class="field span-2"><span>Endereço</span><input name="${prefix}Street" value="${h(address.street || '')}"></label>
    <label class="field"><span>Número</span><input name="${prefix}Number" value="${h(address.number || '')}"></label>
    <label class="field"><span>Complemento</span><input name="${prefix}Complement" value="${h(address.complement || '')}"></label>
    <label class="field"><span>Bairro</span><input name="${prefix}District" value="${h(address.district || '')}"></label>
    <label class="field"><span>Cidade</span><input name="${prefix}City" value="${h(address.city || '')}"></label>
    <label class="field small"><span>UF</span><input name="${prefix}Uf" value="${h(String(address.uf || '').toUpperCase())}" maxlength="2"></label>
  </div>`;
}

function accessMarkup(access = {}) {
  return `<form id="operation-client-access-form" class="operation-settings-access-grid">
    <label class="field"><span>Usuário</span><input name="username" autocomplete="off" placeholder="ex.: candidato01" value="${h(access.username || '')}" required></label>
    <label class="field"><span>E-mail de recuperação</span><input name="email" type="email" autocomplete="off" value="${h(access.email || '')}" required></label>
    <label class="field"><span>Nome</span><input name="fullName" autocomplete="off" value="${h(access.fullName || '')}"></label>
    <label class="field"><span>${access.username ? 'Senha para confirmar a atualização' : 'Senha inicial'}</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <div class="span-all operation-settings-actions"><button class="secondary" type="submit">${access.username ? 'Atualizar ou confirmar acesso' : 'Criar ou vincular acesso'}</button><span class="operation-access-result" data-access-result></span></div>
  </form>`;
}

function settingsMarkup(campaign) {
  const profile = campaign?.profile || {};
  const contact = profile.contact || {};
  const operationAddress = profile.operationAddress || profile.address || {};
  const sender = profile.sender || profile.issuer || {};
  const senderAddress = sender.address || {};
  return `<section class="card operation-settings-card" id="operation-settings-card" data-operation-settings>
    <div class="operation-settings-head"><div><p class="eyebrow">DADOS DA OPERAÇÃO</p><h2>${h(campaign.name || 'Operação')}</h2><p>Estas informações ficam centralizadas em Configurações › Operações e são reaproveitadas nas etapas seguintes.</p></div><span class="operation-settings-state">Editável</span></div>
    <form id="operation-settings-form">
      <fieldset><legend>Dados gerais</legend><div class="operation-settings-grid">
        <label class="field span-2"><span>Nome da operação</span><input name="name" value="${h(campaign.name || '')}" required></label>
        <label class="field"><span>CNPJ eleitoral</span><input name="cnpj" value="${h(campaign.cnpj || '')}"></label>
        <label class="field"><span>Candidato</span><input name="candidateName" value="${h(campaign.candidateName || '')}"></label>
        <label class="field"><span>Cargo</span><input name="office" value="${h(campaign.office || '')}"></label>
        <label class="field"><span>Responsável pela operação</span><input name="responsibleName" value="${h(value(contact, 'responsibleName', 'name'))}"></label>
        <label class="field"><span>Telefone</span><input name="phone" value="${h(contact.phone || '')}"></label>
        <label class="field"><span>E-mail</span><input name="contactEmail" type="email" value="${h(contact.email || '')}"></label>
      </div></fieldset>
      <fieldset><legend>Endereço da operação</legend>${addressFields('operation', operationAddress)}</fieldset>
      <fieldset><legend>Dados do remetente</legend><div class="operation-settings-grid sender-main">
        <label class="field span-2"><span>Nome / razão social do remetente</span><input name="senderName" value="${h(sender.name || '')}"></label>
        <label class="field"><span>CPF/CNPJ do remetente</span><input name="senderDocument" value="${h(sender.document || sender.cnpj || '')}"></label>
      </div>${addressFields('sender', senderAddress)}</fieldset>
      <div class="operation-settings-actions"><button type="submit" class="primary">Salvar dados da operação</button><span data-save-status></span></div>
    </form>
    <div class="operation-settings-divider"></div>
    <div class="operation-settings-subhead"><div><h3>Usuário final</h3><p>Crie ou vincule o acesso do cliente a esta operação. O e-mail fica reservado para identificação e recuperação.</p></div></div>
    ${accessMarkup(profile.clientAccess || {})}
  </section>`;
}

function readAddress(values, prefix) {
  return {
    zip: digits(values[`${prefix}Zip`]), street: String(values[`${prefix}Street`] || '').trim(),
    number: String(values[`${prefix}Number`] || '').trim(), complement: String(values[`${prefix}Complement`] || '').trim(),
    district: String(values[`${prefix}District`] || '').trim(), city: String(values[`${prefix}City`] || '').trim(),
    uf: String(values[`${prefix}Uf`] || '').trim().toUpperCase(),
  };
}

async function saveOperation(card, campaign, form) {
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-save-status]');
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  status.textContent = 'Salvando…';
  try {
    const profile = {
      ...(campaign.profile || {}),
      contact: {
        ...((campaign.profile || {}).contact || {}),
        responsibleName: String(values.responsibleName || '').trim(), phone: String(values.phone || '').trim(), email: String(values.contactEmail || '').trim(),
      },
      operationAddress: readAddress(values, 'operation'),
      sender: {
        ...((campaign.profile || {}).sender || {}),
        name: String(values.senderName || '').trim(), document: digits(values.senderDocument),
        address: readAddress(values, 'sender'),
      },
    };
    await dataAction('campaign.upsert', {
      id: campaign.id, name: String(values.name || '').trim(), cnpj: digits(values.cnpj),
      candidateName: String(values.candidateName || '').trim(), office: String(values.office || '').trim(),
      status: campaign.status, profile,
    });
    status.textContent = 'Salvo.';
    notify('Dados da operação atualizados.', 'success');
    setTimeout(() => location.reload(), 650);
  } catch (error) {
    status.textContent = error.message;
    notify(error.message, 'error');
    button.disabled = false;
  }
}

async function saveAccess(form, campaign) {
  const cid = campaignId();
  if (!cid) return notify('Selecione uma operação.', 'error');
  const button = form.querySelector('button[type="submit"]');
  const result = form.querySelector('[data-access-result]');
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  button.textContent = 'Criando acesso…';
  result.textContent = '';
  try {
    const response = await fetch('/api/portal/users', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: cid, ...values }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Não foi possível criar o acesso.');
    const clientAccess = {
      userId: String(payload.data?.id || ''), username: String(payload.data?.username || values.username || ''),
      email: String(payload.data?.email || values.email || ''), fullName: String(values.fullName || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    const profile = { ...(campaign.profile || {}), clientAccess };
    await saveProfileOnly(campaign, profile);
    campaign.profile = profile;
    result.textContent = `${payload.data?.created ? 'Acesso criado' : 'Acesso vinculado'}: ${clientAccess.username}`;
    form.querySelector('[name="password"]').value = '';
    notify('Acesso do usuário final vinculado à operação.', 'success');
  } catch (error) {
    result.textContent = error.message;
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Criar ou vincular acesso';
  }
}

async function saveProfileOnly(campaign, profile) {
  return dataAction('campaign.upsert', {
    id: campaign.id, name: campaign.name, cnpj: digits(campaign.cnpj),
    candidateName: campaign.candidateName, office: campaign.office, status: campaign.status, profile,
  });
}

async function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page || !page.querySelector('#new-campaign') || page.querySelector('#operation-settings-card')) return;
  const cid = campaignId();
  if (!cid) return;
  if (loadingFor === cid) return;
  loadingFor = cid;
  try {
    const campaign = await dataAction('campaign.get', { campaignId: cid });
    if (!ROOT?.querySelector('.page') || campaignId() !== cid || ROOT.querySelector('#operation-settings-card')) return;
    const currentPage = ROOT.querySelector('.page');
    const head = currentPage.querySelector(':scope > .page-head');
    const holder = document.createElement('div');
    holder.innerHTML = settingsMarkup(campaign);
    const card = holder.firstElementChild;
    if (head) head.insertAdjacentElement('afterend', card); else currentPage.prepend(card);
    currentPage.querySelector('#client-access-card')?.remove();
    card.querySelector('#operation-settings-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveOperation(card, campaign, event.currentTarget);
    });
    card.querySelector('#operation-client-access-form').addEventListener('submit', (event) => {
      event.preventDefault();
      saveAccess(event.currentTarget, campaign);
    });
  } catch (error) {
    notify(error.message, 'error');
  } finally { loadingFor = ''; }
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
