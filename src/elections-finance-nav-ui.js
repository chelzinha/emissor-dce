const ROOT = document.querySelector('#elections-app');

function decorateFinanceNavigation() {
  const nav = ROOT?.querySelector('[data-operation-nav]');
  if (!nav) return;

  let button = nav.querySelector('[data-operation-view="finance"]');
  if (!button) {
    const settingsCaption = [...nav.querySelectorAll('.operation-nav-caption')]
      .find((node) => node.textContent?.trim() === 'CONFIGURAÇÕES');
    const caption = document.createElement('div');
    caption.className = 'operation-nav-caption settings finance';
    caption.textContent = 'GESTÃO';
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'operation-nav-settings operation-nav-finance';
    button.dataset.operationView = 'finance';
    button.textContent = 'Financeiro';
    if (settingsCaption) {
      settingsCaption.before(caption, button);
    } else {
      nav.append(caption, button);
    }
  }

  const active = Boolean(ROOT.querySelector('.finance-page'))
    || Boolean(ROOT.querySelector('.app-nav > [data-view="finance"].active'));
  button.classList.toggle('active', active);

  if (active) {
    ROOT.querySelector('.finance-page > .workflow-8-process')?.remove();
    ROOT.querySelector('.finance-page > .stage-context-note')?.remove();
  }
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    decorateFinanceNavigation();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
decorateFinanceNavigation();
