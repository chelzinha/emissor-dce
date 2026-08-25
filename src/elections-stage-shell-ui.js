import './elections-stage-shell-ui.css';

const ROOT = document.querySelector('#elections-app');
const STAGE_KEY = 'AGF_OPERATION_STAGE_FULL_1_11';
const STAGES = [
  [1, 'Preparação', 'bases', ''],
  [2, 'Portal Postal', 'portal', ''],
  [3, 'Retorno do Portal', 'returns', '#portal-return-upload-card'],
  [4, 'Configurar etiqueta', 'returns', '.return-label-setup'],
  [5, 'Auditar Data Matrix', 'returns', '#analyze-portal-return'],
  [6, 'Escolher documento', 'returns', '[data-document-mode-note]'],
  [7, 'Produção', 'production', '.production-documents'],
  [8, 'Impressão', 'production', '.production-ops-gates'],
  [9, 'Entrega à operação', 'production', '#internal-delivery-panel'],
  [10, 'Acompanhamento', 'tracking', ''],
  [11, 'Relatórios', 'reports', ''],
];
const STATUS_LABELS = Object.freeze({
  READY: 'Pronto', ACTIVE: 'Ativa', FINISHED: 'Finalizado', EXPORTED: 'Exportado',
  IN_PRODUCTION: 'Em produção', READY_FOR_UNIFIED_LABEL: 'Pronto para produção',
  REVIEW: 'Revisar', UPLOADING: 'Importando', CLEANING: 'Higienizando',
  AWAITING_DCE_PREPARATION: 'Aguardando preparação da DC-e', ERROR: 'Erro',
  REJECTED: 'Rejeitado', BLOCKED: 'Bloqueado', PLANNED: 'Planejado', DELIVERED: 'Entregue',
  PREPARED: 'Preparado', PROCESSING: 'Processando', PARTIAL: 'Parcial', AUTHORIZED: 'Autorizado',
  AUTO_VERIFIED: 'Autoverificado', VERIFIED: 'Verificado', TEXT_ONLY: 'Identificado pelo texto',
  MANUAL_REVIEW: 'Revisão manual', MISSING: 'Ausente', DIVERGENT: 'Divergente', RECEIVED: 'Recebida',
  DCE_PREPARED: 'DC-e preparada', DCE_RESERVED: 'DC-e em autorização', DCE_PARTIAL: 'DC-e parcial',
});

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function sourceButton(view) {
  return ROOT?.querySelector(`.app-nav button[data-view="${CSS.escape(view)}"]`);
}

function activeView() {
  return ROOT?.querySelector('.app-nav button.active[data-view]')?.dataset.view || 'dashboard';
}

function readStage() {
  try {
    const value = Number(sessionStorage.getItem(STAGE_KEY) || ROOT?.dataset.operationStage || 0);
    return value >= 1 && value <= 11 ? value : 0;
  } catch {
    const value = Number(ROOT?.dataset.operationStage || 0);
    return value >= 1 && value <= 11 ? value : 0;
  }
}

function saveStage(number) {
  if (!ROOT) return;
  ROOT.dataset.operationStage = String(number || 0);
  try {
    if (number) sessionStorage.setItem(STAGE_KEY, String(number));
    else sessionStorage.removeItem(STAGE_KEY);
  } catch {}
}

function inferProductionStage() {
  const gates = [...(ROOT?.querySelectorAll('.production-gate') || [])];
  const find = (label) => gates.find((gate) => gate.querySelector('span')?.textContent?.trim() === label);
  const handoff = find('Entrega à operação') || find('Entrega interna');
  const print = find('Impressão');
  if (handoff?.classList.contains('ok')) return 9;
  const match = (print?.querySelector('strong')?.textContent || '').match(/([\d.]+)\s*\/\s*([\d.]+)/);
  const printed = match ? Number(match[1].replace(/\D/g, '') || 0) : 0;
  return print?.classList.contains('ok') || printed > 0 ? 8 : 7;
}

function stageForView(view) {
  const selected = readStage();
  const definition = STAGES.find((item) => item[0] === selected);
  if (definition?.[2] === view) return selected;
  if (view === 'bases') return 1;
  if (view === 'portal') return 2;
  if (view === 'returns') return 3;
  if (view === 'production') return inferProductionStage();
  if (view === 'tracking') return 10;
  if (view === 'reports') return 11;
  return 0;
}

