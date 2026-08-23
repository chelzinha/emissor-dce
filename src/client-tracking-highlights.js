import './client-tracking-highlights.css';
import { dataAction } from './api.js';
import { clientTrackingSegments } from './client-tracking.js';

const ROOT = document.querySelector('#client-portal');
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));

function relabelCumulativeCards() {
  ROOT?.querySelectorAll('.service .metric > span:first-child').forEach((label) => {
    if (label.textContent.trim() === 'Em trânsito') label.textContent = 'Ainda não entregues';
  });
}

function campaignId() {
  return ROOT?.querySelector('#op')?.value || '';
}

function renderHighlights(card, bucket) {
  const { total, counts, percentages } = clientTrackingSegments(bucket);
  const a = percentages.delivered * 3.6;
  const b = (percentages.delivered + percentages.movement) * 3.6;
  const c = (percentages.delivered + percentages.movement + percentages.attention) * 3.6;
  card.innerHTML = `<h2>Destaques</h2>
    <p class="tracking-highlight-note">Situação atual dos objetos postados. As categorias abaixo são exclusivas e somam 100%.</p>
    <div class="tracking-donut" style="--a:${a}deg;--b:${b}deg;--c:${c}deg"><span><b>${percentages.delivered}%</b><small>entregues</small></span></div>
    <div class="tracking-highlight-legend">
      <div><i class="green"></i><span>Entregues</span><b>${fmt(counts.delivered)}</b><small>${percentages.delivered}%</small></div>
      <div><i class="blue"></i><span>Em deslocamento</span><b>${fmt(counts.movement)}</b><small>${percentages.movement}%</small></div>
      <div><i class="orange"></i><span>Ocorrências / devoluções</span><b>${fmt(counts.attention)}</b><small>${percentages.attention}%</small></div>
      <div><i class="gray"></i><span>Sem atualização importada</span><b>${fmt(counts.awaiting)}</b><small>${percentages.awaiting}%</small></div>
    </div>
    <p class="tracking-highlight-total"><b>${fmt(total)}</b> objetos postados no snapshot atual.</p>`;
}

async function enhanceDashboard() {
  relabelCumulativeCards();
  const cards = ROOT?.querySelectorAll('.lower > .card');
  if (!cards || cards.length < 2) return;
  const card = cards[1];
  const id = campaignId();
  if (!id || card.dataset.trackingEnhanced === id || card.dataset.trackingLoading === id) return;
  card.dataset.trackingLoading = id;
  try {
    const summary = await dataAction('tracking.summary', { campaignId: id });
    if (!card.isConnected || campaignId() !== id) return;
    card.dataset.trackingEnhanced = id;
    renderHighlights(card, summary?.total || {});
  } catch {
    // Mantém o destaque cumulativo antigo se o backend publicado ainda não tiver rastreamento.
  } finally {
    delete card.dataset.trackingLoading;
  }
}

const observer = new MutationObserver(() => queueMicrotask(enhanceDashboard));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
enhanceDashboard();
