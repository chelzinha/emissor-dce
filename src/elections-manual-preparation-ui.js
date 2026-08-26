import './elections-manual-preparation-ui.css';
import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
const INTERNAL_CHUNK = 25;
const MIN_CHUNK = 5;
const preparingLists = new Set();
let campaignCache = null;
let scheduled = false;

const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const cid = () => String(document.querySelector('#campaign-select')?.value || '');
const setText = (node, value) => { if (node && node.textContent !== String(value)) node.textContent = String(value); };

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._manualPreparationTimer);
  box._manualPreparationTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4600);
}

function numberFromCell(cell) {
  return Number(String(cell?.textContent || '').replace(/\D/g, '') || 0);
}

function rowInfo(row) {
  const cells = row.querySelectorAll('td');
  const button = row.querySelector('[data-clean]');
  return {
    row,
    id: String(button?.dataset.clean || ''),
    status: String(cells[1]?.textContent || '').trim().toUpperCase(),
    total: numberFromCell(cells[2]),
    ready: numberFromCell(cells[3]),
    review: numberFromCell(cells[4]),
  };
}

function statusPanel(page) {
  let panel = page.querySelector('[data-base-technical-preparation]');
  if (!panel) {
    panel = document.createElement('div');
    panel.dataset.baseTechnicalPreparation = 'true';
    panel.className = 'base-technical-preparation';
    const card = [...page.querySelectorAll(':scope > .card')].find((item) => item.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
    card?.querySelector('.section-title')?.insertAdjacentElement('afterend', panel);
  }
  return panel;
}

function showTechnicalStatus(page, message = '', type = '') {
  const panel = statusPanel(page);
  if (!panel) return;
  panel.className = `base-technical-preparation ${type}`.trim();
  panel.textContent = message;
  panel.hidden = !message;
}

async function currentCampaign() {
  const id = cid();
  if (!id) return null;
  if (!campaignCache) campaignCache = await dataAction('campaigns.list');
  return (Array.isArray(campaignCache) ? campaignCache : []).find((item) => String(item.id) === id) || null;
}

function manualCleanedValue(campaign) {
  const value = campaign?.profile?.manualMetrics?.addressCleaned;
  if (value === '' || value == null) return '';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(Math.round(number)) : '';
}

async function saveManualCleaned(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const input = form.querySelector('input[name="addressCleaned"]');
  const raw = String(input?.value || '').trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0) {
    notify('Informe uma quantidade inteira igual ou maior que zero.', 'error');
    return;
  }

  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const campaign = await currentCampaign();
    if (!campaign) throw new Error('Operação não encontrada.');
    const profile = {
      ...(campaign.profile || {}),
      manualMetrics: {
        ...(campaign.profile?.manualMetrics || {}),
        addressCleaned: Math.round(value),
        updatedAt: new Date().toISOString(),
        source: 'PREPARATION_MANUAL',
      },
    };
    const updated = await dataAction('campaign.upsert', {
      id: campaign.id,
      name: campaign.name,
      cnpj: campaign.cnpj,
      candidateName: campaign.candidateName,
      office: campaign.office,
      status: campaign.status,
      profile,
    });
    campaignCache = (campaignCache || []).map((item) => String(item.id) === String(updated.id) ? updated : item);
    setText(form.closest('[data-manual-preparation-panel]')?.querySelector('small'), `Quantidade atual: ${fmt(value)} cadastros`);
    notify('Quantidade higienizada atualizada manualmente.', 'success');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar quantidade';
  }
}