function focusStage(stage) {
  if (!stage?.[3]) return;
  let tries = 0;
  const find = () => {
    const target = ROOT?.querySelector(stage[3]);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus?.({ preventScroll: true });
      return;
    }
    if (++tries < 16) setTimeout(find, 100);
  };
  setTimeout(find, 80);
}

function navigateStage(number) {
  const stage = STAGES.find((item) => item[0] === Number(number));
  if (!stage) return;
  const currentView = activeView();
  saveStage(stage[0]);
  if (currentView === stage[2]) {
    decorate();
    focusStage(stage);
    return;
  }
  sourceButton(stage[2])?.click();
  focusStage(stage);
}

function navMarkup(view, stage) {
  return `<div class="operation-nav-ui" data-operation-nav>
    <button type="button" class="operation-nav-home ${view === 'dashboard' ? 'active' : ''}" data-operation-view="dashboard">Dashboard</button>
    <div class="operation-nav-caption">FLUXO COMPLETO DA OPERAÇÃO</div>
    ${STAGES.map(([number, label]) => `<button type="button" class="operation-stage-link ${stage === number ? 'active' : ''}" data-operation-stage="${number}"><b>${number}</b><span>${label}</span></button>`).join('')}
    <div class="operation-nav-caption settings">CONFIGURAÇÕES</div>
    <button type="button" class="operation-nav-settings ${view === 'campaigns' ? 'active' : ''}" data-operation-view="campaigns">Operações</button>
  </div>`;
}

function decorateNav() {
  const nav = ROOT?.querySelector('.app-nav');
  if (!nav) return;
  nav.querySelectorAll(':scope > button[data-view]').forEach((button) => button.classList.add('source-nav-button'));
  const view = activeView();
  const stage = stageForView(view);
  const signature = `${view}:${stage}`;
  const current = nav.querySelector('[data-operation-nav]');
  if (current?.dataset.signature === signature) return;
  current?.remove();
  nav.insertAdjacentHTML('beforeend', navMarkup(view, stage));
  nav.querySelector('[data-operation-nav]').dataset.signature = signature;
  setText(ROOT?.querySelector('.campaign-picker > strong'), 'Operação');
  const brand = ROOT?.querySelector('.app-brand');
  setText(brand?.querySelector('strong'), 'Operações Postais');
  setText(brand?.querySelector('small'), 'Painel da agência');
}

function timelineMarkup(active) {
  return `<section class="workflow-8-process" data-workflow-stage="${active}">
    <div class="workflow-8-head"><strong>PASSO A PASSO DA OPERAÇÃO</strong><span>Fluxo completo, da preparação da base aos relatórios finais.</span></div>
    <div class="workflow-8-steps">${STAGES.map(([number, label]) => `<button type="button" class="workflow-8-step ${number < active ? 'done' : number === active ? 'current' : 'pending'}" data-process-stage="${number}"><b>${number}</b><span>${label}</span></button>`).join('')}</div>
  </section>`;
}

function decorateTimeline() {
  const page = ROOT?.querySelector('.page');
  const head = page?.querySelector(':scope > .page-head');
  const view = activeView();
  if (!page || !head) return;
  page.querySelector(':scope > .workflow-8-process')?.remove();
  if (['dashboard', 'campaigns'].includes(view)) return;
  head.insertAdjacentHTML('afterend', timelineMarkup(stageForView(view)));
}

function findProcessedReturnsCard(page) {
  const heading = [...(page?.querySelectorAll('h2') || [])].find((node) => node.textContent?.trim() === 'Retornos já processados');
  return heading?.closest('.card') || null;
}

function show(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle('stage-hidden', !visible);
}

function setStageContext(page, message, type = '') {
  page.querySelector(':scope > .stage-context-note')?.remove();
  if (!message) return;
  const note = document.createElement('div');
  note.className = `notice stage-context-note ${type}`.trim();
  note.innerHTML = message;
  const timeline = page.querySelector(':scope > .workflow-8-process');
  const head = page.querySelector(':scope > .page-head');
  (timeline || head)?.insertAdjacentElement('afterend', note);
}

