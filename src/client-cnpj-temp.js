import './client-cnpj-temp.css';
import { api, fileToBase64 } from './api.js';

const root = document.querySelector('#client-portal');
const toastBox = document.querySelector('#client-toast');

const S = {
  certBase64: '',
  certName: '',
  result: null,
};

const DEMO = Object.freeze({
  operation: 'Campanha Ceará 2026 - Demonstração',
  lot: 'Lote DC-e 000184',
  documents: 1248,
  pac: 832,
  sedex: 416,
  status: 'Aguardando validação do CNPJ',
});

const h = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

const digits = (value) => String(value || '').replace(/\D/g, '');
const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));

function toast(message, type = 'info') {
  if (!toastBox) return;
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
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function validCnpj(value) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base, weights) => {
    const total = base.split('').reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

function resultMarkup() {
  if (!S.result) return '';
  const ok = S.result.matches;
  return `<section class="validation-result ${ok ? 'success' : 'error'}" aria-live="polite">
    <div class="result-icon">${ok ? '✓' : '!'}</div>
    <div>
      <strong>${ok ? 'CNPJ confirmado' : 'CNPJ não corresponde'}</strong>
      <p>${ok
        ? 'O CNPJ informado é o mesmo CNPJ presente no certificado A1.'
        : 'O CNPJ informado é diferente do CNPJ encontrado no certificado A1.'}</p>
      <dl>
        <div><dt>CNPJ informado</dt><dd>${h(formatCnpj(S.result.expected))}</dd></div>
        <div><dt>CNPJ do certificado</dt><dd>${h(formatCnpj(S.result.certificateCnpj))}</dd></div>
        <div><dt>Titular</dt><dd>${h(S.result.commonName || 'Não informado')}</dd></div>
        <div><dt>Validade</dt><dd>${h(S.result.validTo || 'Não informada')}</dd></div>
      </dl>
    </div>
  </section>`;
}

function appView() {
  root.innerHTML = `<main class="temp-page">
    <header class="temp-header">
      <img src="/agf-logo.png" alt="AGF José Bonifácio e Correios">
      <span class="direct-access">Demonstração</span>
    </header>

    <section class="temp-hero">
      <span class="temp-badge">VERSÃO TEMPORÁRIA</span>
      <h1>Validar e-CNPJ A1</h1>
      <p>Acesso direto, sem login. Nesta versão, o portal serve somente para confirmar se o CNPJ informado corresponde ao CNPJ do certificado digital.</p>
    </section>

    <section class="demo-panel">
      <div class="demo-heading">
        <div>
          <span class="demo-tag">DADOS FICTÍCIOS</span>
          <h2>${h(DEMO.operation)}</h2>
          <p>${h(DEMO.lot)}</p>
        </div>
        <span class="demo-status">${h(DEMO.status)}</span>
      </div>
      <div class="demo-metrics">
        <div><strong>${fmt(DEMO.documents)}</strong><span>Documentos</span></div>
        <div><strong>${fmt(DEMO.pac)}</strong><span>PAC</span></div>
        <div><strong>${fmt(DEMO.sedex)}</strong><span>SEDEX</span></div>
      </div>
      <p class="demo-note">Os números acima são apenas ilustrativos para demonstração comercial. Nenhum deles representa uma operação real.</p>
    </section>

    <section class="validation-card">
      <div class="validation-copy">
        <span>VALIDAÇÃO REAL</span>
        <h2>Confirme o CNPJ do certificado</h2>
        <p>Informe o CNPJ, selecione o e-CNPJ A1 e digite a senha. O arquivo e a senha são usados somente para esta leitura e não são persistidos pelo portal.</p>
      </div>
      <form id="cnpj-validation-form">
        <label>CNPJ da empresa
          <input id="target-cnpj" name="cnpj" inputmode="numeric" autocomplete="off" maxlength="18" placeholder="00.000.000/0000-00" required>
          <small>Digite o CNPJ que deseja comparar com o certificado.</small>
        </label>

        <label>Certificado e-CNPJ A1
          <div class="file-box">
            <input id="temp-cert" type="file" accept=".pfx,.p12" required>
            <span id="temp-cert-name">Selecione um arquivo .pfx ou .p12</span>
          </div>
        </label>

        <label>Senha do certificado
          <input id="temp-pass" type="password" autocomplete="off" required>
        </label>

        <button type="submit" class="validate-button">Validar CNPJ</button>
      </form>
      ${resultMarkup()}
    </section>

    <section class="privacy-card">
      <strong>O que esta versão faz</strong>
      <ul>
        <li>valida o formato e os dígitos do CNPJ;</li>
        <li>lê o CNPJ existente no certificado A1;</li>
        <li>compara os dois CNPJs e informa se correspondem;</li>
        <li>não autoriza DC-e, não calcula preços e não exibe dashboard operacional;</li>
        <li>pode ser aberta diretamente pelo link público para demonstração.</li>
      </ul>
    </section>
  </main>`;

  const cnpjInput = root.querySelector('#target-cnpj');
  cnpjInput.addEventListener('input', () => {
    cnpjInput.value = formatCnpj(cnpjInput.value);
  });

  root.querySelector('#temp-cert').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    S.certBase64 = '';
    S.certName = '';
    root.querySelector('#temp-cert-name').textContent = file ? file.name : 'Selecione um arquivo .pfx ou .p12';
    if (!file) return;
    if (file.size > 3_500_000) {
      event.target.value = '';
      root.querySelector('#temp-cert-name').textContent = 'Selecione um arquivo .pfx ou .p12';
      return toast('O certificado é maior que o limite permitido para esta demonstração.', 'error');
    }
    S.certName = file.name;
    S.certBase64 = await fileToBase64(file);
  });

  root.querySelector('#cnpj-validation-form').onsubmit = validateCnpjCertificate;
}

async function validateCnpjCertificate(event) {
  event.preventDefault();
  const expected = digits(root.querySelector('#target-cnpj').value);
  const passphrase = root.querySelector('#temp-pass').value;
  const fileInput = root.querySelector('#temp-cert');

  if (!validCnpj(expected)) return toast('Informe um CNPJ válido.', 'error');
  if (!S.certBase64 || !fileInput.files?.[0]) return toast('Selecione o certificado A1.', 'error');
  if (!passphrase) return toast('Informe a senha do certificado.', 'error');

  const stop = busy('Validando CNPJ...');
  try {
    const certificate = await api('/api/cnpj/certificate', {
      method: 'POST',
      body: JSON.stringify({ certificateBase64: S.certBase64, passphrase }),
    });
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
    appView();
    toast(S.result.matches ? 'CNPJ confirmado com sucesso.' : 'O CNPJ não corresponde ao certificado.', S.result.matches ? 'success' : 'error');
  } catch (error) {
    S.certBase64 = '';
    S.certName = '';
    fileInput.value = '';
    root.querySelector('#temp-pass').value = '';
    toast(error.message, 'error');
  } finally {
    stop();
  }
}

appView();
