const ROOT = document.querySelector('#elections-app');

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function continueToProduction() {
  ROOT?.querySelector('.app-nav button[data-view="production"]')?.click();
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
  simplified.title = 'Cria o lote e segue diretamente para a produção da etiqueta unificada com Declaração Simplificada.';

  dce.disabled = false;
  setText(dce, 'Gerar DC-e');
  dce.title = 'Cria o lote DC-e, valida os dados fiscais na agência e depois libera a autorização do cliente com e-CNPJ A1.';

  const actions = simplified.closest('.actions');
  if (actions && !actions.querySelector('[data-document-mode-question]')) {
    const question = document.createElement('small');
    question.dataset.documentModeQuestion = 'true';
    question.className = 'document-mode-question';
    question.textContent = 'Escolha uma única modalidade. Depois da criação do lote, essa escolha não pode ser alterada.';
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
  button.textContent = 'Continuar no fluxo';
  button.title = 'A modalidade já foi escolhida. Continue para produção, impressão, entrega à operação, acompanhamento e relatórios.';
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

function processedSection(page) {
  const heading = [...(page?.querySelectorAll('h2') || [])]
    .find((node) => node.textContent?.trim() === 'Retornos já processados');
  return heading?.closest('.card') || null;
}

function configureReturnActions(page) {
  if (!page) return;
  const section = processedSection(page);
  const heading = section?.querySelector('h2');
  const subtitle = heading?.parentElement?.querySelector('p');

  setText(subtitle, 'Retornos com status Pronto aguardam a escolha entre Declaração Simplificada e DC-e. Essa escolha é a etapa 6 do fluxo.');

  section?.querySelectorAll('tbody tr').forEach((row) => {
    const status = normalizeStatus(row);
    if (status === 'READY') configureReadyRow(row);
    else if (status === 'IN_PRODUCTION') configureInProductionRow(row);
    else configureBlockedRow(row);
  });
}

function applyDocumentModeFlow() {
  if (!ROOT) return;
  const sectionHeading = [...ROOT.querySelectorAll('h2')]
    .find((node) => node.textContent?.trim() === 'Retornos já processados');
  const page = sectionHeading?.closest('.page');
  const section = sectionHeading?.closest('.card');
  if (!page || !section) return;

  if (!page.querySelector('[data-document-mode-note]')) {
    const note = document.createElement('div');
    note.className = 'notice document-mode-note';
    note.dataset.documentModeNote = 'true';
    note.style.marginBottom = '16px';
    note.innerHTML = '<strong>Qual documento será usado neste lote?</strong><p>Esta é a <b>etapa 6</b>. Escolha <b>Declaração Simplificada</b> para seguir diretamente à produção, ou <b>DC-e</b> para validar o lote na agência, liberar a autorização ao usuário final e aguardar a assinatura com o e-CNPJ A1 antes da impressão.</p>';
    section.insertAdjacentElement('beforebegin', note);
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