function applyReturnsStage(page, stage) {
  const upload = page.querySelector('#portal-return-upload-card');
  const processed = findProcessedReturnsCard(page);
  const documentNote = page.querySelector('[data-document-mode-note]');
  const uploadGrid = upload?.querySelector('.return-upload-grid');
  const setup = upload?.querySelector('.return-label-setup');
  const auditRow = upload?.querySelector('.return-link-row');
  const live = upload?.querySelector('#portal-return-live-status');
  const analysis = upload?.querySelector('#portal-return-analysis');
  const csvSelected = Boolean(upload?.querySelector('#portal-return-csv')?.files?.[0]);
  const pdfSelected = Boolean(upload?.querySelector('#portal-return-pdfs')?.files?.length);
  const auditButton = upload?.querySelector('#analyze-portal-return');
  const setupReady = Boolean(auditButton && !auditButton.disabled);

  show(processed, stage === 6);
  show(documentNote, stage === 6);
  show(upload, [3, 4, 5].includes(stage));
  if (!upload) return;

  if (stage === 3) {
    show(uploadGrid, true);
    show(setup, false);
    show(auditRow, false);
    show(live, false);
    show(analysis, false);
    setStageContext(page, '<strong>Etapa 3 - Retorno do Portal.</strong> Selecione o CSV das postagens e os PDFs originais das etiquetas. Depois avance para configurar o modelo da etiqueta.');
    return;
  }

  if (stage === 4) {
    show(uploadGrid, !pdfSelected);
    show(setup, true);
    show(auditRow, false);
    show(live, false);
    show(analysis, false);
    setStageContext(page, pdfSelected
      ? '<strong>Etapa 4 - Configurar etiqueta.</strong> Marque a região do Data Matrix e carregue a chancela. Os arquivos escolhidos na etapa 3 continuam selecionados.'
      : '<strong>Etapa 4 - Configurar etiqueta.</strong> O PDF não está selecionado nesta sessão. Selecione novamente os arquivos abaixo e configure o modelo.', 'warn');
    return;
  }

  if (stage === 5) {
    show(uploadGrid, !(csvSelected && pdfSelected));
    show(setup, !setupReady);
    show(auditRow, true);
    show(live, true);
    show(analysis, true);
    setStageContext(page, setupReady && csvSelected && pdfSelected
      ? '<strong>Etapa 5 - Auditar Data Matrix.</strong> Execute a auditoria do CSV + PDF. Só registre o retorno quando os SROs e Data Matrix estiverem consistentes.'
      : '<strong>Etapa 5 - Auditar Data Matrix.</strong> Ainda faltam arquivos selecionados ou a configuração da etiqueta. Complete o pré-requisito exibido abaixo antes de auditar.', 'warn');
    return;
  }

  if (stage === 6) {
    setStageContext(page, '<strong>Etapa 6 - Escolher documento.</strong> Para cada retorno com status Pronto, escolha <b>Declaração Simplificada</b> ou <b>DC-e</b>. Se escolher DC-e, a agência valida o lote e o cliente autoriza com o próprio e-CNPJ A1 antes da impressão.');
  }
}

function applyProductionStage(page, stage) {
  const batchGrid = page.querySelector(':scope > .grid.two');
  const delivery = page.querySelector('#internal-delivery-panel');
  show(batchGrid, stage !== 9);
  show(delivery, stage === 9);
  if (stage === 7) {
    setStageContext(page, '<strong>Etapa 7 - Produção.</strong> Declaração Simplificada segue diretamente. Lotes DC-e passam pela validação fiscal da agência, autorização do cliente e só então voltam para gerar a etiqueta unificada.');
  } else if (stage === 8) {
    setStageContext(page, '<strong>Etapa 8 - Impressão.</strong> Gere os PDFs finais dos volumes e registre a quantidade efetivamente impressa. A entrega só é liberada após a impressão integral.');
  } else if (stage === 9) {
    setStageContext(page, '<strong>Etapa 9 - Entrega à operação.</strong> Vincule os lotes da mesma entrega, escolha a data, numere os volumes e registre quem recebeu.');
  }
}

