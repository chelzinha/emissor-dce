const ROOT = document.querySelector('#elections-app');

function setText(node, value) { if (node && node.textContent !== value) node.textContent = value; }
function continueToProduction() { ROOT?.querySelector('.app-nav button.source-nav-button[data-view="production"], .app-nav button[data-view="production"]')?.click(); }
function normalizeStatus(row) {
  const chip = row?.querySelector('.status');
  return String(chip?.dataset.statusCode || chip?.textContent || '').trim().toUpperCase();
}
function simplifiedButtonForRow(row) { return row?.querySelector('[data-mode="SIMPLIFIED_DECLARATION"], [data-simplified-return-action]') || null; }
function replaceWithProductionButton(button) {
  if (!button || button.dataset.simplifiedReturnAction === 'continue') return button;
  const next = button.cloneNode(true);
  next.removeAttribute('data-mode');
  next.removeAttribute('data-return');
  next.dataset.simplifiedReturnAction = 'continue';
  next.disabled = false;
  next.textContent = 'Continuar na Produção';
  next.title = 'O lote já foi criado. Continue para a montagem, teste e impressão da etiqueta unificada.';
  next.addEventListener('click', continueToProduction);
  button.replaceWith(next);
  return next;
}
function configureReturnActions(page) {
  if (!page) return;
  const sectionHeading = [...page.querySelectorAll('h2')].find((node) => node.textContent?.trim() === 'Retornos já processados');
  const section = sectionHeading?.closest('.card');
  const subtitle = sectionHeading?.parentElement?.querySelector('p');
  setText(subtitle, 'Retornos prontos podem seguir para a Declaração Simplificada. Quando o lote já está em produção, use o botão para continuar.');
  section?.querySelectorAll('tbody tr').forEach((row) => {
    const status = normalizeStatus(row);
    let button = simplifiedButtonForRow(row);
    if (!button) return;
    if (status === 'READY') {
      if (button.dataset.simplifiedReturnAction === 'continue') return;
      button.disabled = false;
      button.textContent = 'Usar Declaração Simplificada';
      button.title = 'Cria o lote de produção. A etiqueta unificada será montada na etapa Produção.';
      return;
    }
    if (status === 'IN_PRODUCTION') { replaceWithProductionButton(button); return; }
    if (button.dataset.simplifiedReturnAction === 'continue') return;
    button.disabled = true;
    button.textContent = 'Aguardando liberação';
    button.title = 'Conclua as pendências do retorno antes de seguir.';
  });
}
function applySimplifiedRelease() {
  if (!ROOT) return;
  ROOT.querySelectorAll('[data-mode="DCE_AUTHORIZED"]').forEach((button) => button.remove());
  ROOT.querySelectorAll('.card').forEach((card) => { if (card.querySelector('h2')?.textContent?.trim() === 'DC-e com e-CNPJ') card.remove(); });
  ROOT.querySelectorAll('.report-dce').forEach((card) => card.remove());
  ROOT.querySelectorAll('.return-footnote').forEach((note) => {
    if (/DC-e/i.test(note.textContent || '')) note.innerHTML = 'O registro pode ser salvo com pendências para auditoria, mas somente um retorno <strong>pronto</strong> será liberado para Declaração Simplificada.';
  });
  const returnHeading = [...ROOT.querySelectorAll('h1')].find((node) => node.textContent?.trim() === 'PDF + CSV das postagens');
  const page = returnHeading?.closest('.page');
  if (page && !page.querySelector('[data-simplified-release-note]')) {
    const note = document.createElement('div');
    note.className = 'notice';
    note.dataset.simplifiedReleaseNote = 'true';
    note.style.marginBottom = '16px';
    note.innerHTML = '<strong>Modalidade operacional atual:</strong> Declaração Simplificada. Depois da auditoria, a etiqueta unificada é montada e impressa na etapa Produção.';
    const firstCard = page.querySelector(':scope > .card');
    if (firstCard) page.insertBefore(note, firstCard); else page.appendChild(note);
  }
  configureReturnActions(page);
}
const observer = new MutationObserver(() => queueMicrotask(applySimplifiedRelease));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applySimplifiedRelease();
