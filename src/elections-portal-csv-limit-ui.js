import { dataAction, textDownload } from './api.js';

export const PORTAL_CSV_MAX_ROWS = 1000;

function normalizeCsvLines(content) {
  const text = String(content || '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

export function splitPortalCsv(content, fileName, maxRows = PORTAL_CSV_MAX_ROWS) {
  const lines = normalizeCsvLines(content);
  if (!lines.length) throw new Error('O CSV do Portal está vazio.');
  const header = lines[0];
  const rows = lines.slice(1);
  if (!rows.length) throw new Error('O CSV do Portal não possui cadastros.');
  const limit = Math.max(1, Number(maxRows || PORTAL_CSV_MAX_ROWS));
  const totalParts = Math.ceil(rows.length / limit);
  const originalName = String(fileName || 'portal_postal.csv');
  const baseName = originalName.replace(/\.csv$/i, '') || 'portal_postal';

  return Array.from({ length: totalParts }, (_, index) => {
    const start = index * limit;
    const partRows = rows.slice(start, start + limit);
    const suffix = totalParts > 1
      ? `_parte_${String(index + 1).padStart(2, '0')}_de_${String(totalParts).padStart(2, '0')}`
      : '';
    return {
      index: index + 1,
      totalParts,
      count: partRows.length,
      startRow: start + 1,
      endRow: start + partRows.length,
      fileName: `${baseName}${suffix}.csv`,
      content: `${header}\r\n${partRows.join('\r\n')}\r\n`,
    };
  });
}

export function downloadPortalCsvParts(content, fileName) {
  const parts = splitPortalCsv(content, fileName);
  parts.forEach((part) => textDownload(part.content, part.fileName, 'text/csv;charset=utf-8'));
  return parts;
}

function fmt(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function campaignId() {
  return document.querySelector('#campaign-select')?.value || '';
}

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._portalCsvLimitTimer);
  box._portalCsvLimitTimer = setTimeout(() => { box.className = 'elections-toast'; }, 6500);
}

function setButton(button, label, disabled = false) {
  if (!button) return;
  button.disabled = disabled;
  button.textContent = label;
}

function exportAddressListId(row) {
  return String(row?.ADDRESS_LIST_ID || row?.addressListId || '');
}

function exportCreatedAt(row) {
  return String(row?.CREATED_AT || row?.createdAt || '');
}

function exportId(row) {
  return String(row?.ID || row?.id || '');
}

async function recoverCreatedExport(addressListId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1200));
    const rows = await dataAction('portal.exports.list', { campaignId: campaignId() });
    const match = (rows || [])
      .filter((row) => exportAddressListId(row) === String(addressListId))
      .sort((a, b) => exportCreatedAt(b).localeCompare(exportCreatedAt(a)))[0];
    if (!match) continue;
    const id = exportId(match);
    if (!id) continue;
    return dataAction('portal.export.file', { campaignId: campaignId(), exportId: id });
  }
  return null;
}

function resultSummary(parts, total) {
  if (parts.length === 1) return `${fmt(total)} cadastros exportados em 1 arquivo.`;
  return `${fmt(total)} cadastros exportados em ${parts.length} arquivos de no máximo ${fmt(PORTAL_CSV_MAX_ROWS)} cadastros cada.`;
}

async function handleGenerate(button) {
  const page = button.closest('.page') || document;
  const addressListId = page.querySelector('#portal-export-list')?.value || '';
  const service = page.querySelector('#portal-export-service')?.value || '';
  const content = page.querySelector('#portal-export-content')?.value?.trim() || '';
  if (!addressListId || !content) return notify('Selecione uma base e informe o conteúdo.', 'error');

  setButton(button, 'Gerando arquivos…', true);
  try {
    const result = await dataAction('portal.export', { campaignId: campaignId(), addressListId, service, content });
    const parts = downloadPortalCsvParts(result.csv, result.fileName);
    setButton(button, `Gerado em ${parts.length} arquivo${parts.length > 1 ? 's' : ''}`, true);
    notify(resultSummary(parts, result.total || parts.reduce((sum, part) => sum + part.count, 0)), 'success');
  } catch (error) {
    try {
      const recovered = await recoverCreatedExport(addressListId);
      if (recovered?.content) {
        const parts = downloadPortalCsvParts(recovered.content, recovered.fileName);
        setButton(button, `Recuperado em ${parts.length} arquivo${parts.length > 1 ? 's' : ''}`, true);
        notify(`A exportação já havia sido concluída. ${resultSummary(parts, recovered.total || parts.reduce((sum, part) => sum + part.count, 0))}`, 'success');
        return;
      }
    } catch {}
    setButton(button, 'Gerar CSV para o Portal Postal', false);
    notify(error.message, 'error');
  }
}

async function handleHistoryDownload(button) {
  const exportIdValue = button.dataset.downloadExport || '';
  if (!exportIdValue) return;
  setButton(button, 'Preparando…', true);
  try {
    const file = await dataAction('portal.export.file', { campaignId: campaignId(), exportId: exportIdValue });
    const parts = downloadPortalCsvParts(file.content, file.fileName);
    notify(resultSummary(parts, file.total || parts.reduce((sum, part) => sum + part.count, 0)), 'success');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    setButton(button, 'Baixar CSV', false);
  }
}

function decorate() {
  const exportCard = document.querySelector('#base-export-card');
  const description = exportCard?.querySelector('.section-title p');
  if (description && !description.dataset.portalLimitCopy) {
    description.dataset.portalLimitCopy = '1';
    description.textContent = 'Depois da higienização, defina serviço e conteúdo. O download será dividido automaticamente em arquivos de até 1.000 cadastros, cada um com o cabeçalho do Portal Postal.';
  }

  document.querySelectorAll('[data-download-export]').forEach((button) => {
    if (!button.dataset.portalLimitTitle) {
      button.dataset.portalLimitTitle = '1';
      button.title = 'Se houver mais de 1.000 cadastros, o download será dividido automaticamente.';
    }
  });
}

document.addEventListener('click', (event) => {
  const generate = event.target.closest('#portal-export-run');
  if (generate) {
    event.preventDefault();
    event.stopImmediatePropagation();
    handleGenerate(generate);
    return;
  }

  const history = event.target.closest('[data-download-export]');
  if (history) {
    event.preventDefault();
    event.stopImmediatePropagation();
    handleHistoryDownload(history);
  }
}, true);

const observer = new MutationObserver(() => queueMicrotask(decorate));
observer.observe(document.documentElement, { childList: true, subtree: true });
decorate();