function decoratePage() {
  const page = ROOT?.querySelector('.page');
  const head = page?.querySelector(':scope > .page-head');
  if (!page || !head) return;
  const view = activeView();
  const stage = stageForView(view);

  if (view === 'campaigns') {
    setText(head.querySelector('.eyebrow'), 'CONFIGURAÇÕES');
    setText(head.querySelector('h1'), 'Operações');
    setText(head.querySelector('p:not(.eyebrow)'), 'Cadastre e edite os dados gerais da operação, endereço, remetente e acesso do usuário final.');
    setText(head.querySelector('#new-campaign'), 'Nova operação');
    ROOT.querySelectorAll('[data-open-campaign]').forEach((button) => setText(button, 'Selecionar operação'));
    return;
  }

  if (view === 'bases') {
    setText(head.querySelector('.eyebrow'), 'ETAPA 1');
    setText(head.querySelector('h1'), 'Preparação');
    setText(head.querySelector('p:not(.eyebrow)'), 'Receba a base completa, higienize, revise pendências e defina os dados da postagem antes de exportar ao Portal Postal.');
    setStageContext(page, '');
    return;
  }

  if (view === 'portal') {
    setText(head.querySelector('.eyebrow'), 'ETAPA 2');
    setText(head.querySelector('h1'), 'Portal Postal');
    setText(head.querySelector('p:not(.eyebrow)'), 'Baixe os arquivos preparados, importe no Portal Postal e retorne com o CSV das postagens e os PDFs originais das etiquetas.');
    setStageContext(page, '');
    return;
  }

  if (view === 'returns') {
    setText(head.querySelector('.eyebrow'), `ETAPA ${stage}`);
    const titles = { 3: 'Retorno do Portal', 4: 'Configurar etiqueta', 5: 'Auditar Data Matrix', 6: 'Escolher documento' };
    const descriptions = {
      3: 'Importe os arquivos devolvidos pelo Portal Postal.',
      4: 'Defina a região do Data Matrix e a chancela que serão reutilizadas na etiqueta final.',
      5: 'Cruze CSV, PDFs e Data Matrix por SRO e registre somente um retorno consistente.',
      6: 'Escolha Declaração Simplificada ou DC-e antes de criar o lote de produção.',
    };
    setText(head.querySelector('h1'), titles[stage] || 'Retorno do Portal');
    setText(head.querySelector('p:not(.eyebrow)'), descriptions[stage] || descriptions[3]);
    page.querySelectorAll('.notice.warn').forEach((notice) => {
      if (/próximo bloco|leitura direta dos PDFs será conectada/i.test(notice.textContent || '')) notice.remove();
    });
    applyReturnsStage(page, stage);
    return;
  }

  if (view === 'production') {
    setText(head.querySelector('.eyebrow'), `ETAPA ${stage}`);
    setText(head.querySelector('h1'), stage === 7 ? 'Produção' : stage === 8 ? 'Impressão' : 'Entrega à operação');
    setText(head.querySelector('p:not(.eyebrow)'), stage === 7
      ? 'Conclua o caminho documental escolhido e monte a etiqueta unificada.'
      : stage === 8
        ? 'Gere os arquivos finais e confirme a impressão do lote.'
        : 'Organize os volumes e registre a entrega interna para a operação.');
    applyProductionStage(page, stage);
    return;
  }

  if (view === 'tracking') {
    setText(head.querySelector('.eyebrow'), 'ETAPA 10');
    setText(head.querySelector('h1'), 'Acompanhamento');
    setText(head.querySelector('p:not(.eyebrow)'), 'Acompanhe postagem, rastreamento por SRO, entregas, ocorrências e devoluções.');
    setStageContext(page, '<strong>Etapa 10 - Acompanhamento.</strong> Atualize o rastreamento e acompanhe a evolução postal dos objetos após a entrega à operação.');
    return;
  }

  if (view === 'reports') {
    setText(head.querySelector('.eyebrow'), 'ETAPA 11');
    setText(head.querySelector('h1'), 'Relatórios');
    setText(head.querySelector('p:not(.eyebrow)'), 'Consolide saldos, movimentação diária, DC-e, postagem e situação postal da operação.');
    setStageContext(page, '<strong>Etapa 11 - Relatórios.</strong> Consulte o fechamento operacional, filtre o período e exporte CSV ou PDF.');
  }
}

