const ROOT = document.querySelector('#elections-app');

function nativeViewButton(view) {
  return ROOT?.querySelector(`.app-nav > button[data-view="${CSS.escape(String(view || ''))}"]`);
}

function activateNativeView(view) {
  const button = nativeViewButton(view);
  if (!button) return false;
  button.dispatchEvent(new MouseEvent('click', {
    bubbles: false,
    cancelable: true,
    view: window,
  }));
  return true;
}

document.addEventListener('click', (event) => {
  const proxy = event.target.closest?.('[data-operation-view]');
  if (!proxy || !ROOT?.contains(proxy)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    sessionStorage.removeItem('AGF_OPERATION_STAGE_FULL_1_11');
  } catch {}
  if (ROOT) ROOT.dataset.operationStage = '0';
  activateNativeView(proxy.dataset.operationView);
}, true);

export { activateNativeView };
