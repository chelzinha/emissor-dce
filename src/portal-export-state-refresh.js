const ROOT = document.querySelector('#elections-app');
let refreshScheduled = false;

function scheduleStateRefresh() {
  if (refreshScheduled) return;
  const status = ROOT?.querySelector('.portal-export-resilient-status');
  if (!status || !/Arquivos prontos para o Portal Postal/i.test(status.textContent || '')) return;

  refreshScheduled = true;
  status.dataset.applicationStateRefresh = 'scheduled';
  window.setTimeout(() => window.location.reload(), 900);
}

const observer = new MutationObserver(scheduleStateRefresh);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true, characterData: true });
scheduleStateRefresh();
