import './elections-reports-ui.css';
import './elections-finance-report.css';
import { dataAction, textDownload } from './api.js';
import { appendFinanceCsv, financeDailyForPeriod, financePeriodTotals } from './finance-report.js';
import { buildDailyActivity, buildOperationSnapshot, operationLocalDate, operationReportCsv, reportNumber } from './operation-report.js';

const ROOT = document.querySelector('#elections-app');
let reportsActive = false;
let from = '';
let to = '';
let reportState = null;

function h(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function cid() {
  return document.querySelector('#campaign-select')?.value || '';
}

function pct(completed, total) {
  return total ? Math.min(100, Math.round(Number(completed || 0) / Number(total || 1) * 100)) : 0;
}

function isoName(value) {
  return String(value || '').replace(/[^0-9-]/g, '') || 'periodo';
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function dateLabel(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.split('-').reverse().join('/') : text;
}

function stageCard(stage, index) {
  const percentage = pct(stage.completed, stage.total);
  return `<article class="report-stage"><div class="report-stage-head"><span class="report-stage-num">${index + 1}</span><div><strong>${h(stage.label)}</strong><small>${reportNumber(stage.completed)} de ${reportNumber(stage.total)}</small></div><b>${percentage}%</b></div><div class="report-progress"><i style="width:${percentage}%"></i></div><div class="report-stage-counts"><span>Concluído <b>${reportNumber(stage.completed)}</b></span>${stage.review ? `<span>Revisão <b>${reportNumber(stage.review)}</b></span>` : ''}${stage.rejected ? `<span>Rejeitados <b>${reportNumber(stage.rejected)}</b></span>` : ''}<span>Pendente <b>${reportNumber(stage.pending)}</b></span></div></article>`;
}

function trackingBox(snapshot) {
  const tracking = snapshot.tracking;
  return `<article class="card report-tracking"><div class="section-title"><div><h2>Situação postal atual</h2><p>Último evento conhecido dos objetos já postados.</p></div></div><div class="report-tracking-grid"><div><span>Sem atualização</span><b>${reportNumber(tracking.awaitingUpdate)}</b></div><div><span>Em trânsito</span><b>${reportNumber(tracking.inTransit)}</b></div><div><span>Saiu para entrega</span><b>${reportNumber(tracking.outForDelivery)}</b></div><div class="ok"><span>Entregues</span><b>${reportNumber(tracking.delivered)}</b></div><div class="warn"><span>Ocorrências</span><b>${reportNumber(tracking.exception)}</b></div><div class="warn"><span>Em devolução</span><b>${reportNumber(tracking.returning)}</b></div><div class="bad"><span>Devolvidos</span><b>${reportNumber(tracking.returned)}</b></div></div></article>`;
}

function dailyTable(rows) {
  return `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Data</th><th>Recebidos</th><th>Higienização</th><th>Exportados</th><th>Retornados</th><th>PAC geradas</th><th>SEDEX geradas</th><th>Impressas</th><th>Entrega interna</th><th>Postados</th><th>Entregues</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${h(dateLabel(row.date))}</td><td>${reportNumber(row.received)}</td><td>${reportNumber(row.cleaningProcessed)}</td><td>${reportNumber(row.exported)}</td><td>${reportNumber(row.returned)}</td><td>${reportNumber(row.generatedPac)}</td><td>${reportNumber(row.generatedSedex)}</td><td>${reportNumber(row.printed)}</td><td>${reportNumber(row.handoff)}</td><td>${reportNumber(row.posted)}</td><td>${reportNumber(row.delivered)}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">Nenhuma movimentação no período.</td></tr>'}</tbody></table></div>`;
}

function financeBox(summary) {
  if (!summary) return '<section class="card"><div class="notice warn">O módulo financeiro ainda não está disponível no backend publicado.</div></section>';
  const rows = financeDailyForPeriod(summary, { from, to });
  const totals = financePeriodTotals(summary, { from, to });
  return `<section class="card report-finance"><div class="section-title"><div><h2>Financeiro do período</h2><p>Valores importados do Consolidador e baixas registradas no módulo Financeiro.</p></div></div><div class="report-finance-kpis"><div><span>Objetos postados</span><b>${reportNumber(totals.objects)}</b></div><div><span>Valor postado</span><b>${money(totals.amount)}</b></div><div class="paid"><span>Pago / alocado</span><b>${money(totals.paid)}</b></div><div class="open"><span>Saldo do período</span><b>${money(totals.balance)}</b></div></div><div class="report-finance-kpis"><div><span>PAC no período</span><b>${reportNumber(totals.pacObjects)} · ${money(totals.pacAmount)}</b></div><div><span>SEDEX no período</span><b>${reportNumber(totals.sedexObjects)} · ${money(totals.sedexAmount)}</b></div><div class="credit"><span>Crédito geral disponível</span><b>${money(summary.credit)}</b></div><div><span>Saldo geral em aberto</span><b>${money(summary.outstanding)}</b></div></div><div class="report-table-wrap"><table class="report-table report-finance-table"><thead><tr><th>Data</th><th>PAC</th><th>Valor PAC</th><th>SEDEX</th><th>Valor SEDEX</th><th>Total</th><th>Pago</th><th>Saldo</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${h(dateLabel(row.date))}</td><td>${reportNumber(row.pacQuantity)}</td><td>${money(row.pacAmount)}</td><td>${reportNumber(row.sedexQuantity)}</td><td>${money(row.sedexAmount)}</td><td><b>${money(row.totalAmount)}</b></td><td>${money(row.paid)}</td><td class="${Number(row.balance) > 0 ? 'report-finance-balance' : ''}">${money(row.balance)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhuma postagem financeira no período.</td></tr>'}</tbody></table></div></section>`;
}

async function loadData() {
  const campaignId = cid();
  if (!campaignId) throw new Error('Selecione uma operação.');
  const requests = [
    dataAction('addressLists.list', { campaignId }),
    dataAction('portal.exports.list', { campaignId }),
    dataAction('portalReturns.list', { campaignId }),
    dataAction('production.list', { campaignId }),
    dataAction('operations.list', { campaignId }),
  ];
  const [addressLists, portalExports, portalReturns, productionBatches, events] = await Promise.all(requests);
  let trackingSummary = null;
  let financeSummary = null;
  try { trackingSummary = await dataAction('tracking.summary', { campaignId }); } catch { /* backend anterior ao rastreamento */ }
  try { financeSummary = await dataAction('finance.summary', { campaignId }); } catch { /* backend anterior ao financeiro */ }
  return { addressLists, portalExports, portalReturns, productionBatches, events, trackingSummary, financeSummary };
}

async function render() {
  const slot = ROOT?.querySelector('.app-main > section');
  if (!slot || !cid()) return;
  slot.innerHTML = '<div class="page reports-page"><div class="empty">Montando relatório operacional...</div></div>';
  try {
    const data = await loadData();
    const operationDates = data.events.map((event) => operationLocalDate(event.occurredAt)).filter(Boolean);
    const financeDates = (data.financeSummary?.daily || []).map((row) => String(row.date || '')).filter(Boolean);
    const dates = operationDates.concat(financeDates).sort();
    if (!from) from = dates[0] || new Date().toISOString().slice(0, 10);
    if (!to) to = dates.at(-1) || from;
    const snapshot = buildOperationSnapshot(data);
    const daily = buildDailyActivity(data.events, { from, to });
    reportState = { snapshot, daily, financeSummary: data.financeSummary };
    slot.innerHTML = `<div class="page reports-page"><div class="page-head report-page-head"><div><p class="eyebrow">RELATÓRIOS</p><h1>Fechamento operacional e financeiro</h1><p>Foto atual dos saldos, movimentação diária, rastreamento e valores de postagem.</p></div><div class="report-actions"><button class="secondary" id="report-csv">Baixar CSV</button><button class="primary" id="report-print">Imprimir / Salvar PDF</button></div></div><section class="card report-filters"><label class="field"><span>De</span><input id="report-from" type="date" value="${h(from)}"></label><label class="field"><span>Até</span><input id="report-to" type="date" value="${h(to)}"></label><button class="secondary" id="report-apply">Aplicar período</button></section><section class="report-hero"><article class="card"><span>Cadastros recebidos</span><strong>${reportNumber(snapshot.received)}</strong><small>${reportNumber(snapshot.cleanReady)} prontos · ${reportNumber(snapshot.cleanReview)} em revisão</small></article><article class="card pac"><span>Etiquetas PAC geradas</span><strong>${reportNumber(snapshot.generatedPac)}</strong><small>contadas somente após o PDF do volume</small></article><article class="card sedex"><span>Etiquetas SEDEX geradas</span><strong>${reportNumber(snapshot.generatedSedex)}</strong><small>contadas somente após o PDF do volume</small></article><article class="card total"><span>Postados / Entregues</span><strong>${reportNumber(snapshot.posted)} / ${reportNumber(snapshot.delivered)}</strong><small>${snapshot.posted ? pct(snapshot.delivered, snapshot.posted) : 0}% dos postados entregues</small></article></section><section class="card"><div class="section-title"><div><h2>Saldos acumulados da operação</h2><p>O total original é preservado e cada etapa mostra concluído, revisão e pendência.</p></div></div><div class="report-stages">${snapshot.stages.map(stageCard).join('')}</div></section><section class="report-middle">${trackingBox(snapshot)}<article class="card report-dce"><div class="section-title"><div><h2>DC-e</h2><p>Somente lotes que utilizam o caminho fiscal.</p></div></div><div><span>Preparadas após pre-flight</span><b>${reportNumber(snapshot.dcePrepared)}</b></div><div><span>Autorizadas</span><b>${reportNumber(snapshot.dceAuthorized)}</b></div><div><span>Saldo aguardando autorização</span><b>${reportNumber(Math.max(0, snapshot.dcePrepared - snapshot.dceAuthorized))}</b></div></article></section>${financeBox(data.financeSummary)}<section class="card"><div class="section-title"><div><h2>Movimentação operacional diária</h2><p>Atividade registrada entre ${h(dateLabel(from))} e ${h(dateLabel(to))}. Reprocessamentos de higienização aparecem como atividade, sem alterar o total original acima.</p></div></div>${dailyTable(daily)}</section></div>`;
    slot.querySelector('#report-apply').onclick = () => {
      from = slot.querySelector('#report-from').value;
      to = slot.querySelector('#report-to').value;
      render();
    };
    slot.querySelector('#report-csv').onclick = () => {
      const csv = appendFinanceCsv(operationReportCsv(snapshot, daily), data.financeSummary, { from, to });
      textDownload(csv, `relatorio_operacional_financeiro_${isoName(from)}_${isoName(to)}.csv`, 'text/csv;charset=utf-8');
    };
    slot.querySelector('#report-print').onclick = () => window.print();
  } catch (error) {
    slot.innerHTML = `<div class="page reports-page"><div class="notice warn">${h(error.message)}</div></div>`;
  }
}

function mount() {
  const nav = ROOT?.querySelector('.app-nav');
  if (!nav) return;
  if (!nav.querySelector('[data-view="reports"]')) {
    const button = document.createElement('button');
    button.dataset.view = 'reports';
    button.className = 'nav-reports';
    button.textContent = 'Relatórios';
    button.addEventListener('click', (event) => {
      event.stopImmediatePropagation();
      reportsActive = true;
      nav.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      render();
    });
    nav.appendChild(button);
  }
  if (reportsActive) {
    const button = nav.querySelector('[data-view="reports"]');
    nav.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    if (!ROOT.querySelector('.reports-page')) render();
  }
  nav.querySelectorAll('button[data-view]:not([data-view="reports"])').forEach((button) => {
    if (button.dataset.reportBound) return;
    button.dataset.reportBound = '1';
    button.addEventListener('click', () => { reportsActive = false; });
  });
}

function activateReportsView() {
  const nav = ROOT?.querySelector('.app-nav');
  if (!nav) return;
  mount();
  const button = nav.querySelector('[data-view="reports"]');
  reportsActive = true;
  nav.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  render();
}

ROOT?.addEventListener('agf:navigate-view', (event) => {
  const view = event.detail?.view;
  if (view === 'reports') activateReportsView();
  else if (view) reportsActive = false;
});

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
