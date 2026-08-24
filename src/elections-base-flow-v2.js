import './elections-base-flow-v2.css';
import Papa from 'papaparse';
import { dataAction, textDownload } from './api.js';

const ROOT = document.querySelector('#elections-app');
const CHUNK = 200;
const REVIEW_LIMIT = 100;
const reviewCache = new Map();
const activeCleaning = new Map();

const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const num = (value) => Number(String(value || '').replace(/\D/g, '') || 0);
const cid = () => document.querySelector('#campaign-select')?.value || '';
const h = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function notify(message, type = 'info') {
  const box = document.querySelector('#elections-toast');
  if (!box) return;
  box.textContent = message;
  box.className = `elections-toast show ${type}`;
  clearTimeout(box._baseFlowTimer);
  box._baseFlowTimer = setTimeout(() => { box.className = 'elections-toast'; }, 4800);
}

function statusBox(page, message = '', type = '') {
  let box = page.querySelector('#base-operation-status');
  if (!box) {
    const upload = page.querySelector('#base-file')?.closest('.upload-box');
    if (!upload) return;
    box = document.createElement('div');
    box.id = 'base-operation-status';
    upload.insertAdjacentElement('afterend', box);
  }
  box.className = `base-operation-status ${type}`.trim();
  setText(box, message);
  box.hidden = !message;
}

function baseRows(page) {
  return [...page.querySelectorAll('tbody tr')].filter((row) => row.querySelector('[data-clean]')).map((row) => {
    const cells = row.querySelectorAll('td');
    const button = row.querySelector('[data-clean]');
    const total = num(cells[2]?.textContent), ready = num(cells[3]?.textContent), review = num(cells[4]?.textContent);
    const status = cells[1]?.textContent?.trim().toUpperCase() || '';
    return { row, button, id: button?.dataset.clean || '', fileName: cells[0]?.textContent?.trim() || 'Base sem nome', status, total, ready, review, remaining: Math.max(0, total - ready - review), exported: row.dataset.baseExported === '1' || status === 'EXPORTED' };
  });
}

function setStatus(item, status) {
  const chip = item.row.querySelector('td:nth-child(2) .status');
  if (!chip) return;
  setText(chip, status);
  chip.classList.toggle('ok', ['READY', 'EXPORTED'].includes(status));
  chip.classList.toggle('warn', ['RECEIVED', 'CLEANING', 'REVIEW', 'UPLOADING'].includes(status));
  chip.classList.remove('bad');
}

function duration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const min = Math.floor(total / 60), sec = total % 60;
  if (min < 60) return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  const hours = Math.floor(min / 60), mins = min % 60;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function progressRow(item) {
  let row = item.row.parentElement?.querySelector(`tr[data-cleaning-progress="${CSS.escape(item.id)}"]`);
  if (!row) {
    row = document.createElement('tr');
    row.className = 'base-cleaning-progress-row';
    row.dataset.cleaningProgress = item.id;
    const cell = document.createElement('td');
    cell.colSpan = Math.max(1, item.row.cells.length);
    cell.innerHTML = `<div class="base-cleaning-progress" role="status" aria-live="polite">
      <div class="base-cleaning-progress-head"><div class="base-cleaning-progress-title"><span class="base-cleaning-spinner" aria-hidden="true"></span><strong>Higienização em andamento</strong></div><span class="base-cleaning-percent">0%</span></div>
      <div class="base-cleaning-bar" aria-hidden="true"><span></span></div>
      <div class="base-cleaning-summary"><span><strong data-progress-completed>0</strong> de <strong data-progress-total>0</strong> concluídos</span><span><strong data-progress-remaining>0</strong> restantes</span><span><strong data-progress-review>0</strong> para revisão</span></div>
      <div class="base-cleaning-meta"><span>Tempo decorrido: <strong data-progress-elapsed>00:00</strong></span><span>Estimativa restante: <strong data-progress-eta>calculando…</strong></span><span class="base-cleaning-live">Última atualização: <strong data-progress-updated>agora</strong></span></div>
    </div>`;
    row.appendChild(cell);
    item.row.insertAdjacentElement('afterend', row);
  }
  return row.querySelector('.base-cleaning-progress');
}

