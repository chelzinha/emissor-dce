const ROOT = document.querySelector('#client-portal');

function applySimplifiedPortalRelease() {
  if (!ROOT) return;

  ROOT.querySelectorAll('[data-view="authorization"]').forEach((button) => button.remove());
  ROOT.querySelector('#fiscal')?.remove();

  const header = ROOT.querySelector('main header > strong');
  if (header?.textContent?.trim() === 'Autorizar DC-e') {
    const dashboardButton = ROOT.querySelector('[data-view="dashboard"]');
    dashboardButton?.click();
  }
}

const observer = new MutationObserver(() => queueMicrotask(applySimplifiedPortalRelease));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applySimplifiedPortalRelease();
