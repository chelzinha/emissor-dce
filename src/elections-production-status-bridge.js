const ROOT = document.querySelector('#elections-app');
const STATUS_CODE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

function technicalCode(chip) {
  const explicit = String(chip?.dataset?.statusCode || chip?.dataset?.systemCode || '').trim().toUpperCase();
  if (STATUS_CODE.test(explicit)) return explicit;
  const text = String(chip?.textContent || '').trim().toUpperCase();
  return STATUS_CODE.test(text) ? text : '';
}

function syncChip(chip) {
  const code = technicalCode(chip);
  if (code && chip.dataset.statusCode !== code) chip.dataset.statusCode = code;
}

function syncStatusCodes() {
  ROOT?.querySelectorAll('.status').forEach(syncChip);
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    syncStatusCodes();
  });
});

if (ROOT) {
  observer.observe(ROOT, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-system-code'],
  });
}

syncStatusCodes();

export { technicalCode };
