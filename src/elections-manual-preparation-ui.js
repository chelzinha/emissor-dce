import './elections-manual-preparation-ui.css';
import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
let campaignCache = null;
let campaignPromise = null;
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

async function currentCampaign() {
  const id = cid();
  if (!id) return null;
  if (!campaignCache) {
    if (!campaignPromise) {
      campaignPromise = dataAction('campaigns.list')
        .then((rows) => {
          campaignCache = Array.isArray(rows) ? rows : [];
          return campaignCache;
        })
        .finally(() => { campaignPromise = null; });
    }
    await campaignPromise;
  }
  return campaignCache.find((item) => String(item.id) === id) || null;
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

function panelMarkup(value) {
  return `<div class="manual-preparation-copy">
    <strong>Quantidade higienizada</strong>
    <span>Este indicador é informado manualmente e pode ser atualizado sempre que necessário.</span>
    <small>${value ? `Quantidade atual: ${fmt(value)} cadastros` : 'Nenhuma quantidade manual informada'}</small>
  </div>
  <form class="manual-preparation-form" data-manual-preparation-form>
    <label><span>Cadastros higienizados</span><input name="addressCleaned" type="number" min="0" step="1" value="${value}" required></label>
    <button type="submit" class="primary">Salvar quantidade</button>
  </form>`;
}

async function mountManualEditor(page) {
  const basesCard = [...page.querySelectorAll(':scope > .card')].find((item) => item.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
  if (!basesCard) return;

  const existing = [...page.querySelectorAll('[data-manual-preparation-panel]')];
  existing.slice(1).forEach((panel) => panel.remove());
  if (existing[0]) return;

  const panel = document.createElement('section');
  panel.className = 'manual-preparation-panel';
  panel.dataset.manualPreparationPanel = 'true';
  panel.dataset.loading = 'true';
  panel.innerHTML = '<div class="manual-preparation-copy"><strong>Quantidade higienizada</strong><span>Carregando indicador…</span></div>';
  basesCard.insertAdjacentElement('beforebegin', panel);

  try {
    const campaign = await currentCampaign();
    if (!panel.isConnected) return;
    const value = manualCleanedValue(campaign);
    panel.innerHTML = panelMarkup(value);
    delete panel.dataset.loading;
    panel.querySelector('[data-manual-preparation-form]')?.addEventListener('submit', saveManualCleaned);
  } catch (error) {
    if (panel.isConnected) panel.remove();
    console.warn('Não foi possível carregar o indicador manual de higienização.', error);
  }
}

function simplifyTable(page) {
  page.classList.add('bases-manual-mode');
  page.querySelectorAll('[data-base-technical-preparation], .base-cleaning-progress-row, #base-operation-status').forEach((node) => node.remove());

  const table = [...page.querySelectorAll('table')].find((item) => item.querySelector('[data-clean]'));
  if (!table) return;

  const hiddenIndexes = [3, 4, 5];
  table.querySelectorAll('tr').forEach((row) => {
    [...row.children].forEach((cell, index) => {
      cell.classList.toggle('manual-preparation-hidden-column', hiddenIndexes.includes(index));
    });
  });

  table.querySelectorAll('tbody tr').forEach((row) => {
    if (!row.querySelector('[data-clean]')) return;
    const chip = row.querySelector('td:nth-child(2) .status');
    const current = String(chip?.textContent || '').trim().toUpperCase();
    if (!chip) return;

    if (current === 'READY') {
      chip.classList.add('ok');
      chip.classList.remove('warn', 'bad');
      return;
    }

    setText(chip, current.includes('EXPORT') ? 'Exportada' : 'Recebida');
    chip.classList.toggle('ok', current.includes('EXPORT'));
    chip.classList.toggle('warn', !current.includes('EXPORT'));
    chip.classList.remove('bad');
  });
}

function rewriteCopy(page) {
  const head = page.querySelector(':scope > .page-head');
  setText(head?.querySelector('p:not(.eyebrow)'), 'Receba a base completa e registre manualmente os quantitativos da preparação antes de seguir para o Portal Postal.');

  const received = [...page.querySelectorAll(':scope > .card')].find((card) => card.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
  setText(received?.querySelector('.section-title p'), 'As bases importadas ficam registradas aqui. Nenhuma higienização automática é executada nesta tela.');

  const exportCard = page.querySelector('#base-export-card');
  const notice = exportCard?.querySelector('.notice');
  if (notice && /higieniza|preparad/i.test(notice.textContent || '')) {
    setText(notice, 'A base está registrada. A geração do arquivo do Portal Postal será tratada em uma ação específica.');
  }
}

function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page?.querySelector('#base-file')) return;
  simplifyTable(page);
  rewriteCopy(page);
  mountManualEditor(page);
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
    campaignPromise = null;
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
