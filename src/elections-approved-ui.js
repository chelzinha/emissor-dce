const ROOT = document.querySelector('#elections-app');

const NAV_LABELS = {
  dashboard: 'Dashboard', campaigns: 'Operações', bases: 'Preparação', portal: 'Portal Postal',
  returns: 'Retorno do Portal', production: 'Produção', tracking: 'Acompanhamento',
};
const VIEW_STAGE = { dashboard: 0, campaigns: 0, bases: 1, portal: 3, returns: 4, production: 5, tracking: 9 };
const STAGES = [
  [1, 'Receber base', 'violet'], [2, 'Higienizar', 'violet'], [3, 'Exportar Portal', 'violet'],
  [4, 'Retorno Portal', 'orange'], [5, 'Preparar documentos', 'orange'], [6, 'Gerar volumes', 'orange'],
  [7, 'Impressão', 'orange'], [8, 'Entrega à operação', 'green'], [9, 'Postagem', 'green'],
  [10, 'Em trânsito', 'green'], [11, 'Entregues', 'green'],
];

function setText(node, value) { if (node && node.textContent !== value) node.textContent = value; }
function numberFromText(text) { const digits = String(text || '').replace(/\D/g, ''); return Number(digits || 0); }
function formatNumber(value) { return new Intl.NumberFormat('pt-BR').format(Number(value || 0)); }
function activeView() { return document.querySelector('.app-nav button.active')?.dataset.view || 'dashboard'; }

function baseProgress() {
  const rows = [...(ROOT?.querySelectorAll('tbody tr') || [])].filter((row) => row.querySelector('[data-clean]') && !row.hidden);
  if (!rows.length) return { stage: 1, label: 'Importe uma base para continuar', action: '', target: '', disabled: true };
  let pending = null, review = null, ready = null, exported = null;
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    const total = numberFromText(cells[2]?.textContent);
    const cleanReady = numberFromText(cells[3]?.textContent);
    const cleanReview = numberFromText(cells[4]?.textContent);
    const status = cells[1]?.textContent?.trim().toUpperCase() || '';
    const target = row.querySelector('[data-clean]')?.dataset.clean || '';
    if (!target || !total) continue;
    const remaining = Math.max(0, total - cleanReady - cleanReview);
    const isExported = row.dataset.baseExported === '1' || status === 'EXPORTED';
    if (!pending && remaining > 0) pending = { target };
    if (!review && cleanReview > 0) review = { target };
    if (!ready && !isExported && cleanReady === total && cleanReview === 0) ready = { target };
    if (!exported && isExported) exported = { target };
  }
  if (pending) return { stage: 2, label: 'Higienizar base', action: 'clean', target: pending.target, disabled: false };
  if (review) return { stage: 2, label: 'Revisar pendências', action: 'review', target: review.target, disabled: false };
  if (ready) return { stage: 3, label: 'Definir postagem e exportar', action: 'export', target: ready.target, disabled: false };
  if (exported) return { stage: 3, label: 'Seguir para Portal Postal', action: 'portal', target: exported.target, disabled: false };
  return { stage: 2, label: 'Higienizar base', action: '', target: '', disabled: true };
}

function productionProgress() {
  const gates = [...(ROOT?.querySelectorAll('.production-gate') || [])];
  if (!gates.length) return 5;
  const gate = (label) => gates.find((item) => item.querySelector('span')?.textContent?.trim() === label);
  const handoff = gate('Entrega interna');
  const print = gate('Impressão');
  const labelTest = gate('Etiqueta teste');
  if (handoff?.classList.contains('ok')) return 8;
  if (print?.classList.contains('ok')) return 8;
  const printText = print?.querySelector('strong')?.textContent || '';
  const printMatch = printText.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  const printed = printMatch ? Number(printMatch[1].replace(/\D/g, '') || 0) : 0;
  if (printed > 0) return 7;
  if (labelTest?.classList.contains('ok')) return 6;
  return 5;
}

