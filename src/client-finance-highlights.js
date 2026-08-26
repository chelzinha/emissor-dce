import './client-finance-highlights.css';
import { dataAction } from './api.js';

const ROOT = document.querySelector('#client-portal');
const state = { loading: '', rendered: '' };

function h(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function number(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function dateLabel(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.split('-').reverse().join('/') : text;
}

function campaignId() {
  return ROOT?.querySelector('#op')?.value || '';
}

function isDashboard() {
  const title = ROOT?.querySelector('.client-app main > header > strong')?.textContent?.trim();
  return title === 'Dashboard' && Boolean(ROOT?.querySelector('.content .services'));
}

function markup(summary) {
  const days = (summary?.daily || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  return `<section class="client-finance-summary" data-client-finance="${h(summary.campaignId || '')}">
    <div class="client-finance-head"><div><h2>Financeiro da operação</h2><p>Valores de postagem e pagamentos registrados pela agência.</p></div><small>${number(summary.totalObjects)} objetos com valor importado</small></div>
    <div class="client-finance-cards">
      <article class="client-finance-card"><span>Valor postado</span><b>${money(summary.totalAmount)}</b></article>
      <article class="client-finance-card paid"><span>Valor pago</span><b>${money(summary.received)}</b></article>
      <article class="client-finance-card open"><span>Saldo em aberto</span><b>${money(summary.outstanding)}</b></article>
      <article class="client-finance-card credit"><span>Crédito disponível</span><b>${money(summary.credit)}</b></article>
    </div>
    ${days.length ? `<div class="client-finance-days"><table><thead><tr><th>Data</th><th>Objetos</th><th>PAC</th><th>SEDEX</th><th>Valor</th><th>Pago</th><th>Saldo</th></tr></thead><tbody>${days.map((row) => `<tr><td>${h(dateLabel(row.date))}</td><td>${number(row.totalQuantity)}</td><td>${money(row.pacAmount)}</td><td>${money(row.sedexAmount)}</td><td><b>${money(row.totalAmount)}</b></td><td>${money(row.paid)}</td><td>${money(row.balance)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="client-finance-empty">A agência ainda não importou valores do Consolidador para esta operação.</div>'}
  </section>`;
}

async function enhance() {
  if (!isDashboard()) {
    state.loading = '';
    state.rendered = '';
    return;
  }
  const id = campaignId();
  if (!id) return;
  const existing = ROOT.querySelector('[data-client-finance]');
  if (existing?.dataset.clientFinance === id) return;
  if (state.loading === id) return;
  existing?.remove();
  state.loading = id;
  try {
    const summary = await dataAction('finance.summary', { campaignId: id });
    if (!isDashboard() || campaignId() !== id) return;
    const services = ROOT.querySelector('.content .services');
    services?.insertAdjacentHTML('afterend', markup(summary || { campaignId: id }));
    state.rendered = id;
  } catch {
    // O dashboard principal continua disponível quando o backend financeiro ainda não foi publicado.
  } finally {
    if (state.loading === id) state.loading = '';
  }
}

const observer = new MutationObserver(() => queueMicrotask(enhance));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
enhance();
