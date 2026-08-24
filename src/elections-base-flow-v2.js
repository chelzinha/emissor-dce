import { dataAction, textDownload } from './api.js';

const ROOT = document.querySelector('#elections-app');

function h(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function numberFromText(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return Number(digits || 0);
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._baseFlowTimer);
  box._baseFlowTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}

function hideEarlyPostingFields(page) {
  const service = page.querySelector('#base-service');
  const content = page.querySelector('#base-content');
  if (service) {
    service.value = 'PAC';
    const field = service.closest('label');
    if (field) field.hidden = true;
  }
  if (content) {
    content.value = 'PENDENTE_DEFINICAO_POSTAGEM';
    const field = content.closest('label');
    if (field) field.hidden = true;
  }

  const receiveCard = page.querySelector('#base-file')?.closest('.card');
  const subtitle = receiveCard?.querySelector('.section-title p');
  if (subtitle) {
    subtitle.innerHTML = '<strong>CSV:</strong> NOME; CEP; ENDEREÇO; NUMERO; COMPLEMENTO; BAIRRO; CIDADE; UF. Colunas extras são preservadas.';
  }
}

function baseRows(page) {
  return [...page.querySelectorAll('tbody tr')]
    .filter((row) => row.querySelector('[data-clean]'))
    .map((row) => {
      const cells = row.querySelectorAll('td');
      return {
        id: row.querySelector('[data-clean]')?.dataset.clean || '',
        fileName: cells[0]?.textContent?.trim() || 'Base sem nome',
        total: numberFromText(cells[2]?.textContent),
        ready: numberFromText(cells[3]?.textContent),
        review: numberFromText(cells[4]?.textContent),
      };
    });
}

function hideLegacyExportButtons(page) {
  page.querySelectorAll('[data-export]').forEach((button) => {
    button.hidden = true;
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
  });
}

function exportCardMarkup(rows) {
  const eligible = rows.filter((row) => row.total > 0 && row.ready === row.total && row.review === 0);
  const options = eligible.map((row) => `<option value="${h(row.id)}">${h(row.fileName)} · ${row.ready.toLocaleString('pt-BR')} cadastros</option>`).join('');
  return `<section class="card" id="base-export-card" data-export-panel style="margin-top:16px">
    <div class="section-title"><div><h2>Definir dados da postagem</h2><p>Esta etapa vem depois da higienização. Defina o serviço e o conteúdo que serão aplicados ao CSV do Portal Postal.</p></div></div>
    ${eligible.length ? `<div class="form-grid">
      <label class="field"><span>Base higienizada</span><select id="portal-export-list">${options}</select></label>
      <label class="field"><span>Serviço</span><select id="portal-export-service"><option value="PAC">PAC</option><option value="SEDEX">SEDEX</option></select></label>
      <label class="field wide"><span>Conteúdo</span><input id="portal-export-content" value="PANFLETOS E ADESIVOS DA CAMPANHA"></label>
      <div class="wide"><button id="portal-export-run" class="primary" type="button">Gerar CSV para o Portal Postal</button></div>
    </div>` : '<div class="notice">Conclua a higienização da base, sem pendências, para liberar os dados de postagem e a exportação.</div>'}
  </section>`;
}

function mountExportCard(page) {
  if (page.querySelector('#base-export-card')) return;
  const rows = baseRows(page);
  if (!rows.length) return;
  const cards = [...page.querySelectorAll(':scope > .card')];
  const basesCard = cards.find((card) => card.querySelector('[data-clean]'));
  if (!basesCard) return;
  basesCard.insertAdjacentHTML('afterend', exportCardMarkup(rows));
  page.querySelector('#portal-export-run')?.addEventListener('click', runExport);
}

async function runExport() {
  const campaignId = document.querySelector('#campaign-select')?.value || '';
  const addressListId = document.querySelector('#portal-export-list')?.value || '';
  const service = document.querySelector('#portal-export-service')?.value || '';
  const content = document.querySelector('#portal-export-content')?.value?.trim() || '';
  if (!campaignId || !addressListId) return notify('Selecione uma operação e uma base higienizada.', 'error');
  if (!content) return notify('Informe o conteúdo antes de gerar o CSV.', 'error');
  const button = document.querySelector('#portal-export-run');
  if (button) { button.disabled = true; button.textContent = 'Gerando CSV…'; }
  try {
    const result = await dataAction('portal.export', { campaignId, addressListId, service, content });
    textDownload(result.csv, result.fileName, 'text/csv;charset=utf-8');
    notify(`${Number(result.total || 0).toLocaleString('pt-BR')} cadastros exportados para ${service}.`, 'success');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    notify(error.message, 'error');
    if (button) { button.disabled = false; button.textContent = 'Gerar CSV para o Portal Postal'; }
  }
}

function fixNextAction(page) {
  const button = page.querySelector('[data-approved-base="export"]');
  if (!button) return;
  button.textContent = 'Definir postagem e exportar CSV →';
  button.dataset.baseExportFocus = '1';
}

function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page?.querySelector('#base-file')) return;
  hideEarlyPostingFields(page);
  hideLegacyExportButtons(page);
  mountExportCard(page);
  fixNextAction(page);
}

ROOT?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-base-export-focus="1"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const panel = ROOT.querySelector('[data-export-panel]');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  panel?.querySelector('#portal-export-service')?.focus();
}, true);

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; mount(); });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
