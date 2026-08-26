import './elections-finance-ui.css';
import { dataAction } from './api.js';
import { chunkFinanceRows, parseConsolidadorCsv, sha256Text } from './finance-import.js';

const ROOT = document.querySelector('#elections-app');
let financeActive = false;
let preview = null;
let previewText = '';
let previewFileName = '';
let previewHash = '';

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
  return document.querySelector('#campaign-select')?.value || '';
}

function statusLabel(status) {
  const labels = {
    EM_ABERTO: 'Em aberto',
    PARCIALMENTE_PAGO: 'Parcialmente pago',
    PAGO: 'Pago',
    FINISHED: 'Concluída',
    FINISHED_WITH_CONFLICTS: 'Concluída com conflitos',
    UPLOADING: 'Importando',
  };
  return labels[String(status || '')] || String(status || '');
}

function statusClass(status) {
  const value = String(status || '');
  if (['PAGO', 'FINISHED'].includes(value)) return 'ok';
  if (['PARCIALMENTE_PAGO', 'UPLOADING'].includes(value)) return 'warn';
  if (value.includes('CONFLICT')) return 'bad';
  return '';
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function previewMarkup() {
  if (!preview) return '<div class="finance-file-empty">Selecione o CSV exportado pelo Consolidador.</div>';
  const s = preview.summary || {};
  return `<div class="finance-preview">
    <div><strong>${h(previewFileName)}</strong><span>${number(preview.validRows.length)} linhas válidas · ${number(preview.invalidRows.length)} pendências</span></div>
    <div class="finance-preview-totals"><span>PAC <b>${number(s.pac?.objects)} · ${money(s.pac?.amount)}</b></span><span>SEDEX <b>${number(s.sedex?.objects)} · ${money(s.sedex?.amount)}</b></span><span>Total <b>${number(s.totalObjects)} · ${money(s.totalAmount)}</b></span></div>
  </div>`;
}

function errorsMarkup() {
  if (!preview?.invalidRows?.length) return '';
  return `<details class="finance-errors"><summary>Ver ${number(preview.invalidRows.length)} linha(s) com pendência</summary>
    ${preview.invalidRows.slice(0, 40).map((row) => `<div><code>Linha ${number(row.rowNumber)}</code><span>${h(row.trackingCode || 'sem SRO')}</span><b>${h(row.errors.join(', '))}</b></div>`).join('')}
  </details>`;
}

function summaryCards(summary) {
  return `<section class="finance-hero">
    <article class="card finance-kpi"><span>Valor postado</span><strong>${money(summary.totalAmount)}</strong><small>${number(summary.totalObjects)} objetos importados</small></article>
    <article class="card finance-kpi paid"><span>Recebido do cliente</span><strong>${money(summary.received)}</strong><small>${money(summary.allocated)} já alocados</small></article>
    <article class="card finance-kpi open"><span>Saldo em aberto</span><strong>${money(summary.outstanding)}</strong><small>${number(summary.openCharges)} grupo(s) pendente(s)</small></article>
    <article class="card finance-kpi credit"><span>Crédito disponível</span><strong>${money(summary.credit)}</strong><small>Será usado automaticamente nas próximas postagens</small></article>
  </section>`;
}

function serviceCards(summary) {
  const cards = [['PAC', summary.pac || {}, 'pac'], ['SEDEX', summary.sedex || {}, 'sedex']];
  return `<section class="finance-services">${cards.map(([name, item, cls]) => `<article class="card ${cls}"><div><strong>${name}</strong><b>${number(item.quantity)}</b></div><dl><dt>Postado</dt><dd>${money(item.amount)}</dd><dt>Pago</dt><dd>${money(item.paid)}</dd><dt>Saldo</dt><dd>${money(item.balance)}</dd></dl></article>`).join('')}</section>`;
}

function dailyTable(rows) {
  return `<div class="table-wrap"><table class="finance-table"><thead><tr><th>Data</th><th>PAC</th><th>Valor PAC</th><th>SEDEX</th><th>Valor SEDEX</th><th>Total</th><th>Pago</th><th>Saldo</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${h(dateLabel(row.date))}</td><td>${number(row.pacQuantity)}</td><td>${money(row.pacAmount)}</td><td>${number(row.sedexQuantity)}</td><td>${money(row.sedexAmount)}</td><td><b>${money(row.totalAmount)}</b></td><td>${money(row.paid)}</td><td class="${Number(row.balance) > 0 ? 'finance-balance' : ''}">${money(row.balance)}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Nenhuma postagem financeira importada.</div></td></tr>'}</tbody></table></div>`;
}

function chargeOptions(charges) {
  const open = charges.filter((item) => Number(item.balance) > 0);
  return `<option value="">Baixa automática nas postagens mais antigas</option>${open.map((item) => `<option value="${h(item.chargeKey)}">${h(dateLabel(item.postingDate))} · ${h(item.service)} · Lista ${h(item.listId || 'sem lista')} · saldo ${h(money(item.balance))}</option>`).join('')}`;
}

function chargesTable(charges) {
  return `<div class="table-wrap"><table class="finance-table"><thead><tr><th>Data</th><th>Serviço</th><th>Lista/OS</th><th>Objetos</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>${charges.map((item) => `<tr><td>${h(dateLabel(item.postingDate))}</td><td>${h(item.service)}</td><td>${h(item.listId || 'Sem lista')}</td><td>${number(item.quantity)}</td><td>${money(item.amount)}</td><td>${money(item.paid)}</td><td>${money(item.balance)}</td><td><span class="status ${statusClass(item.status)}">${h(statusLabel(item.status))}</span></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Nenhuma conta gerada.</div></td></tr>'}</tbody></table></div>`;
}

function paymentsTable(payments) {
  return `<div class="table-wrap"><table class="finance-table"><thead><tr><th>Data</th><th>Forma</th><th>Referência</th><th>Valor</th><th>Alocado</th><th>Crédito</th></tr></thead><tbody>${payments.map((item) => `<tr><td>${h(dateLabel(item.paymentDate))}</td><td>${h(String(item.method || '').replaceAll('_', ' '))}</td><td>${h(item.reference || '-')}</td><td>${money(item.amount)}</td><td>${money(item.allocated)}</td><td>${money(item.unallocated)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Nenhum pagamento registrado.</div></td></tr>'}</tbody></table></div>`;
}

function importsTable(imports) {
  return `<div class="finance-import-history">${imports.slice(0, 12).map((item) => `<div><span><strong>${h(item.fileName)}</strong><small>${h(new Date(item.createdAt).toLocaleString('pt-BR'))}</small></span><span>${number(item.inserted)} inseridos · ${number(item.duplicates)} repetidos · ${number(item.conflicts)} conflitos</span><b>${money(item.totalAmount)}</b><i class="status ${statusClass(item.status)}">${h(statusLabel(item.status))}</i></div>`).join('') || '<div class="empty">Nenhum arquivo importado.</div>'}</div>`;
}

async function render() {
  const slot = ROOT?.querySelector('.app-main > section');
  const id = campaignId();
  if (!slot) return;
  if (!id) {
    slot.innerHTML = '<div class="page finance-page"><div class="notice warn">Selecione uma operação para acessar o Financeiro.</div></div>';
    return;
  }
  slot.innerHTML = '<div class="page finance-page"><div class="empty">Carregando financeiro...</div></div>';
  try {
    const [summary, charges, payments, imports] = await Promise.all([
      dataAction('finance.summary', { campaignId: id }),
      dataAction('finance.charges.list', { campaignId: id }),
      dataAction('finance.payments.list', { campaignId: id }),
      dataAction('finance.imports.list', { campaignId: id }),
    ]);
    slot.innerHTML = `<div class="page finance-page">
      <div class="page-head"><div><p class="eyebrow">FINANCEIRO</p><h1>Postagens, pagamentos e saldo</h1><p>Valores reais do Consolidador, baixas parciais e crédito do cliente na mesma operação.</p></div></div>
      ${summaryCards(summary)}
      ${serviceCards(summary)}
      <section class="card finance-section"><div class="section-title"><div><h2>Postagens por dia</h2><p>Quantidade e valor efetivamente postados, separados por PAC e SEDEX.</p></div></div>${dailyTable(summary.daily || [])}</section>
      <section class="finance-two">
        <article class="card finance-section"><div class="section-title"><div><h2>Importar Consolidador</h2><p>O SRO é a chave. Reimportações idênticas não duplicam valores.</p></div></div>
          <div class="finance-upload"><input id="finance-file" type="file" accept=".csv,.txt,text/csv,text/plain"><button id="finance-import" class="primary" ${preview?.validRows?.length ? '' : 'disabled'}>Importar ${number(preview?.validRows?.length || 0)} postagem(ns)</button></div>
          ${previewMarkup()}${errorsMarkup()}
          <div class="finance-note">Cabeçalhos reconhecidos incluem SRO/OBJETO, SERVIÇO ou ECT, DATA, VALOR, QTD, LISTA/OS e CÓDIGO PP. Linhas de totalização sem SRO são ignoradas.</div>
        </article>
        <article class="card finance-section"><div class="section-title"><div><h2>Registrar pagamento</h2><p>O valor é aplicado às postagens mais antigas ou ao grupo escolhido.</p></div></div>
          <form id="finance-payment" class="finance-payment-form">
            <label class="field"><span>Data</span><input name="paymentDate" type="date" value="${today()}" required></label>
            <label class="field"><span>Valor</span><input name="amount" inputmode="decimal" placeholder="0,00" required></label>
            <label class="field"><span>Forma</span><select name="method"><option value="PIX">PIX</option><option value="TRANSFERENCIA">Transferência</option><option value="CARTAO_DEBITO">Cartão de débito</option><option value="DINHEIRO">Dinheiro</option><option value="OUTRO">Outro</option></select></label>
            <label class="field wide"><span>Aplicar em</span><select name="chargeKey">${chargeOptions(charges)}</select></label>
            <label class="field wide"><span>Referência</span><input name="reference" placeholder="Comprovante, lote ou observação curta"></label>
            <label class="field wide"><span>Observações</span><textarea name="notes" rows="2"></textarea></label>
            <button class="primary wide">Registrar e dar baixa</button>
          </form>
        </article>
      </section>
      <section class="card finance-section"><div class="section-title"><div><h2>Contas por data, serviço e lista</h2><p>O saldo é calculado sem alterar o valor original de cada postagem.</p></div></div>${chargesTable(charges)}</section>
      <section class="finance-two">
        <article class="card finance-section"><div class="section-title"><div><h2>Pagamentos recebidos</h2><p>Valores alocados e créditos ainda disponíveis.</p></div></div>${paymentsTable(payments)}</article>
        <article class="card finance-section"><div class="section-title"><div><h2>Histórico de importações</h2><p>Arquivo, quantidades, conflitos e total financeiro.</p></div></div>${importsTable(imports)}</article>
      </section>
    </div>`;
    bind();
  } catch (error) {
    slot.innerHTML = `<div class="page finance-page"><div class="notice warn">${h(error.message)}</div></div>`;
  }
}

async function readFinanceFile(file) {
  previewFileName = file.name;
  previewText = await file.text();
  previewHash = await sha256Text(previewText);
  preview = parseConsolidadorCsv(previewText);
  await render();
}

async function importFinance() {
  const id = campaignId();
  const rows = preview?.validRows || [];
  if (!id || !rows.length) return;
  const button = ROOT.querySelector('#finance-import');
  if (button) { button.disabled = true; button.textContent = 'Importando...'; }
  try {
    const started = await dataAction('finance.import.start', { campaignId: id, fileName: previewFileName, fileHash: previewHash });
    if (started.alreadyImported) {
      alert('Este arquivo já foi importado. Nenhum valor foi duplicado.');
      preview = null; previewText = ''; previewFileName = ''; previewHash = '';
      await render();
      return;
    }
    const importId = started.import?.id;
    if (!importId) throw new Error('A importação não retornou um identificador.');
    let inserted = 0, duplicates = 0, conflicts = 0, errors = [];
    for (const chunk of chunkFinanceRows(rows, 200)) {
      const result = await dataAction('finance.import.append', { importId, rows: chunk });
      inserted += Number(result.inserted || 0);
      duplicates += Number(result.duplicates || 0);
      conflicts += Number(result.conflicts || 0);
      errors = errors.concat(result.errors || []);
    }
    await dataAction('finance.import.finish', { importId });
    preview = null; previewText = ''; previewFileName = ''; previewHash = '';
    alert(`Importação concluída. ${inserted} postagem(ns) incluída(s), ${duplicates} repetida(s) ignorada(s)${conflicts ? ` e ${conflicts} conflito(s) bloqueado(s)` : ''}${errors.length ? `.` : '.'}`);
    await render();
  } catch (error) {
    alert(error.message);
    if (button) { button.disabled = false; button.textContent = `Importar ${number(rows.length)} postagem(ns)`; }
  }
}

async function recordPayment(form) {
  const id = campaignId();
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Registrando...';
  try {
    const idempotencyKey = form.dataset.idempotencyKey || (globalThis.crypto?.randomUUID?.() || `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    form.dataset.idempotencyKey = idempotencyKey;
    const result = await dataAction('finance.payment.record', { campaignId: id, idempotencyKey, ...values });
    delete form.dataset.idempotencyKey;
    alert(result?.duplicate ? 'Este pagamento já havia sido registrado. Nenhuma baixa foi duplicada.' : 'Pagamento registrado e baixa aplicada.');
    await render();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'Registrar e dar baixa';
  }
}

function bind() {
  ROOT.querySelector('#finance-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) readFinanceFile(file);
  });
  ROOT.querySelector('#finance-import')?.addEventListener('click', importFinance);
  ROOT.querySelector('#finance-payment')?.addEventListener('submit', (event) => {
    event.preventDefault();
    recordPayment(event.currentTarget);
  });
}

function mount() {
  const nav = ROOT?.querySelector('.app-nav');
  if (!nav) return;
  let button = nav.querySelector('[data-view="finance"]');
  if (!button) {
    button = document.createElement('button');
    button.dataset.view = 'finance';
    button.className = 'nav-finance';
    button.textContent = 'Financeiro';
    button.addEventListener('click', (event) => {
      event.stopImmediatePropagation();
      financeActive = true;
      nav.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      render();
    });
    const reports = nav.querySelector('[data-view="reports"]');
    if (reports) reports.insertAdjacentElement('afterend', button);
    else nav.appendChild(button);
  }
  if (financeActive) {
    nav.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    if (!ROOT.querySelector('.finance-page')) render();
  }
  nav.querySelectorAll('button[data-view]:not([data-view="finance"])').forEach((item) => {
    if (item.dataset.financeBound) return;
    item.dataset.financeBound = '1';
    item.addEventListener('click', () => { financeActive = false; });
  });
}

const observer = new MutationObserver(() => queueMicrotask(mount));
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