async function mountManualEditor(page) {
  const basesCard = [...page.querySelectorAll(':scope > .card')].find((item) => item.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
  if (!basesCard || page.querySelector('[data-manual-preparation-panel]')) return;

  try {
    const campaign = await currentCampaign();
    const value = manualCleanedValue(campaign);
    const panel = document.createElement('section');
    panel.className = 'manual-preparation-panel';
    panel.dataset.manualPreparationPanel = 'true';
    panel.innerHTML = `<div class="manual-preparation-copy">
      <strong>Quantidade higienizada</strong>
      <span>Este indicador é informado manualmente e pode ser atualizado sempre que necessário. Ele não depende do processamento técnico dos arquivos.</span>
      <small>${value ? `Quantidade atual: ${fmt(value)} cadastros` : 'Nenhuma quantidade manual informada'}</small>
    </div>
    <form class="manual-preparation-form" data-manual-preparation-form>
      <label><span>Cadastros higienizados</span><input name="addressCleaned" type="number" min="0" step="1" value="${value}" required></label>
      <button type="submit" class="primary">Salvar quantidade</button>
    </form>`;
    basesCard.insertAdjacentElement('beforebegin', panel);
    panel.querySelector('[data-manual-preparation-form]')?.addEventListener('submit', saveManualCleaned);
  } catch (error) {
    console.warn('Não foi possível carregar o indicador manual de higienização.', error);
  }
}

function simplifyTable(page) {
  page.classList.add('bases-manual-mode');
  const table = [...page.querySelectorAll('table')].find((item) => item.querySelector('[data-clean]'));
  if (!table) return;

  const indexes = [3, 4, 5];
  table.querySelectorAll('tr').forEach((row) => {
    [...row.children].forEach((cell, index) => {
      cell.classList.toggle('manual-preparation-hidden-column', indexes.includes(index));
    });
  });
  table.querySelectorAll('.base-cleaning-progress-row').forEach((row) => row.remove());
}

function rewriteCopy(page) {
  const head = page.querySelector(':scope > .page-head');
  setText(head?.querySelector('p:not(.eyebrow)'), 'Receba a base completa e registre manualmente os quantitativos da preparação antes de seguir para o Portal Postal.');

  const received = [...page.querySelectorAll(':scope > .card')].find((card) => card.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
  setText(received?.querySelector('.section-title p'), 'As bases ficam registradas aqui. A quantidade higienizada é controlada manualmente no painel acima.');

  const exportCard = page.querySelector('#base-export-card');
  setText(exportCard?.querySelector('h2'), 'Definir dados da postagem');
  setText(exportCard?.querySelector('.section-title p'), 'Selecione uma base disponível, o serviço e o conteúdo para gerar o CSV do Portal Postal.');
  setText(exportCard?.querySelector('label.field span'), 'Base disponível');
  const notice = exportCard?.querySelector('.notice');
  if (notice?.textContent?.includes('higienização')) {
    setText(notice, 'A base está sendo preparada internamente para o Portal Postal. Não é necessária nenhuma ação de higienização nesta tela.');
  }
}

function setRowPresentation(info) {
  const chip = info.row.querySelector('td:nth-child(2) .status');
  if (!chip) return;
  if (info.total > 0 && info.ready === info.total && info.review === 0) {
    setText(chip, 'Disponível para Portal');
    chip.classList.add('ok');
    chip.classList.remove('warn', 'bad');
    return;
  }
  if (info.review > 0) {
    setText(chip, 'Ajustes necessários');
    chip.classList.add('warn');
    chip.classList.remove('ok', 'bad');
    return;
  }
  if (preparingLists.has(info.id)) {
    setText(chip, 'Preparando arquivo');
    chip.classList.add('warn');
    chip.classList.remove('ok', 'bad');
  }
}

async function prepareList(page, info) {
  if (!info.id || preparingLists.has(info.id) || info.total <= 0 || info.ready + info.review >= info.total) return;
  preparingLists.add(info.id);
  let chunkSize = INTERNAL_CHUNK;
  let processed = info.ready + info.review;
  setRowPresentation(info);

  try {
    while (true) {
      const rows = await dataAction('addressRows.list', {
        campaignId: cid(),
        addressListId: info.id,
        status: 'RAW',
        limit: chunkSize,
      });
      if (!rows.length) break;

      const ids = rows.map((row) => String(row.id || '')).filter(Boolean);
      if (!ids.length) break;
      showTechnicalStatus(page, `Preparando ${fmt(Math.min(info.total, processed + ids.length))} de ${fmt(info.total)} cadastros para o Portal Postal…`);

      try {
        const result = await dataAction('cleaning.process', {
          campaignId: cid(),
          addressListId: info.id,
          rowIds: ids,
        });
        processed += Number(result?.summary?.processed || ids.length);
        chunkSize = INTERNAL_CHUNK;
      } catch (error) {
        if (/504|timeout|tempo/i.test(String(error?.message || '')) && chunkSize > MIN_CHUNK) {
          chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
          await new Promise((resolve) => setTimeout(resolve, 700));
          continue;
        }
        throw error;
      }
    }

    const review = await dataAction('addressRows.list', {
      campaignId: cid(),
      addressListId: info.id,
      status: 'REVIEW',
      limit: 1,
    });

    if (review.length) {
      showTechnicalStatus(page, 'O arquivo foi recebido, mas contém cadastros incompatíveis com o layout do Portal Postal. Envie uma base corrigida para seguir.', 'warn');
      return;
    }

    showTechnicalStatus(page, 'Base preparada para o Portal Postal.', '');
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    showTechnicalStatus(page, `Não foi possível preparar o arquivo para o Portal Postal: ${error.message}`, 'error');
  } finally {
    preparingLists.delete(info.id);
  }
}

function preparePendingBases(page) {
  const infos = [...page.querySelectorAll('tbody tr')]
    .filter((row) => row.querySelector('[data-clean]'))
    .map(rowInfo);

  infos.forEach(setRowPresentation);
  const pending = infos.find((info) => info.total > 0 && info.ready + info.review < info.total && !preparingLists.has(info.id));
  if (pending) prepareList(page, pending);
}

function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page?.querySelector('#base-file')) return;
  simplifyTable(page);
  rewriteCopy(page);
  mountManualEditor(page);
  preparePendingBases(page);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-clean]');
  if (!button || !ROOT?.contains(button)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

ROOT?.addEventListener('change', (event) => {
  if (event.target?.id === 'campaign-select') {
    campaignCache = null;
    preparingLists.clear();
    scheduleMount();
  }
});

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    mount();
  });
}

const observer = new MutationObserver(scheduleMount);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
