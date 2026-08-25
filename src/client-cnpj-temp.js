import './client-portal.css';
import './client-cnpj-temp-redesign.css';
import { api, fileToBase64 } from './api.js';

const root = document.querySelector('#client-portal');
const toastBox = document.querySelector('#client-toast');

const S = { view: 'dashboard', certBase64: '', certName: '', result: null };
const NAV = [['dashboard', 'dashboard', 'Dashboard'], ['validation', 'shield', 'Validar CNPJ']];
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

const ICONS = Object.freeze({
  dashboard: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 16v-3M12 16V8M16 16v-5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.9 7.7 7 10 4.1-2.3 7-5.4 7-10V6l-7-3Z"/><path d="m9.5 12 1.7 1.7 3.5-3.7"/>',
  operation: '<rect x="3" y="4" width="18" height="15" rx="3"/><path d="M7 15l3-3 2 2 4-5 2 2"/><path d="M7 8h3"/>',
  filter: '<path d="M4 5h16l-6.5 7v5l-3 2v-7L4 5Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  box: '<path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
  total: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.8-2 5.2-2 6 0M14 10h4M14 14h4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v5h16v-5"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
});

function icon(name, className = '') {
  return `<svg class="app-icon ${h(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.dashboard}</svg>`;
}

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
  const current = NAV.find((item) => item[0] === S.view) || NAV[0];
  root.innerHTML = `<div class="client-app temp-client">
    <aside><img src="/agf-logo.png" alt="AGF José Bonifácio"><nav>${NAV.map(([id, iconName, label]) => `<button data-view="${id}" class="${S.view === id ? 'active' : ''}">${icon(iconName)}<span>${label}</span></button>`).join('')}</nav></aside>
    <main><header><strong>${h(current[2])}</strong><div><span>${h(DEMO.operation)}</span><button id="profile" title="Demonstração" aria-label="Perfil demonstrativo">DE</button></div></header><section class="content">${content}</section></main>
    <nav class="mobile-tabs" aria-label="Navegação principal">${NAV.map(([id, iconName, label]) => `<button data-view="${id}" class="${S.view === id ? 'active' : ''}">${icon(iconName)}<small>${label}</small></button>`).join('')}</nav>
  </div>`;
  root.querySelectorAll('[data-view]').forEach((button) => { button.onclick = () => { S.view = button.dataset.view; render(); }; });
  root.querySelector('#profile').onclick = () => toast('Painel demonstrativo com dados fictícios.');
}

function serviceCard(name, values, tone, iconName) {
  const rows = [['Preparados', values.prepared], ['Entregues à operação', values.handed], ['Postados', values.posted], ['Em trânsito', values.transit], ['Entregues pelos Correios', values.delivered]];
  const base = Math.max(1, values.prepared);
  return `<article class="card service service-${tone}">
    <div class="service-title"><span class="service-icon">${icon(iconName)}</span><div><h3>${h(name)}</h3><small>${fmt(values.prepared)} objetos preparados</small></div><strong>${fmt(values.prepared)}</strong></div>
    <div class="service-summary"><div><span>Entregues à operação</span><b>${fmt(values.handed)}</b></div><div><span>Postados</span><b>${fmt(values.posted)}</b></div><div><span>Entregues</span><b>${fmt(values.delivered)}</b></div></div>
    <div class="service-details">${rows.map(([label, number]) => `<div class="metric"><span>${label}</span><div><i style="width:${Math.min(100, Math.round(number / base * 100))}%"></i></div><b>${fmt(number)}</b><small>${Math.round(number / base * 100)}%</small></div>`).join('')}</div>
  </article>`;
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
  shell(`<section class="hero hero-dashboard"><span class="hero-icon">${icon('operation')}</span><div><h1>Acompanhamento da operação</h1><p><b>Demonstração:</b> os dados abaixo são fictícios e usam o mesmo visual previsto para a versão final.</p></div></section>
    <section class="filters"><label class="filter-operation">Operação<select id="op"><option>${h(DEMO.operation)}</option></select></label><label>De<span class="input-icon">${icon('calendar')}<input id="from" type="date" value="${DEMO.from}"></span></label><label>Até<span class="input-icon">${icon('calendar')}<input id="to" type="date" value="${DEMO.to}"></span></label><button id="apply">${icon('filter')}<span>Aplicar</span></button></section>
    <div class="section-heading"><div><span>Panorama da operação</span><small>Visão consolidada por serviço</small></div><span class="demo-pill">Dados fictícios</span></div>
    <section class="services">${serviceCard('PAC', p, 'pac', 'truck')}${serviceCard('SEDEX', s, 'sedex', 'box')}${serviceCard('TOTAL', total, 'total', 'total')}</section>
    <section class="lower"><article class="card timeline-card"><div class="card-heading"><span class="heading-icon">${icon('operation')}</span><div><h2>Linha do tempo</h2><small>Últimos eventos registrados</small></div></div><div class="timeline">${DEMO.events.map(([label, date, quantity]) => `<div><i></i><span><b>${h(label)}</b><small>${h(date)}</small></span><strong>${fmt(quantity)}</strong></div>`).join('')}</div></article>
    <article class="card highlights-card"><div class="card-heading"><span class="heading-icon">${icon('total')}</span><div><h2>Destaques</h2><small>Situação atual da operação</small></div></div><div class="donut" style="--a:${deliveredPct * 3.6}deg;--b:${(deliveredPct + transitPct) * 3.6}deg"><span><b>${deliveredPct}%</b><small>entregues</small></span></div><p><b>${fmt(total.posted)}</b> postados · <b>${fmt(total.transit)}</b> em trânsito · <b>${fmt(total.delivered)}</b> entregues</p></article></section>`);
  root.querySelector('#apply').onclick = () => toast('Período atualizado na demonstração.', 'success');
}

