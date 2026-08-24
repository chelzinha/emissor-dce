import { dataAction, textDownload } from './api.js';

const ROOT = document.querySelector('#elections-app');
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const campaignId = () => document.querySelector('#campaign-select')?.value || '';
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._portalExportTimer);
  box._portalExportTimer = setTimeout(() => { box.className = 'elections-toast'; }, 5200);
}

function exportId(row) { return String(row?.ID || row?.id || ''); }
function exportListId(row) { return String(row?.ADDRESS_LIST_ID || row?.addressListId || ''); }
function exportFileName(row) { return String(row?.FILE_NAME || row?.fileName || 'CSV do Portal Postal'); }
function exportTotal(row) { return Number(row?.TOTAL_ROWS || row?.total || 0); }
function exportService(row) { return String(row?.SERVICE || row?.service || ''); }

function baseRow(addressListId) {
  const button = ROOT?.querySelector(`[data-clean="${CSS.escape(String(addressListId || ''))}"]`);
  return button?.closest('tr') || null;
}

function markExported(addressListId, record) {
  const row = baseRow(addressListId);
  if (!row) return;
  row.dataset.baseExported = '1';
  row.dataset.baseExportId = exportId(record);
  row.dataset.baseExportFileName = exportFileName(record);
  const chip = row.querySelector('td:nth-child(2) .status');
  if (chip) {
    chip.textContent = 'EXPORTED';
    chip.classList.add('ok');
    chip.classList.remove('warn', 'bad');
  }
  const clean = row.querySelector('[data-clean]');
  if (clean) clean.hidden = true;
}

function statusHost(card) {
  let host = card?.querySelector('.portal-export-resilient-status');
  if (!host && card) {
    host = document.createElement('div');
    host.className = 'portal-export-resilient-status';
    host.style.marginTop = '14px';
    card.appendChild(host);
  }
  return host;
}

function showWorking(card, message) {
  const host = statusHost(card);
  if (!host) return;
  host.innerHTML = `<div class="notice"><strong>${esc(message)}</strong><br><small>Não feche esta tela até o arquivo ficar disponível.</small></div>`;
}

function showSuccess(card, record, recovered = false) {
  const id = exportId(record);
  const name = exportFileName(record);
  const total = exportTotal(record);
  const service = exportService(record);
  const form = card?.querySelector('.form-grid');
  if (form) form.hidden = true;
  const host = statusHost(card);
  if (!host) return;
  host.innerHTML = `<div class="notice"><strong>CSV pronto para o Portal Postal.</strong><br><span>${esc(name)}${total ? ` · ${fmt(total)} cadastros` : ''}${service ? ` · ${esc(service)}` : ''}</span>${recovered ? '<br><small>O arquivo já havia sido salvo e foi recuperado do histórico.</small>' : ''}<div style="margin-top:10px"><button type="button" class="secondary" data-redownload-export="${esc(id)}">Baixar CSV novamente</button></div></div>`;
}

function showError(card, message) {
  const host = statusHost(card);
  if (!host) return;
  host.innerHTML = `<div class="notice warn"><strong>Não foi possível concluir a exportação.</strong><br><span>${esc(message)}</span></div>`;
}

async function downloadStored(record) {
  const id = exportId(record);
  if (!id) throw new Error('Exportação sem identificador para download.');
  const file = await dataAction('portal.export.file', { campaignId: campaignId(), exportId: id });
  textDownload(file.content, file.fileName, 'text/csv;charset=utf-8');
  return file;
}

async function findStoredExport(addressListId) {
  const exports = await dataAction('portal.exports.list', { campaignId: campaignId() });
  return (exports || []).find((row) => exportListId(row) === String(addressListId || '')) || null;
}

async function generatePortalCsv(button) {
  const page = button.closest('.page');
  const card = button.closest('#base-export-card');
  const addressListId = page?.querySelector('#portal-export-list')?.value || '';
  const service = page?.querySelector('#portal-export-service')?.value || '';
  const content = page?.querySelector('#portal-export-content')?.value?.trim() || '';
  if (!campaignId()) return notify('Selecione uma operação.', 'error');
  if (!addressListId || !content) return notify('Selecione uma base e informe o conteúdo.', 'error');

  button.disabled = true;
  button.textContent = 'Gerando CSV…';
  showWorking(card, 'Gerando e salvando o CSV do Portal Postal…');
  try {
    const result = await dataAction('portal.export', { campaignId: campaignId(), addressListId, service, content });
    textDownload(result.csv, result.fileName, 'text/csv;charset=utf-8');
    markExported(addressListId, result);
    showSuccess(card, result, Boolean(result.recovered));
    notify(`${fmt(result.total)} cadastros exportados para ${service}.`, 'success');
  } catch (error) {
    try {
      const stored = await findStoredExport(addressListId);
      if (stored) {
        await downloadStored(stored);
        markExported(addressListId, stored);
        showSuccess(card, stored, true);
        notify('O CSV já havia sido gerado. Recuperei o arquivo salvo no histórico.', 'success');
        return;
      }
    } catch {}
    button.disabled = false;
    button.textContent = 'Gerar CSV para o Portal Postal';
    showError(card, error.message);
    notify(error.message, 'error');
  }
}

async function redownloadPortalCsv(button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Baixando…';
  try {
    await downloadStored({ ID: button.dataset.redownloadExport });
    notify('CSV recuperado do histórico.', 'success');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function enhanceExportedCard() {
  const page = ROOT?.querySelector('.page');
  const card = page?.querySelector('#base-export-card');
  if (!card || card.dataset.exportRecoveryMounted === '1') return;
  const text = card.textContent || '';
  if (!/base já foi exportada|próximo passo é o Portal Postal/i.test(text)) return;
  card.dataset.exportRecoveryMounted = '1';
  try {
    const exports = await dataAction('portal.exports.list', { campaignId: campaignId() });
    if (!exports?.length) return;
    const host = statusHost(card);
    host.innerHTML = `<div class="notice"><strong>Arquivos já gerados</strong><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${exports.map((row) => `<button type="button" class="secondary" data-redownload-export="${esc(exportId(row))}">${esc(exportService(row) || 'CSV')} · ${esc(exportFileName(row))}</button>`).join('')}</div></div>`;
  } catch {
    card.dataset.exportRecoveryMounted = '';
  }
}

document.addEventListener('click', (event) => {
  const generate = event.target.closest?.('#portal-export-run');
  if (generate) {
    event.preventDefault();
    event.stopImmediatePropagation();
    generatePortalCsv(generate);
    return;
  }
  const redownload = event.target.closest?.('[data-redownload-export]');
  if (redownload) {
    event.preventDefault();
    event.stopImmediatePropagation();
    redownloadPortalCsv(redownload);
  }
}, true);

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; enhanceExportedCard(); });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
enhanceExportedCard();
