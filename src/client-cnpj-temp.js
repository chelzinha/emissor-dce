import './client-portal.css';
import { api, fileToBase64 } from './api.js';

const root = document.querySelector('#client-portal');
const toastBox = document.querySelector('#client-toast');

const S = { view: 'dashboard', certBase64: '', result: null };
const NAV = [['dashboard', '▥', 'Dashboard'], ['validation', '✓', 'Validar CNPJ']];
const DEMO = Object.freeze({
  operation: 'Campanha Ceará 2026 - Demonstração',
  lot: 'Lote DC-e 000184',
  from: '2026-08-18',
  to: '2026-08-25',
  pac: { prepared: 832, handed: 821, posted: 806, transit: 118, delivered: 688 },
  sedex: { prepared: 416, handed: 410, posted: 401, transit: 53, delivered: 348 },
  events: [
    ['Etiquetas geradas', '25/08/2026 13:42', 250],
    ['Etiquetas impressas', '25/08/2026 13:28', 499],
    ['Etiqueta teste aprovada', '25/08/2026 13:18', 1],
    ['Data Matrix 100% verificado', '25/08/2026 12:57', 499],
    ['Retorno do Portal importado', '25/08/2026 11:15', 499],
    ['Higienização de endereços concluída', '24/08/2026 16:20', 500],
  ],
});

const h = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const digits = (value) => String(value || '').replace(/\D/g, '');

function toast(message, type = 'info') {
  toastBox.textContent = message;
  toastBox.className = `client-toast show ${type}`;
  clearTimeout(toastBox._timer);
  toastBox._timer = setTimeout(() => { toastBox.className = 'client-toast'; }, 4200);
}

function busy(label) {
  const box = document.createElement('div');
  box.className = 'client-busy';
  box.innerHTML = `<div><span></span><strong>${h(label)}</strong></div>`;
  document.body.appendChild(box);
  return () => box.remove();
}

