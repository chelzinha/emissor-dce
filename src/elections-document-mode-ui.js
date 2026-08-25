const ROOT = document.querySelector('#elections-app');

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function continueToProduction() {
  ROOT?.querySelector('.app-nav button.source-nav-button[data-view="production"], .app-nav button[data-view="production"]')?.click();
}

function normalizeStatus(row) {
  const chip = row?.querySelector('.status');
  return String(chip?.dataset.statusCode || chip?.textContent || '').trim().toUpperCase();
}

function actionButtons(row) {
  return {
    simplified: row?.querySelector('[data-mode="SIMPLIFIED_DECLARATION"]') || null,
    dce: row?.querySelector('[data-mode="DCE_AUTHORIZED"]') || null,
  };
}

function configureReadyRow(row) {
  const { simplified, dce } = actionButtons(row);
  if (!simplified || !dce) return;

  simplified.disabled = false;
  setText(simplified, 'Gerar Declaração Simplificada');
  simplified.title = 'Cria o lote e libera a produção da etiqueta unificada com a Declaração Simplificada.';

  dce.disabled = false;
  setText(dce, 'Preparar lote para DC-e');
  dce.title = 'Cria o lote fiscal para validação da agência e posterior autorização pelo cliente com o próprio e-CNPJ A1.';

  const actions = simplified.closest('.actions');
  if (actions && !actions.querySelector('[data-document-mode-question]')) {
    const question = document.createElement('small');
    question.dataset.documentModeQuestion = 'true';
    question.className = 'document-mode-question';
    question.textContent = 'Escolha uma única modalidade para este retorno.';
    actions.appendChild(question);
  }
}

function configureInProductionRow(row) {
  const { simplified, dce } = actionButtons(row);
  const actions = simplified?.closest('.actions') || dce?.closest('.actions');
  if (!actions || actions.dataset.documentModeState === 'continue') return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.dataset.documentModeContinue = 'true';
  button.textContent = 'Continuar na Produção';
  button.title = 'A modalidade já foi escolhida para este retorno. Continue para impressão, entrega à operação, acompanhamento e relatórios.';
  button.addEventListener('click', continueToProduction);

  actions.replaceChildren(button);
  actions.dataset.documentModeState = 'continue';
}

function configureBlockedRow(row) {
  const { simplified, dce } = actionButtons(row);
  for (const button of [simplified, dce]) {
    if (!button) continue;
    button.disabled = true;
    button.title = 'Conclua as pendências do retorno antes de escolher a modalidade documental.';
  }
}

function configureReturnActions(page) {
  if (!page) return;
  const sectionHeading = [...page.querySelectorAll('h2')]
    .find((node) => node.textContent?.trim() === 'Retornos já processados');
  const section = sectionHeading?.closest('.card');
  const subtitle = sectionHeading?.parentElement?.querySelector('p');

  setText(subtitle, 'Quando o retorno estiver pronto, escolha Declaração Simplificada ou DC-e. A modalidade fica vinculada ao lote e não pode ser trocada depois da criação.');

  section?.querySelectorAll('tbody tr').forEach((row) => {
    const status = normalizeStatus(row);
    if (status === 'READY') configureReadyRow(row);
    else if (status === 'IN_PRODUCTION') configureInProductionRow(row);
    else configureBlockedRow(row);
  });
}

function applyDocumentModeFlow() {
  if (!ROOT) return;

  const returnHeading = [...ROOT.querySelectorAll('h1')]
    .find((node) => node.textContent?.trim() === 'PDF + CSV das postagens');
  const page = returnHeading?.closest('.page');
  if (!page) return;

  if (!page.querySelector('[data-document-mode-note]')) {
    const note = document.createElement('div');
    note.className = 'notice';
    note.dataset.documentModeNote = 'true';
    note.style.marginBottom = '16px';
    note.innerHTML = '<strong>Qual documento será usado neste lote?</strong><p>Escolha <b>Declaração Simplificada</b> para seguir diretamente à produção, ou <b>DC-e</b> para validar os dados fiscais, liberar o lote ao cliente e aguardar a autorização com o e-CNPJ A1 antes da impressão.</p>';
    const firstCard = page.querySelector(':scope > .card');
    if (firstCard) page.insertBefore(note, firstCard);
    else page.appendChild(note);
  }

  configureReturnActions(page);
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyDocumentModeFlow();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applyDocumentModeFlow();
