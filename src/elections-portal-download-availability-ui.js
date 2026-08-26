import { dataAction } from './api.js';

const ROOT = document.querySelector('#elections-app');
let cacheCampaignId = '';
let cacheRecords = [];
let cachePromise = null;
let scheduled = false;

const campaignId = () => String(document.querySelector('#campaign-select')?.value || '');
const exportId = (row) => String(row?.ID || row?.id || '');
const exportFileId = (row) => String(row?.FILE_ID || row?.fileId || '');

function isPortalPage(page) {
  if (!page?.querySelector('[data-download-export]')) return false;
  const title = String(page.querySelector('h1')?.textContent || '');
  return /Portal Postal|Arquivos enviados ao Portal/i.test(title);
}

async function recordsForCampaign(id) {
  if (!id) return [];
  if (cacheCampaignId === id && cacheRecords.length) return cacheRecords;
  if (cachePromise && cacheCampaignId === id) return cachePromise;

  cacheCampaignId = id;
  cachePromise = dataAction('portal.exports.list', { campaignId: id })
    .then((rows) => {
      cacheRecords = Array.isArray(rows) ? rows : [];
      return cacheRecords;
    })
    .finally(() => { cachePromise = null; });
  return cachePromise;
}

function historicalBadge(button) {
  const badge = document.createElement('span');
  badge.className = 'status';
  badge.dataset.portalHistoricalRecord = 'true';
  badge.textContent = 'Registro histórico';
  badge.title = 'Esta operação foi importada apenas como histórico e não possui um arquivo CSV armazenado para download.';
  button.replaceWith(badge);
}

function addExplanation(page) {
  if (page.querySelector('[data-portal-history-explanation]')) return;
  const historical = page.querySelector('[data-portal-historical-record]');
  if (!historical) return;

  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.dataset.portalHistoryExplanation = 'true';
  notice.style.marginTop = '16px';
  notice.innerHTML = '<strong>Sobre os registros históricos:</strong> eles comprovam as quantidades de operações anteriores, mas os arquivos CSV originais não foram armazenados no sistema. Somente exportações geradas pelo aplicativo exibem o botão de download.';

  const card = historical.closest('.card');
  card?.insertAdjacentElement('afterend', notice);
}

async function decorate() {
  const page = ROOT?.querySelector('.page');
  if (!isPortalPage(page)) return;

  const pending = [...page.querySelectorAll('[data-download-export]:not([data-portal-download-checked])')];
  if (!pending.length) {
    addExplanation(page);
    return;
  }

  const records = await recordsForCampaign(campaignId());
  if (!page.isConnected) return;
  const byId = new Map(records.map((row) => [exportId(row), row]));

  pending.forEach((button) => {
    const row = byId.get(String(button.dataset.downloadExport || ''));
    button.dataset.portalDownloadChecked = 'true';
    if (row && !exportFileId(row)) historicalBadge(button);
  });
  addExplanation(page);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorate().catch((error) => console.warn('Não foi possível verificar a disponibilidade dos arquivos do Portal.', error));
  });
}

ROOT?.addEventListener('change', (event) => {
  if (event.target?.id !== 'campaign-select') return;
  cacheCampaignId = '';
  cacheRecords = [];
  cachePromise = null;
  schedule();
});

const observer = new MutationObserver(schedule);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
schedule();