function renderCleaning(item, state) {
  const panel = progressRow(item);
  const now = Date.now();
  const completed = Math.min(state.total, state.initialReady + state.initialReview + state.processed);
  const remaining = Math.max(0, state.total - completed);
  const percent = state.total ? Math.min(100, Math.round((completed / state.total) * 100)) : 0;
  const elapsed = Math.max(0, (now - state.startedAt) / 1000);
  const rate = state.processed > 0 && elapsed > 0 ? state.processed / elapsed : 0;
  const eta = rate > 0 ? remaining / rate : 0;
  const age = Math.max(0, Math.floor((now - state.lastUpdateAt) / 1000));
  const readyNow = state.initialReady + state.readyDelta;
  const reviewNow = state.initialReview + state.reviewDelta;

  setText(panel.querySelector('.base-cleaning-percent'), `${percent}%`);
  panel.querySelector('.base-cleaning-bar > span').style.width = `${percent}%`;
  setText(panel.querySelector('[data-progress-completed]'), fmt(completed));
  setText(panel.querySelector('[data-progress-total]'), fmt(state.total));
  setText(panel.querySelector('[data-progress-remaining]'), fmt(remaining));
  setText(panel.querySelector('[data-progress-review]'), fmt(reviewNow));
  setText(panel.querySelector('[data-progress-elapsed]'), duration(elapsed));
  setText(panel.querySelector('[data-progress-eta]'), state.processed ? `~${duration(eta)}` : 'calculando…');
  setText(panel.querySelector('[data-progress-updated]'), age < 2 ? 'agora' : `há ${age}s`);
  setText(item.row.querySelector('td:nth-child(4)'), fmt(readyNow));
  setText(item.row.querySelector('td:nth-child(5)'), fmt(reviewNow));
  setStatus(item, 'CLEANING');
  item.button.disabled = true;
  setText(item.button, 'Higienizando…');
}

function failCleaning(item, state, message) {
  clearInterval(state.timer);
  activeCleaning.delete(item.id);
  const panel = progressRow(item);
  panel.classList.add('error');
  setText(panel.querySelector('.base-cleaning-progress-title strong'), 'Higienização interrompida');
  setText(panel.querySelector('.base-cleaning-percent'), 'Atenção');
  setText(panel.querySelector('[data-progress-updated]'), message || 'erro na última tentativa');
  item.button.disabled = false;
  setText(item.button, 'Tentar novamente');
}

async function hideIncomplete(item) {
  if (!item.id || item.row.dataset.abortAttempted) return;
  item.row.dataset.abortAttempted = '1';
  item.row.hidden = true;
  try { await dataAction('addressList.abort', { campaignId: cid(), addressListId: item.id }); } catch {}
}