function trackingProgress() {
  const total = ROOT?.querySelector('.tracking-snapshot.total');
  if (!total) return 9;
  const posted = numberFromText(total.querySelector('.tracking-head span')?.textContent);
  const valueFor = (label) => {
    const row = [...total.querySelectorAll('.snapshot-lines > div')].find((item) => item.querySelector('span:nth-child(2)')?.textContent?.trim() === label);
    return numberFromText(row?.querySelector('b')?.textContent);
  };
  if (!posted) return 9;
  const terminal = valueFor('Entregues') + valueFor('Devolvidos');
  return terminal >= posted ? 11 : 10;
}

function stageForView(view) {
  if (view === 'bases') return baseProgress().stage;
  if (view === 'production') return productionProgress();
  if (view === 'tracking') return trackingProgress();
  return VIEW_STAGE[view] || 0;
}

function decorateAuth() {
  const auth = ROOT?.querySelector('.elections-auth');
  if (!auth) return;
  setText(auth.querySelector('.brand-pill'), 'AGF OPERAÇÕES POSTAIS');
  setText(auth.querySelector('.elections-auth-copy h1'), 'Da base de endereços à produção postal.');
  setText(auth.querySelector('.elections-auth-copy p'), 'Bases, Portal Postal, documentos, etiquetas, volumes e acompanhamento operacional em um único fluxo.');
}

function decorateBrandAndNav() {
  const brand = ROOT?.querySelector('.app-brand');
  if (brand) {
    setText(brand.querySelector('strong'), 'Operações Postais');
    setText(brand.querySelector('small'), 'Painel da agência');
  }
  ROOT?.querySelectorAll('.app-nav button[data-view]').forEach((button) => {
    const view = button.dataset.view, label = NAV_LABELS[view];
    if (label && view !== 'tracking') setText(button, label);
    button.classList.toggle('nav-prep', ['bases', 'portal'].includes(view));
    button.classList.toggle('nav-prod', ['returns', 'production'].includes(view));
    button.classList.toggle('nav-track', view === 'tracking');
  });
}

function processMarkup(view) {
  const active = stageForView(view);
  return `<section class="approved-process" aria-label="Etapas da operação" data-approved-process="${view}:${active}"><div class="approved-process-head"><div><strong>PASSO A PASSO DA OPERAÇÃO</strong><span>Bases grandes são processadas internamente; o operador acompanha a operação como um fluxo único.</span></div><div class="approved-process-legend"><i class="done"></i> concluído <i class="current"></i> atual <i class="pending"></i> pendente</div></div><div class="approved-steps">${STAGES.map(([number, label, color]) => { const state = active === 0 ? 'neutral' : number < active ? 'done' : number === active ? 'current' : 'pending'; return `<div class="approved-step ${state} ${color}"><b>${number}</b><span>${label}</span></div>`; }).join('')}</div></section>`;
}

function addProcess() {
  const page = ROOT?.querySelector('.page'), head = page?.querySelector(':scope > .page-head');
  if (!page || !head) return;
  const view = activeView();
  if (['campaigns', 'reports'].includes(view)) { page.querySelector(':scope > .approved-process')?.remove(); return; }
  const signature = `${view}:${stageForView(view)}`;
  const existing = page.querySelector(':scope > .approved-process');
  if (existing?.dataset.approvedProcess === signature) return;
  existing?.remove();
  head.insertAdjacentHTML('afterend', processMarkup(view));
}

function metricValueByLabel(label) {
  const card = [...(ROOT?.querySelectorAll('.metric-card') || [])].find((item) => item.querySelector('span')?.textContent.trim() === label);
  return numberFromText(card?.querySelector('strong')?.textContent);
}

function addServiceSummary() {
  const page = ROOT?.querySelector('.page'), metrics = page?.querySelector('.grid.metrics');
  if (!page || !metrics || page.querySelector('.service-summary') || activeView() !== 'dashboard') return;
  const pac = metricValueByLabel('PAC emitidos'), sedex = metricValueByLabel('SEDEX emitidos'), total = pac + sedex;
  metrics.insertAdjacentHTML('beforebegin', `<section class="service-summary"><article class="service-card pac"><div><span>PAC</span><small>Objetos emitidos</small></div><strong>${formatNumber(pac)}</strong></article><article class="service-card sedex"><div><span>SEDEX</span><small>Objetos emitidos</small></div><strong>${formatNumber(sedex)}</strong></article><article class="service-card total"><div><span>TOTAL</span><small>PAC + SEDEX emitidos</small></div><strong>${formatNumber(total)}</strong></article></section>`);
}