function formatCnpj(value) {
  const d = digits(value).slice(0, 14);
  if (!d) return '';
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function validCnpj(value) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base, weights) => {
    const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

function shell(content) {
  root.innerHTML = `<div class="client-app">
    <aside><img src="/agf-logo.png" alt="AGF José Bonifácio"><nav>${NAV.map(([id, icon, label]) => `<button data-view="${id}" class="${S.view === id ? 'active' : ''}"><i>${icon}</i>${label}</button>`).join('')}</nav></aside>
    <main><header><strong>${NAV.find((item) => item[0] === S.view)?.[2]}</strong><div><span>${h(DEMO.operation)}</span><button id="profile" title="Demonstração">DE</button></div></header><section class="content">${content}</section></main>
    <nav class="mobile-tabs" style="grid-template-columns:repeat(2,1fr)">${NAV.map(([id, icon, label]) => `<button data-view="${id}" class="${S.view === id ? 'active' : ''}"><i>${icon}</i><small>${label}</small></button>`).join('')}</nav>
  </div>`;
  root.querySelectorAll('[data-view]').forEach((button) => { button.onclick = () => { S.view = button.dataset.view; render(); }; });
  root.querySelector('#profile').onclick = () => toast('Painel demonstrativo com dados fictícios.');
}

function service(name, values) {
  const colors = ['violet', 'blue', 'orange', 'navy', 'green'];
  const rows = [['Preparados', values.prepared], ['Entregues à operação', values.handed], ['Postados', values.posted], ['Em trânsito', values.transit], ['Entregues pelos Correios', values.delivered]];
  const base = Math.max(1, values.prepared);
  return `<article class="card service"><h3>${name}</h3>${rows.map(([label, number], index) => `<div class="metric"><span>${label}</span><div><i class="${colors[index]}" style="width:${Math.min(100, Math.round(number / base * 100))}%"></i></div><b>${fmt(number)}</b><small>${Math.round(number / base * 100)}%</small></div>`).join('')}</article>`;
}

function dashboard() {
  const p = DEMO.pac;
  const s = DEMO.sedex;
  const total = {
    prepared: p.prepared + s.prepared,
    handed: p.handed + s.handed,
    posted: p.posted + s.posted,
    transit: p.transit + s.transit,
    delivered: p.delivered + s.delivered,
  };
  const deliveredPct = Math.round(total.delivered / total.prepared * 100);
  const transitPct = Math.round(total.transit / total.prepared * 100);
  shell(`<div class="hero"><h1>Acompanhamento da operação</h1><p><b>Demonstração:</b> os dados abaixo são fictícios e usam o mesmo visual previsto para a versão final.</p></div>
    <div class="filters"><label>Operação<select id="op"><option>${h(DEMO.operation)}</option></select></label><label>De<input id="from" type="date" value="${DEMO.from}"></label><label>Até<input id="to" type="date" value="${DEMO.to}"></label><button id="apply">Aplicar</button></div>
    <div class="services">${service('PAC', p)}${service('SEDEX', s)}${service('TOTAL', total)}</div>
    <div class="lower"><article class="card"><h2>Linha do tempo</h2><div class="timeline">${DEMO.events.map(([label, date, quantity]) => `<div><i></i><span><b>${h(label)}</b><small>${h(date)}</small></span><strong>${fmt(quantity)}</strong></div>`).join('')}</div></article>
    <article class="card"><h2>Destaques</h2><div class="donut" style="--a:${deliveredPct * 3.6}deg;--b:${(deliveredPct + transitPct) * 3.6}deg"><span><b>${deliveredPct}%</b><small>entregues</small></span></div><p><b>${fmt(total.posted)}</b> postados · <b>${fmt(total.transit)}</b> em trânsito · <b>${fmt(total.delivered)}</b> entregues</p></article></div>`);
  root.querySelector('#apply').onclick = () => toast('Período atualizado na demonstração.', 'success');
}

function validationResult() {
  if (!S.result) return '';
  const [label, cls] = S.result.matches ? ['CNPJ confirmado', 'ok'] : ['CNPJ não corresponde', 'warn'];
  return `<article class="card lot"><div><h3>Resultado da validação</h3><span class="pill ${cls}">${label}</span></div><section><b>${h(formatCnpj(S.result.expected))}<small>CNPJ informado</small></b><b>${h(formatCnpj(S.result.certificateCnpj))}<small>CNPJ do certificado</small></b><b>${h(S.result.validTo || '-')}<small>Validade</small></b></section><p><b>Titular:</b> ${h(S.result.commonName || 'Não informado')}</p></article>`;
}

function validation() {
  shell(`<div class="hero"><h1>Validar e-CNPJ A1</h1><p>Esta é a única função real habilitada nesta versão temporária. A navegação e o dashboard permanecem demonstrativos.</p></div>
    <div class="authgrid"><div><article class="card lot"><div><h3>${h(DEMO.lot)}</h3><span class="pill info">Dados fictícios</span></div><section><b>${fmt(1248)}<small>Documentos</small></b><b>${fmt(832)}<small>PAC</small></b><b>${fmt(416)}<small>SEDEX</small></b></section><p>Este lote existe apenas para demonstrar como o painel final ficará quando houver lotes reais vinculados ao cliente.</p></article>${validationResult()}</div>
    <aside class="card cert"><h2>Validar CNPJ</h2><label>CNPJ da empresa<input id="target-cnpj" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00"></label><div>Certificado e-CNPJ A1<input id="temp-cert" type="file" accept=".pfx,.p12"></div><label>Senha<input id="temp-pass" type="password" autocomplete="off"></label><button id="validate-cnpj">Validar CNPJ</button><p>O certificado e a senha são usados apenas durante a leitura. Esta versão não autoriza DC-e.</p></aside></div>`);

  const cnpjInput = root.querySelector('#target-cnpj');
  cnpjInput.oninput = () => { cnpjInput.value = formatCnpj(cnpjInput.value); };
  root.querySelector('#temp-cert').onchange = async (event) => {
    const file = event.target.files?.[0];
    S.certBase64 = '';
    if (!file) return;
    if (file.size > 3_500_000) { event.target.value = ''; return toast('O certificado é maior que o limite permitido.', 'error'); }
    S.certBase64 = await fileToBase64(file);
  };
  root.querySelector('#validate-cnpj').onclick = validateCnpjCertificate;
}

async function validateCnpjCertificate() {
  const expected = digits(root.querySelector('#target-cnpj').value);
  const passphrase = root.querySelector('#temp-pass').value;
  const fileInput = root.querySelector('#temp-cert');
  if (!validCnpj(expected)) return toast('Informe um CNPJ válido.', 'error');
  if (!S.certBase64 || !fileInput.files?.[0]) return toast('Selecione o certificado A1.', 'error');
  if (!passphrase) return toast('Informe a senha do certificado.', 'error');

  const stop = busy('Validando CNPJ...');
  try {
    const certificate = await api('/api/cnpj/certificate', { method: 'POST', body: JSON.stringify({ certificateBase64: S.certBase64, passphrase }) });
    const certificateCnpj = digits(certificate.cnpj);
    if (certificateCnpj.length !== 14) throw new Error('O certificado selecionado não possui um CNPJ identificável.');
    S.result = {
      expected,
      certificateCnpj,
      matches: expected === certificateCnpj,
      commonName: certificate.commonName || '',
      validTo: certificate.validTo ? new Date(certificate.validTo).toLocaleDateString('pt-BR') : '',
    };
    S.certBase64 = '';
    validation();
    toast(S.result.matches ? 'CNPJ confirmado com sucesso.' : 'O CNPJ não corresponde ao certificado.', S.result.matches ? 'success' : 'error');
  } catch (error) {
    S.certBase64 = '';
    fileInput.value = '';
    root.querySelector('#temp-pass').value = '';
    toast(error.message, 'error');
  } finally {
    stop();
  }
}

function render() { S.view === 'dashboard' ? dashboard() : validation(); }
render();
