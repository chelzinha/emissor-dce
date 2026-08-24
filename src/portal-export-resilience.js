import { dataAction, textDownload } from './api.js';
import { PORTAL_CSV_MAX_ROWS, splitPortalCsv } from './elections-portal-csv-limit-ui.js';

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
  box._portalExportTimer = setTimeout(() => { box.className = 'elections-toast'; }, 6500);
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
  host.innerHTML = `<div class="notice"><strong>${esc(message)}</strong><br><small>Não feche esta tela até os arquivos ficarem disponíveis.</small></div>`;
}

function partSummary(parts) {
  if (!parts?.length) return '';
  if (parts.length === 1) return `1 arquivo com ${fmt(parts[0].count)} cadastros`;
  return `${parts.length} arquivos · ${parts.map((part) => fmt(part.count)).join(' + ')} cadastros`;
}

function showSuccess(card, record, recovered = false, parts = []) {
  const id = exportId(record);
  const total = exportTotal(record) || parts.reduce((sum, part) => sum + Number(part.count || 0), 0);
  const service = exportService(record);
  const form = card?.querySelector('.form-grid');
  if (form) form.hidden = true;
  const host = statusHost(card);
  if (!host) return;
  const filesText = partSummary(parts);
  host.innerHTML = `<div class="notice"><strong>Arquivos prontos para o Portal Postal.</strong><br><span>${total ? `${fmt(total)} cadastros` : ''}${service ? ` · ${esc(service)}` : ''}${filesText ? ` · ${esc(filesText)}` : ''}</span><br><small>Cada CSV possui no máximo ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros e repete o cabeçalho exigido pelo Portal.</small>${recovered ? '<br><small>O arquivo original já havia sido salvo e foi recuperado do histórico.</small>' : ''}<div style="margin-top:10px"><button type="button" class="secondary" data-redownload-export="${esc(id)}">Baixar arquivos novamente</button></div></div>`;
}

function showError(card, message) {
  const host = statusHost(card);
  if (!host) return;
  host.innerHTML = `<div class="notice warn"><strong>Não foi possível concluir a exportação.</strong><br><span>${esc(message)}</span></div>`;
}

function downloadParts(content, fileName) {
  const parts = splitPortalCsv(content, fileName, PORTAL_CSV_MAX_ROWS);
  parts.forEach((part) => textDownload(part.content, part.fileName, 'text/csv;charset=utf-8'));
  return parts;
}

async function downloadStored(record) {
  const id = exportId(record);
  if (!id) throw new Error('Exportação sem identificador para download.');
  const file = await dataAction('portal.export.file', { campaignId: campaignId(), exportId: id });
  const parts = downloadParts(file.content, file.fileName);
  return { file, parts };
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
  button.textContent = 'Gerando arquivos…';
  showWorking(card, `Gerando CSVs em grupos de até ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros…`);
  try {
    const result = await dataAction('portal.export', { campaignId: campaignId(), addressListId, service, content });
    const parts = downloadParts(result.csv, result.fileName);
    markExported(addressListId, result);
    showSuccess(card, result, Boolean(result.recovered), parts);
    notify(`${fmt(result.total)} cadastros exportados em ${parts.length} arquivo${parts.length > 1 ? 's' : ''}.`, 'success');
  } catch (error) {
    try {
      const stored = await findStoredExport(addressListId);
      if (stored) {
        const downloaded = await downloadStored(stored);
        markExported(addressListId, stored);
        showSuccess(card, stored, true, downloaded.parts);
        notify(`A exportação já havia sido concluída. Baixei ${downloaded.parts.length} arquivo${downloaded.parts.length > 1 ? 's' : ''} dentro do limite do Portal.`, 'success');
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
  button.textContent = 'Preparando arquivos…';
  try {
    const downloaded = await downloadStored({ ID: button.dataset.redownloadExport });
    notify(`Download preparado em ${downloaded.parts.length} arquivo${downloaded.parts.length > 1 ? 's' : ''} de até ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros.`, 'success');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function downloadPortalHistory(button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Preparando arquivos…';
  try {
    const downloaded = await downloadStored({ ID: button.dataset.downloadExport });
    notify(`Download preparado em ${downloaded.parts.length} arquivo${downloaded.parts.length > 1 ? 's' : ''} de até ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros.`, 'success');
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
  if (!card) return;

  const description = card.querySelector('.section-title p');
  if (description && description.dataset.portalLimitCopy !== '1') {
    description.dataset.portalLimitCopy = '1';
    description.textContent = `Depois da higienização, defina serviço e conteúdo. O sistema divide automaticamente o download em CSVs de até ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros.`;
  }

  if (card.dataset.exportRecoveryMounted === '1') return;
  const text = card.textContent || '';
  if (!/base já foi exportada|próximo passo é o Portal Postal/i.test(text)) return;
  card.dataset.exportRecoveryMounted = '1';
  try {
    const exports = await dataAction('portal.exports.list', { campaignId: campaignId() });
    if (!exports?.length) return;
    const host = statusHost(card);
    host.innerHTML = `<div class="notice"><strong>Arquivos já gerados</strong><br><small>Ao baixar, bases com mais de ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros serão divididas automaticamente.</small><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${exports.map((row) => `<button type="button" class="secondary" data-redownload-export="${esc(exportId(row))}">${esc(exportService(row) || 'CSV')} · ${esc(exportFileName(row))}</button>`).join('')}</div></div>`;
  } catch {
    card.dataset.exportRecoveryMounted = '';
  }
}

function decoratePortalHistory() {
  const page = ROOT?.querySelector('.page');
  if (!page) return;
  const title = [...page.querySelectorAll('h1')].find((node) => /Arquivos enviados ao Portal/i.test(node.textContent || ''));
  if (!title) return;
  const description = title.parentElement?.querySelector('p:not(.eyebrow)');
  if (description && description.dataset.portalLimitCopy !== '1') {
    description.dataset.portalLimitCopy = '1';
    description.textContent = `Os CSVs seguem o layout do Portal Postal. Downloads com mais de ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros são divididos automaticamente em partes numeradas.`;
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
    return;
  }
  const history = event.target.closest?.('[data-download-export]');
  if (history) {
    event.preventDefault();
    event.stopImmediatePropagation();
    downloadPortalHistory(history);
  }
}, true);

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    enhanceExportedCard();
    decoratePortalHistory();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
enhanceExportedCard();
decoratePortalHistory();
