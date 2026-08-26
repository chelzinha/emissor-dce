const ROOT = document.querySelector('#elections-app');
const KEY = 'AGF_OPERATIONS_RESUME_V1';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_RESTORE_ATTEMPTS = 120;

function clearResume() {
  try { sessionStorage.removeItem(KEY); } catch {}
}

function readResume() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!value || !value.savedAt || Date.now() - Number(value.savedAt) > MAX_AGE_MS) {
      clearResume();
      return null;
    }
    return value;
  } catch {
    clearResume();
    return null;
  }
}

function saveResume() {
  const view = ROOT?.querySelector('.app-nav button.active[data-view]')?.dataset.view || '';
  const campaignId = ROOT?.querySelector('#campaign-select')?.value || '';
  if (!view || !campaignId) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ view, campaignId, savedAt: Date.now() })); } catch {}
}

let restoring = false;
let finished = false;
let attempts = 0;
let scheduled = false;
let observer;

function finishRestore() {
  finished = true;
  observer?.disconnect();
}

function restoreOnce() {
  if (finished || restoring) return;
  const saved = readResume();
  if (!saved) {
    finishRestore();
    return;
  }

  const select = ROOT?.querySelector('#campaign-select');
  if (!select) {
    if (++attempts >= MAX_RESTORE_ATTEMPTS) {
      clearResume();
      finishRestore();
    }
    return;
  }

  const hasCampaign = [...select.options].some((option) => option.value === saved.campaignId);
  if (!hasCampaign) {
    clearResume();
    finishRestore();
    return;
  }

  if (select.value !== saved.campaignId) {
    restoring = true;
    select.value = saved.campaignId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    restoring = false;
    return;
  }

  const button = ROOT.querySelector(`.app-nav button[data-view="${CSS.escape(saved.view)}"]`);
  if (!button) {
    if (++attempts >= MAX_RESTORE_ATTEMPTS) {
      clearResume();
      finishRestore();
    }
    return;
  }

  clearResume();
  finishRestore();
  if (!button.classList.contains('active')) button.click();
}

function scheduleRestore() {
  if (finished || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    restoreOnce();
  });
}

window.addEventListener('beforeunload', saveResume);
ROOT?.addEventListener('click', (event) => {
  if (event.target.closest?.('#signout')) clearResume();
});

observer = new MutationObserver(scheduleRestore);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
scheduleRestore();