function translateStatuses() {
  const base = activeView() === 'bases';
  ROOT?.querySelectorAll('.status').forEach((chip) => {
    let code = chip.dataset.statusCode || '';
    const raw = String(chip.textContent || '').trim();
    if (!code && STATUS_LABELS[raw.toUpperCase()]) chip.dataset.statusCode = code = raw.toUpperCase();
    if (!code || !STATUS_LABELS[code]) return;
    chip.title = `Código interno: ${code}`;
    chip.classList.toggle('status-visual-translation', base);
    if (!base) setText(chip, STATUS_LABELS[code]);
  });
}

function decorateProduction() {
  if (activeView() !== 'production') return;
  ROOT?.querySelectorAll('.page .card').forEach((card) => {
    const volumeButton = card.querySelector('[data-volumes]');
    const heading = card.querySelector('h2');
    if (!volumeButton || !heading) return;
    if (/Declaração simplificada|DC-e com e-CNPJ/i.test(heading.textContent || '')) setText(heading, 'Lote de produção');
    setText(volumeButton, 'Ver blocos de impressão');
    card.querySelectorAll('th').forEach((th) => {
      if (th.textContent.trim().toUpperCase() === 'VOLUME') setText(th, 'Parte de impressão');
    });
    const mode = [...card.querySelectorAll('.matrix-box')].find((box) => box.querySelector('span')?.textContent?.trim() === 'Modo' || box.querySelector('span')?.textContent?.trim() === 'Documento');
    if (mode) {
      setText(mode.querySelector('span'), 'Documento');
      if (/Simpl\.?/i.test(mode.querySelector('strong')?.textContent || '')) setText(mode.querySelector('strong'), 'Simplificada');
    }
    setText(card.querySelector('.production-ops-title strong'), 'Progresso do lote');
    const labels = { 'Modelo da etiqueta': 'Etiqueta configurada', 'Data Matrix 100%': 'Auditoria do Data Matrix', 'Entrega interna': 'Entrega à operação' };
    card.querySelectorAll('.production-gate span').forEach((span) => {
      if (labels[span.textContent.trim()]) setText(span, labels[span.textContent.trim()]);
    });
    card.querySelectorAll('[data-op="handoff"],[data-op="protocol"]').forEach((button) => {
      button.hidden = true;
      button.disabled = true;
    });
    const sender = card.querySelector('[data-configure-sender]');
    if (sender && !sender.dataset.redirectSettings) {
      const button = sender.cloneNode(true);
      button.dataset.redirectSettings = '1';
      button.removeAttribute('data-configure-sender');
      button.textContent = 'Cadastrar remetente em Operações';
      button.onclick = () => {
        saveStage(0);
        sourceButton('campaigns')?.click();
      };
      sender.replaceWith(button);
    }
    card.querySelectorAll('.production-volume-item').forEach((item) => {
      const label = item.querySelector('span');
      if (label) setText(label, label.textContent.replace(/^Volume\s+/i, 'Parte de impressão '));
      setText(item.querySelector('[data-generate-volume]'), 'Gerar arquivo de impressão');
    });
  });
}

function maybeAdvanceAfterReturnSave() {
  const toast = document.querySelector('#elections-toast');
  const message = String(toast?.textContent || '');
  if (toast?.classList.contains('success') && message.startsWith('Retorno registrado:')) saveStage(6);
}

function decorate() {
  maybeAdvanceAfterReturnSave();
  decorateNav();
  decorateTimeline();
  decoratePage();
  translateStatuses();
  decorateProduction();
}

ROOT?.addEventListener('click', (event) => {
  const stage = event.target.closest('[data-operation-stage],[data-process-stage]');
  if (stage) {
    event.preventDefault();
    navigateStage(stage.dataset.operationStage || stage.dataset.processStage);
    return;
  }
  const view = event.target.closest('[data-operation-view]');
  if (view) {
    event.preventDefault();
    saveStage(0);
    sourceButton(view.dataset.operationView)?.click();
  }
});

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorate();
  });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
decorate();