function decorate(page) {
  [page.querySelector('#base-service'), page.querySelector('#base-content')].forEach((input) => {
    const field = input?.closest('label');
    if (field) field.hidden = true;
  });
  const head = page.querySelector(':scope > .page-head p:not(.eyebrow)');
  setText(head, 'Envie a base completa. O sistema preserva o arquivo original e faz a higienização em processamento interno automático antes da exportação ao Portal Postal.');
  const uploadButton = page.querySelector('#upload-base');
  if (uploadButton && !uploadButton.disabled) setText(uploadButton, 'Importar base completa');
  const basesCard = [...page.querySelectorAll(':scope > .card')].find((card) => card.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
  setText(basesCard?.querySelector('.section-title p'), 'A higienização é executada sobre a base completa. Divisões técnicas acontecem automaticamente, sem exigir arquivos menores.');
  page.querySelectorAll('[data-export]').forEach((button) => { button.hidden = true; button.tabIndex = -1; button.setAttribute('aria-hidden', 'true'); });

  baseRows(page).forEach((item) => {
    if (item.status === 'UPLOADING' && item.total === 0) { hideIncomplete(item); return; }
    item.button.hidden = false;
    item.button.removeAttribute('data-review-base');
    const cleaning = activeCleaning.get(item.id);
    if (cleaning) { renderCleaning(item, cleaning); return; }
    item.button.disabled = false;
    if (item.exported) { item.button.hidden = true; return; }
    if (item.review > 0 && item.remaining === 0) { setText(item.button, 'Revisar pendências'); item.button.dataset.reviewBase = item.id; return; }
    if (item.remaining > 0) { setText(item.button, 'Higienizar base'); return; }
    if (item.total > 0 && item.ready === item.total) { item.button.hidden = true; if (item.status !== 'READY') setStatus(item, 'READY'); return; }
    setText(item.button, 'Higienizar base');
  });
}

async function uploadFull(page, button) {
  const file = page.querySelector('#base-file')?.files?.[0];
  if (!cid()) return notify('Selecione uma operação.', 'error');
  if (!file) return notify('Selecione um CSV.', 'error');
  let started = null;
  button.disabled = true;
  try {
    statusBox(page, 'Lendo a base completa…', 'busy');
    const parsed = Papa.parse(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (value) => String(value || '').trim() });
    if (parsed.errors?.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    const rows = parsed.data.filter((row) => Object.values(row || {}).some((value) => String(value ?? '').trim()));
    if (!rows.length) throw new Error('O CSV não possui cadastros para importar.');
    started = await dataAction('addressList.start', { campaignId: cid(), fileName: file.name, metadata: { delimiter: parsed.meta?.delimiter || '', totalRows: rows.length } });
    const size = Math.max(1, Number(started.chunkSize || CHUNK));
    for (let index = 0; index < rows.length; index += size) {
      const end = Math.min(index + size, rows.length);
      setText(button, `Importando ${fmt(end)} de ${fmt(rows.length)}…`);
      statusBox(page, `Importando ${fmt(end)} de ${fmt(rows.length)} cadastros…`, 'busy');
      await dataAction('addressList.append', { campaignId: cid(), addressListId: started.id, rows: rows.slice(index, end) });
    }
    await dataAction('addressList.finish', { campaignId: cid(), addressListId: started.id });
    notify(`${fmt(rows.length)} cadastros recebidos em uma única base.`, 'success');
    location.reload();
  } catch (error) {
    if (started?.id) { try { await dataAction('addressList.abort', { campaignId: cid(), addressListId: started.id }); } catch {} }
    button.disabled = false;
    setText(button, 'Importar base completa');
    statusBox(page, error.message, 'error');
    notify(error.message, 'error');
  }
}

async function cleanFull(page, button, addressListId) {
  if (!addressListId || button.disabled) return;
  const item = baseRows(page).find((row) => row.id === addressListId);
  if (!item) return;
  statusBox(page);
  const state = {
    total: item.total,
    initialReady: item.ready,
    initialReview: item.review,
    processed: 0,
    readyDelta: 0,
    reviewDelta: 0,
    rejectedDelta: 0,
    startedAt: Date.now(),
    lastUpdateAt: Date.now(),
    timer: null,
  };
  activeCleaning.set(addressListId, state);
  renderCleaning(item, state);
  state.timer = setInterval(() => renderCleaning(item, state), 1000);

  try {
    while (true) {
      const raw = await dataAction('addressRows.list', { campaignId: cid(), addressListId, status: 'RAW', limit: CHUNK });
      if (!raw.length) break;
      const ids = raw.map((row) => String(row.id || '')).filter(Boolean);
      if (!ids.length) throw new Error('A higienização não conseguiu identificar o próximo grupo interno.');

      const processedBefore = state.processed;
      const readyBefore = state.readyDelta;
      const reviewBefore = state.reviewDelta;
      const rejectedBefore = state.rejectedDelta;
      const result = await dataAction('cleaning.process', { campaignId: cid(), addressListId, rowIds: ids }, {
        onProgress: (progress) => {
          state.processed = processedBefore + Number(progress?.processed || 0);
          state.readyDelta = readyBefore + Number(progress?.summary?.ready || 0);
          state.reviewDelta = reviewBefore + Number(progress?.summary?.review || 0);
          state.rejectedDelta = rejectedBefore + Number(progress?.summary?.rejected || 0);
          state.lastUpdateAt = Date.now();
          renderCleaning(item, state);
        },
      });
      const count = Number(result?.summary?.processed || 0);
      if (!count) throw new Error('A higienização não avançou.');
      state.processed = processedBefore + count;
      state.readyDelta = readyBefore + Number(result?.summary?.ready || 0);
      state.reviewDelta = reviewBefore + Number(result?.summary?.review || 0);
      state.rejectedDelta = rejectedBefore + Number(result?.summary?.rejected || 0);
      state.lastUpdateAt = Date.now();
      renderCleaning(item, state);
    }
    clearInterval(state.timer);
    activeCleaning.delete(addressListId);
    const review = await dataAction('addressRows.list', { campaignId: cid(), addressListId, status: 'REVIEW', limit: 1 });
    notify(review.length ? 'Higienização concluída. Existem cadastros para revisão.' : 'Higienização concluída para a base completa.', review.length ? 'info' : 'success');
    location.reload();
  } catch (error) {
    failCleaning(item, state, error.message);
    notify(error.message, 'error');
  }
}

function value(data, ...keys) {
  for (const key of keys) if (data?.[key] != null) return String(data[key]);
  return '';
}

function reviewMarkup(row) {
  const data = row.cleaned && Object.keys(row.cleaned).length ? row.cleaned : row.original || {};
  const issues = (row.issues || []).map((issue) => issue.message || issue.code || issue.field).filter(Boolean).join(' · ');
  return `<form class="base-review-item" data-review-row="${h(row.id)}"><div class="base-review-head"><div><strong>Linha ${fmt(row.rowNumber)}</strong><span class="base-review-issues">${h(issues || 'Revise os dados.')}</span></div><button class="primary" type="submit">Salvar correção</button></div><div class="base-review-grid">
    <label class="field"><span>Nome</span><input name="name" value="${h(value(data, 'name', 'NOME', 'DESTINATARIO'))}"></label>
    <label class="field"><span>CEP</span><input name="zip" maxlength="9" value="${h(value(data, 'zip', 'CEP'))}"></label>
    <label class="field wide"><span>Endereço</span><input name="street" value="${h(value(data, 'street', 'ENDEREÇO', 'ENDERECO'))}"></label>
    <label class="field"><span>Número</span><input name="number" value="${h(value(data, 'number', 'NUMERO'))}"></label>
    <label class="field"><span>Complemento</span><input name="complement" value="${h(value(data, 'complement', 'COMPLEMENTO'))}"></label>
    <label class="field"><span>Bairro</span><input name="district" value="${h(value(data, 'district', 'BAIRRO'))}"></label>
    <label class="field"><span>Cidade</span><input name="city" value="${h(value(data, 'city', 'CIDADE'))}"></label>
    <label class="field"><span>UF</span><input name="uf" maxlength="2" value="${h(value(data, 'uf', 'UF'))}"></label>
  </div></form>`;
}

async function openReview(page, addressListId) {
  let panel = page.querySelector('#base-review-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'base-review-panel';
    panel.className = 'card base-review-panel';
    const baseCard = [...page.querySelectorAll(':scope > .card')].find((card) => card.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
    baseCard?.insertAdjacentElement('afterend', panel);
  }
  panel.innerHTML = '<div class="empty">Carregando pendências…</div>';
  try {
    const rows = await dataAction('addressRows.list', { campaignId: cid(), addressListId, status: 'REVIEW', limit: REVIEW_LIMIT });
    reviewCache.clear(); rows.forEach((row) => reviewCache.set(String(row.id), row));
    if (!rows.length) { panel.innerHTML = '<div class="notice">Revisão concluída. Atualizando a base…</div>'; location.reload(); return; }
    panel.innerHTML = `<div class="section-title"><div><h2>Revisar pendências da base</h2><p>Corrija somente os cadastros que não passaram na validação.</p></div><small>até ${fmt(REVIEW_LIMIT)} por tela</small></div><div class="base-review-list">${rows.map(reviewMarkup).join('')}</div>`;
    panel.querySelectorAll('[data-review-row]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const current = event.currentTarget, rowId = current.dataset.reviewRow, source = reviewCache.get(String(rowId)) || {};
      const button = current.querySelector('button'); button.disabled = true; setText(button, 'Salvando…');
      try {
        const data = { ...(source.cleaned || {}), ...Object.fromEntries(new FormData(current)), service: '', content: '' };
        const result = await dataAction('addressRow.update', { campaignId: cid(), rowId, data });
        if (result.status === 'READY') { current.remove(); reviewCache.delete(String(rowId)); notify('Cadastro corrigido e aprovado.', 'success'); if (!panel.querySelector('[data-review-row]')) await openReview(page, addressListId); return; }
        setText(current.querySelector('.base-review-issues'), (result.issues || []).map((issue) => issue.message || issue.code).join(' · ') || 'Ainda há pendências.');
        button.disabled = false; setText(button, 'Salvar correção');
      } catch (error) { button.disabled = false; setText(button, 'Salvar correção'); notify(error.message, 'error'); }
    }));
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { panel.innerHTML = `<div class="notice warn">${h(error.message)}</div>`; notify(error.message, 'error'); }
}

function exportCard(page) {
  const rows = baseRows(page).filter((item) => !item.row.hidden);
  const eligible = rows.filter((item) => !item.exported && item.total > 0 && item.ready === item.total && item.review === 0);
  const exported = rows.filter((item) => item.exported);
  const options = eligible.map((item) => `<option value="${h(item.id)}">${h(item.fileName)} · ${fmt(item.ready)} cadastros</option>`).join('');
  const body = eligible.length ? `<div class="form-grid"><label class="field"><span>Base higienizada</span><select id="portal-export-list">${options}</select></label><label class="field"><span>Serviço</span><select id="portal-export-service"><option value="PAC">PAC</option><option value="SEDEX">SEDEX</option></select></label><label class="field wide"><span>Conteúdo</span><input id="portal-export-content" value="PANFLETOS E ADESIVOS DA CAMPANHA"></label><div class="wide"><button id="portal-export-run" class="primary" type="button">Gerar CSV para o Portal Postal</button></div></div>` : exported.length && exported.length === rows.length ? '<div class="notice">A base já foi exportada. O próximo passo é o Portal Postal.</div>' : '<div class="notice">Conclua a higienização e a revisão para liberar os dados de postagem.</div>';
  return `<section class="card" id="base-export-card" data-export-panel style="margin-top:16px"><div class="section-title"><div><h2>Definir dados da postagem</h2><p>Somente depois da higienização, defina o serviço e o conteúdo do CSV do Portal Postal.</p></div></div>${body}</section>`;
}

function mountExport(page) {
  page.querySelector('#base-export-card')?.remove();
  const baseCard = [...page.querySelectorAll(':scope > .card')].find((card) => card.querySelector('h2')?.textContent?.trim() === 'Bases recebidas');
  if (!baseCard) return;
  (page.querySelector('#base-review-panel') || baseCard).insertAdjacentHTML('afterend', exportCard(page));
  page.querySelector('#portal-export-run')?.addEventListener('click', async () => {
    const addressListId = page.querySelector('#portal-export-list')?.value || '', service = page.querySelector('#portal-export-service')?.value || '', content = page.querySelector('#portal-export-content')?.value?.trim() || '';
    if (!addressListId || !content) return notify('Selecione uma base e informe o conteúdo.', 'error');
    const button = page.querySelector('#portal-export-run'); button.disabled = true; setText(button, 'Gerando CSV…');
    try { const result = await dataAction('portal.export', { campaignId: cid(), addressListId, service, content }); textDownload(result.csv, result.fileName, 'text/csv;charset=utf-8'); notify(`${fmt(result.total)} cadastros exportados para ${service}.`, 'success'); location.reload(); }
    catch (error) { button.disabled = false; setText(button, 'Gerar CSV para o Portal Postal'); notify(error.message, 'error'); }
  });
}

async function markExports(page) {
  if (page.dataset.exportState === cid()) return;
  page.dataset.exportState = cid();
  try {
    const exports = await dataAction('portal.exports.list', { campaignId: cid() });
    const ids = new Set((exports || []).map((item) => String(item.ADDRESS_LIST_ID || item.addressListId || '')).filter(Boolean));
    baseRows(page).forEach((item) => { if (ids.has(item.id)) { item.row.dataset.baseExported = '1'; setStatus(item, 'EXPORTED'); item.button.hidden = true; } });
    mountExport(page);
  } catch {}
}

function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page?.querySelector('#base-file')) return;
  decorate(page);
  if (!page.querySelector('#base-export-card')) mountExport(page);
  markExports(page);
}

ROOT?.addEventListener('click', (event) => {
  const page = ROOT.querySelector('.page');
  if (!page?.querySelector('#base-file')) return;
  const upload = event.target.closest?.('#upload-base');
  if (upload) { event.preventDefault(); event.stopImmediatePropagation(); uploadFull(page, upload); return; }
  const review = event.target.closest?.('[data-review-base]');
  if (review) { event.preventDefault(); event.stopImmediatePropagation(); openReview(page, review.dataset.reviewBase || review.dataset.clean); return; }
  const clean = event.target.closest?.('[data-clean]');
  if (clean) { event.preventDefault(); event.stopImmediatePropagation(); cleanFull(page, clean, clean.dataset.clean); }
}, true);

let scheduled = false;
const observer = new MutationObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; mount(); }); });
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