function genericOperationLanguage() {
  if (activeView() !== 'campaigns') return;
  const head = ROOT?.querySelector('.page-head');
  setText(head?.querySelector('h1'), 'Operações');
  setText(head?.querySelector('p:not(.eyebrow)'), 'Cada operação mantém seus dados, usuários, lotes e histórico separados.');
  setText(head?.querySelector('#new-campaign'), 'Nova operação');
  ROOT?.querySelectorAll('[data-open-campaign]').forEach((button) => setText(button, 'Abrir operação'));
}

const NEXT_VIEW = { portal: ['returns', 'Seguir para Retorno do Portal'], returns: ['production', 'Seguir para Produção'], production: ['tracking', 'Seguir para Acompanhamento'] };

function nextMarkup(view) {
  if (view === 'bases') {
    const next = baseProgress();
    return { signature: `bases:${next.action}:${next.target}:${next.disabled}`, html: `<div class="approved-next" data-approved-next-signature="bases:${next.action}:${next.target}:${next.disabled}"><div><strong>Próximo passo</strong><span>Importe a base completa, higienize e revise o que for necessário. Serviço e conteúdo só são definidos depois.</span></div><button class="primary" type="button" data-approved-base="${next.action}" data-approved-target="${next.target}" ${next.disabled ? 'disabled' : ''}>${next.label}${next.disabled ? '' : ' →'}</button></div>` };
  }
  const next = NEXT_VIEW[view];
  if (!next) return null;
  return { signature: `${view}:${next[0]}`, html: `<div class="approved-next" data-approved-next-signature="${view}:${next[0]}"><div><strong>Etapa concluída?</strong><span>Avance mantendo o mesmo contexto da operação selecionada.</span></div><button class="primary" type="button" data-approved-next="${next[0]}">${next[1]} →</button></div>` };
}

function addNextAction() {
  const page = ROOT?.querySelector('.page');
  if (!page) return;
  const desired = nextMarkup(activeView()), existing = page.querySelector(':scope > .approved-next');
  if (!desired) { existing?.remove(); return; }
  if (existing?.dataset.approvedNextSignature === desired.signature) return;
  existing?.remove();
  page.insertAdjacentHTML('beforeend', desired.html);
}

function keepChipsResponsive() { ROOT?.querySelectorAll('.status').forEach((chip) => { if (chip.title !== chip.textContent.trim()) chip.title = chip.textContent.trim(); }); }
function decorate() { decorateAuth(); decorateBrandAndNav(); genericOperationLanguage(); addProcess(); addServiceSummary(); addNextAction(); keepChipsResponsive(); }

ROOT?.addEventListener('click', (event) => {
  const base = event.target.closest('[data-approved-base]');
  if (base) {
    event.preventDefault();
    const action = base.dataset.approvedBase, target = base.dataset.approvedTarget;
    if (action === 'clean') { ROOT.querySelector(`[data-clean="${CSS.escape(target)}"]`)?.click(); return; }
    if (action === 'review') {
      const targetButton = ROOT.querySelector(`[data-clean="${CSS.escape(target)}"]`);
      if (targetButton) { targetButton.dataset.reviewBase = target; targetButton.click(); }
      return;
    }
    if (action === 'export') {
      const panel = ROOT.querySelector('[data-export-panel]');
      panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel?.querySelector('#portal-export-service')?.focus();
      return;
    }
    if (action === 'portal') { ROOT.querySelector('.app-nav button[data-view="portal"]')?.click(); return; }
  }
  const button = event.target.closest('[data-approved-next]');
  if (button) ROOT.querySelector(`.app-nav button[data-view="${CSS.escape(button.dataset.approvedNext)}"]`)?.click();
});

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; decorate(); });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
decorate();
