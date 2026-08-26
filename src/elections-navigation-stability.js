const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';
const DYNAMIC_STAGE_VIEWS = Object.freeze({
  10: 'tracking',
  11: 'reports',
});

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

function saveOperationStage(stage) {
  if (ROOT) ROOT.dataset.operationStage = String(stage || 0);
  try {
    if (stage) sessionStorage.setItem(STAGE_KEY, String(stage));
    else sessionStorage.removeItem(STAGE_KEY);
  } catch {}
}

function activateNativeViewWhenReady(view, attempts = 30) {
  let remaining = attempts;
  const tryActivate = () => {
    if (activateNativeView(view)) return;
    remaining -= 1;
    if (remaining > 0) setTimeout(tryActivate, 50);
  };
  tryActivate();
}

document.addEventListener('click', (event) => {
  const stageProxy = event.target.closest?.('[data-operation-stage],[data-process-stage]');
  if (!stageProxy || !ROOT?.contains(stageProxy)) return;

  const stage = Number(stageProxy.dataset.operationStage || stageProxy.dataset.processStage || 0);
  const view = DYNAMIC_STAGE_VIEWS[stage];
  if (!view || nativeViewButton(view)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  saveOperationStage(stage);
  activateNativeViewWhenReady(view);
}, true);

document.addEventListener('click', (event) => {
  const proxy = event.target.closest?.('[data-operation-view]');
  if (!proxy || !ROOT?.contains(proxy)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  saveOperationStage(0);
  activateNativeView(proxy.dataset.operationView);
}, true);

export { activateNativeView };