function validationResult() {
  if (!S.result) return '';
  const [label, cls] = S.result.matches ? ['CNPJ confirmado', 'ok'] : ['CNPJ não corresponde', 'warn'];
  return `<article class="card lot result-card"><div><h3>Resultado da validação</h3><span class="pill ${cls}">${label}</span></div><section><b>${h(formatCnpj(S.result.expected))}<small>CNPJ informado</small></b><b>${h(formatCnpj(S.result.certificateCnpj))}<small>CNPJ do certificado</small></b><b>${h(S.result.validTo || '-')}<small>Validade</small></b></section><p><b>Titular:</b> ${h(S.result.commonName || 'Não informado')}</p></article>`;
}

function validation() {
  shell(`<section class="validation-intro"><span class="intro-icon">${icon('shield')}</span><div><h1>Validar e-CNPJ A1</h1><p>Esta é a única função real habilitada nesta versão temporária. A navegação e o dashboard permanecem demonstrativos.</p></div></section>
    <section class="authgrid"><div class="validation-column"><article class="card lot demo-lot"><div><h3>${h(DEMO.lot)}</h3><span class="pill info">Dados fictícios</span></div><section><b class="metric-document">${icon('document')}<strong>${fmt(1248)}</strong><small>Documentos</small></b><b class="metric-pac">${icon('truck')}<strong>${fmt(832)}</strong><small>PAC</small></b><b class="metric-sedex">${icon('box')}<strong>${fmt(416)}</strong><small>SEDEX</small></b></section><p>Este lote existe apenas para demonstrar como o painel final ficará quando houver lotes reais vinculados ao cliente.</p></article>${validationResult()}</div>
    <aside class="card cert"><div class="card-heading"><span class="heading-icon">${icon('shield')}</span><div><h2>Validar CNPJ</h2><small>Confirme se o certificado pertence à empresa</small></div></div><label>CNPJ da empresa<span class="input-icon">${icon('id')}<input id="target-cnpj" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00"></span></label><div class="certificate-fields"><label class="file-field">Certificado e-CNPJ A1 (.pfx)<span class="file-picker">${icon('upload')}<span data-file-name>${h(S.certName || 'Selecionar arquivo')}</span><input id="temp-cert" type="file" accept=".pfx,.p12"></span><small>Formato .pfx ou .p12 (máx. 3,5 MB)</small></label><label>Senha do certificado<span class="input-icon password-field">${icon('lock')}<input id="temp-pass" type="password" autocomplete="off" placeholder="Digite a senha"><button id="toggle-pass" type="button" aria-label="Mostrar senha">${icon('eye')}</button></span></label></div><button id="validate-cnpj" class="validate-button">${icon('shield')}<span>Validar CNPJ</span></button><p class="security-note">O certificado e a senha são usados apenas durante a leitura. Esta versão não autoriza DC-e.</p></aside></section>`);

  const cnpjInput = root.querySelector('#target-cnpj');
  cnpjInput.oninput = () => { cnpjInput.value = formatCnpj(cnpjInput.value); };

  const passInput = root.querySelector('#temp-pass');
  root.querySelector('#toggle-pass').onclick = () => {
    const show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    root.querySelector('#toggle-pass').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  };

  root.querySelector('#temp-cert').onchange = async (event) => {
    const file = event.target.files?.[0];
    S.certBase64 = '';
    S.certName = '';
    if (!file) return;
    if (file.size > 3_500_000) {
      event.target.value = '';
      root.querySelector('[data-file-name]').textContent = 'Selecionar arquivo';
      return toast('O certificado é maior que o limite permitido.', 'error');
    }
    S.certName = file.name;
    root.querySelector('[data-file-name]').textContent = file.name;
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
    S.certName = '';
    validation();
    toast(S.result.matches ? 'CNPJ confirmado com sucesso.' : 'O CNPJ não corresponde ao certificado.', S.result.matches ? 'success' : 'error');
  } catch (error) {
    S.certBase64 = '';
    S.certName = '';
    fileInput.value = '';
    root.querySelector('#temp-pass').value = '';
    root.querySelector('[data-file-name]').textContent = 'Selecionar arquivo';
    toast(error.message, 'error');
  } finally {
    stop();
  }
}

function render() { S.view === 'dashboard' ? dashboard() : validation(); }
render();
