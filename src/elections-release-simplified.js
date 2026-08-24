const ROOT = document.querySelector('#elections-app');

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function continueToProduction() {
  const productionNav = ROOT?.querySelector('[data-view="production"]');
  if (productionNav) productionNav.click();
}

function normalizeStatus(row) {
  return String(row?.querySelector('.status')?.textContent || '').trim().toUpperCase();
}

function simplifiedButtonForRow(row) {
  return row?.querySelector('[data-mode="SIMPLIFIED_DECLARATION"], [data-simplified-return-action]') || null;
}

function replaceWithProductionButton(button) {
  if (!button || button.dataset.simplifiedReturnAction === 'continue') return button;
  const next = button.cloneNode(true);
  next.removeAttribute('data-mode');
  next.removeAttribute('data-return');
  next.dataset.simplifiedReturnAction = 'continue';
  next.disabled = false;
  next.textContent = 'Continuar na Produção';
  next.title = 'O lote já está em produção. Clique para continuar até a geração e impressão dos PDFs unificados.';
  next.addEventListener('click', continueToProduction);
  button.replaceWith(next);
  return next;
}

function configureReturnActions(page) {
  if (!page) return;
  const sectionHeading = [...page.querySelectorAll('h2')].find((node) => node.textContent?.trim() === 'Retornos já processados');
  const section = sectionHeading?.closest('.card');
  const subtitle = sectionHeading?.parentElement?.querySelector('p');
  setText(subtitle, 'READY permite escolher a Declaração Simplificada. IN_PRODUCTION indica que o lote já foi criado; a geração e impressão dos PDFs acontece em Produção.');

  section?.querySelectorAll('tbody tr').forEach((row) => {
    const status = normalizeStatus(row);
    let button = simplifiedButtonForRow(row);
    if (!button) return;

    if (status === 'READY') {
      if (button.dataset.simplifiedReturnAction === 'continue') return;
      button.disabled = false;
      button.textContent = 'Usar Declaração Simplificada';
      button.title = 'Seleciona a modalidade e cria o lote de produção. Os PDFs são gerados na etapa Produção.';
      return;
    }

    if (status === 'IN_PRODUCTION') {
      button = replaceWithProductionButton(button);
      return;
    }

    if (button.dataset.simplifiedReturnAction === 'continue') return;
    button.disabled = true;
    button.textContent = 'Aguardando retorno READY';
    button.title = 'O retorno precisa ficar READY antes de escolher a modalidade documental.';
  });
}

function applySimplifiedRelease() {
  if (!ROOT) return;

  ROOT.querySelectorAll('[data-mode="DCE_AUTHORIZED"]').forEach((button) => button.remove());
  ROOT.querySelectorAll('.card').forEach((card) => {
    const heading = card.querySelector('h2')?.textContent?.trim() || '';
    if (heading === 'DC-e com e-CNPJ') card.remove();
  });
  ROOT.querySelectorAll('.report-dce').forEach((card) => card.remove());

  const accessSubtitle = ROOT.querySelector('#client-access-card .section-title p');
  if (accessSubtitle && /Autorizar DC-e/i.test(accessSubtitle.textContent || '')) {
    setText(accessSubtitle, 'Crie ou vincule o usuário que acessará o Dashboard e o Simulador do Portal do Cliente.');
  }

  ROOT.querySelectorAll('.return-footnote').forEach((note) => {
    if (/DC-e/i.test(note.textContent || '')) {
      note.innerHTML = 'O registro pode ser salvo com pendências para auditoria, mas somente um retorno <strong>READY</strong> será liberado para Declaração Simplificada.';
    }
  });

  const returnHeading = [...ROOT.querySelectorAll('h1')].find((node) => node.textContent?.trim() === 'PDF + CSV das postagens');
  const page = returnHeading?.closest('.page');
  if (page && !page.querySelector('[data-simplified-release-note]')) {
    const note = document.createElement('div');
    note.className = 'notice';
    note.dataset.simplifiedReleaseNote = 'true';
    note.style.marginBottom = '16px';
    note.innerHTML = '<strong>Versão operacional atual:</strong> Declaração Simplificada. Depois de escolher essa modalidade, a etiqueta unificada é gerada e impressa na etapa Produção.';
    const firstCard = page.querySelector(':scope > .card');
    if (firstCard) page.insertBefore(note, firstCard); else page.appendChild(note);
  }
  configureReturnActions(page);
}

const observer = new MutationObserver(() => queueMicrotask(applySimplifiedRelease));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applySimplifiedRelease();
