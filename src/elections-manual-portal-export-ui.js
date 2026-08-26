const ROOT = document.querySelector('#elections-app');
let scheduled = false;

const fmt = (value) => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const h = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));
const num = (value) => Number(String(value || '').replace(/\D/g, '') || 0);

function normalizedStatus(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tableRows(page) {
  const table = [...page.querySelectorAll('table')].find((item) => item.querySelector('[data-clean]'));
  if (!table) return [];
  return [...table.querySelectorAll('tbody tr')].map((row) => {
    const button = row.querySelector('[data-clean]');
    const cells = row.querySelectorAll('td');
    const status = normalizedStatus(cells[1]?.textContent);
    const total = num(cells[2]?.textContent);
    const exported = row.dataset.baseExported === '1' || /EXPORT/.test(status);
    return {
      row,
      id: String(button?.dataset.clean || ''),
      fileName: String(cells[0]?.textContent || 'Base sem nome').trim(),
      status,
      total,
      exported,
    };
  }).filter((item) => item.id && item.total > 0 && !item.exported && !/UPLOADING|CARREGANDO|ERRO|REVIEW|REVISAR/.test(item.status));
}

function inferService(fileName) {
  if (/SEDEX/i.test(fileName)) return 'SEDEX';
  if (/\bPAC\b/i.test(fileName)) return 'PAC';
  return '';
}

function optionMarkup(item) {
  return `<option value="${h(item.id)}" data-file-name="${h(item.fileName)}">${h(item.fileName)} · ${fmt(item.total)} cadastros</option>`;
}

function bindServiceInference(card) {
  const list = card.querySelector('#portal-export-list');
  const service = card.querySelector('#portal-export-service');
  if (!list || !service || list.dataset.serviceInferenceBound === '1') return;
  list.dataset.serviceInferenceBound = '1';
  const apply = () => {
    const selected = list.selectedOptions?.[0];
    const inferred = inferService(selected?.dataset.fileName || selected?.textContent || '');
    if (inferred) service.value = inferred;
  };
  list.addEventListener('change', apply);
  apply();
}

function ensureOptions(card, rows) {
  const list = card.querySelector('#portal-export-list');
  if (!list) return;
  const known = new Set([...list.options].map((option) => String(option.value || '')));
  rows.forEach((item) => {
    if (known.has(item.id)) return;
    list.insertAdjacentHTML('beforeend', optionMarkup(item));
  });
}

function ensureManualExportForm(page) {
  const card = page.querySelector('#base-export-card');
  if (!card) return;

  const rows = tableRows(page);
  if (!rows.length) return;

  const description = card.querySelector('.section-title p');
  if (description) {
    description.textContent = 'Escolha a base recebida, confirme o serviço e o conteúdo. Ao gerar, o sistema prepara os registros e baixa o CSV no formato do Portal Postal.';
  }

  const existingForm = card.querySelector('.form-grid');
  if (existingForm) {
    existingForm.hidden = false;
    ensureOptions(card, rows);
    bindServiceInference(card);
    return;
  }

  const form = document.createElement('div');
  form.className = 'form-grid';
  form.dataset.manualPortalExport = 'true';
  form.innerHTML = `
    <label class="field"><span>Base recebida</span><select id="portal-export-list">${rows.map(optionMarkup).join('')}</select></label>
    <label class="field"><span>Serviço</span><select id="portal-export-service"><option value="PAC">PAC</option><option value="SEDEX">SEDEX</option></select></label>
    <label class="field wide"><span>Conteúdo</span><input id="portal-export-content" value="PANFLETOS E ADESIVOS DA CAMPANHA"></label>
    <div class="wide"><button id="portal-export-run" class="primary" type="button">Gerar CSV para o Portal Postal</button></div>`;

  const notice = card.querySelector('.notice');
  if (notice) notice.replaceWith(form);
  else card.appendChild(form);
  bindServiceInference(card);
}

function mount() {
  const page = ROOT?.querySelector('.page');
  if (!page?.querySelector('#base-file')) return;
  ensureManualExportForm(page);
}

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    mount();
  });
}

const observer = new MutationObserver(scheduleMount);
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
mount();
