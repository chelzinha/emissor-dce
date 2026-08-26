import Papa from 'papaparse';

const HEADER_ALIASES = Object.freeze({
  trackingCode: ['SRO', 'OBJETO', 'CODIGO_RASTREIO', 'CODIGO DE RASTREIO', 'RASTREAMENTO', 'IDENTIFICACAO POSTAL'],
  service: ['SERVICO', 'SERVICO POSTAL', 'PRODUTO', 'TIPO SERVICO'],
  ectCode: ['CODIGO ECT', 'CODIGO_ECT', 'ECT', 'SERVICO / CODIGO ECT', 'SERVICO/CODIGO ECT'],
  postingDate: ['DATA POSTAGEM', 'DATA_POSTAGEM', 'DATA', 'DT POSTAGEM'],
  quantity: ['QTD', 'QUANTIDADE', 'QTDE'],
  amount: ['VALOR', 'VALOR SERVICO', 'VALOR_SERVICO', 'PRECO', 'TARIFA'],
  listId: ['LISTA POSTAGEM', 'LISTA_POSTAGEM', 'LISTA', 'OS', 'ORDEM SERVICO', 'ORDEM DE SERVICO'],
  ppCode: ['CODIGO PP', 'CODIGO_PP', 'ID PORTAL POSTAL', 'ID_POSTAL'],
});

export function normalizeFinanceHeader(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function headerIndex(headers, aliases) {
  const normalized = headers.map(normalizeFinanceHeader);
  for (const alias of aliases) {
    const wanted = normalizeFinanceHeader(alias);
    const index = normalized.indexOf(wanted);
    if (index >= 0) return index;
  }
  return -1;
}

export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  let text = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!text) return 0;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }
  const number = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function normalizeFinanceDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  return '';
}

export function normalizeFinanceService(service, ectCode) {
  const text = normalizeFinanceHeader(service);
  const code = String(ectCode ?? '').replace(/\D/g, '');
  if (text.includes('SEDEX') || code === '4014' || code === '04014') return 'SEDEX';
  if (/(^|\s)PAC($|\s)/.test(text) || code === '4510' || code === '04510') return 'PAC';
  return '';
}

function selectHeaderRow(data) {
  let best = null;
  data.slice(0, 30).forEach((row, index) => {
    const headers = Array.isArray(row) ? row : [];
    const tracking = headerIndex(headers, HEADER_ALIASES.trackingCode) >= 0;
    const amount = headerIndex(headers, HEADER_ALIASES.amount) >= 0;
    const date = headerIndex(headers, HEADER_ALIASES.postingDate) >= 0;
    const service = headerIndex(headers, HEADER_ALIASES.service) >= 0 || headerIndex(headers, HEADER_ALIASES.ectCode) >= 0;
    const score = [tracking, amount, date, service].filter(Boolean).length;
    if (!best || score > best.score) best = { index, score, headers };
  });
  return best && best.score >= 2 ? best : null;
}

function getCell(row, index) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

export function parseConsolidadorCsv(text) {
  const parsed = Papa.parse(String(text ?? '').replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const data = Array.isArray(parsed.data) ? parsed.data : [];
  const header = selectHeaderRow(data);
  if (!header) {
    return { rows: [], validRows: [], invalidRows: [], headers: [], delimiter: parsed.meta?.delimiter || '', errors: ['Cabeçalho do Consolidador não reconhecido.'] };
  }

  const indexes = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, headerIndex(header.headers, aliases)]));
  const rows = [];
  let skippedWithoutSro = 0;
  data.slice(header.index + 1).forEach((source, offset) => {
    if (!Array.isArray(source)) return;
    const trackingCode = getCell(source, indexes.trackingCode).replace(/\s/g, '').toUpperCase();
    if (!trackingCode) {
      skippedWithoutSro += 1;
      return;
    }
    const ectCode = getCell(source, indexes.ectCode);
    const service = normalizeFinanceService(getCell(source, indexes.service), ectCode);
    const postingDate = normalizeFinanceDate(getCell(source, indexes.postingDate));
    const amount = parseMoney(getCell(source, indexes.amount));
    const quantityRaw = Number(getCell(source, indexes.quantity).replace(/\D/g, ''));
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 1;
    const errors = [];
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) errors.push('SRO inválido');
    if (!service) errors.push('Serviço não reconhecido');
    if (!postingDate) errors.push('Data de postagem inválida');
    if (!(amount > 0)) errors.push('Valor inválido');
    rows.push({
      rowNumber: header.index + offset + 2,
      trackingCode,
      service,
      ectCode,
      postingDate,
      quantity,
      amount,
      listId: getCell(source, indexes.listId),
      ppCode: getCell(source, indexes.ppCode),
      errors,
    });
  });

  const validRows = rows.filter((row) => row.errors.length === 0);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  const summary = validRows.reduce((out, row) => {
    out.totalObjects += row.quantity;
    out.totalAmount = Math.round((out.totalAmount + row.amount) * 100) / 100;
    out[row.service.toLowerCase()].objects += row.quantity;
    out[row.service.toLowerCase()].amount = Math.round((out[row.service.toLowerCase()].amount + row.amount) * 100) / 100;
    return out;
  }, { totalObjects: 0, totalAmount: 0, pac: { objects: 0, amount: 0 }, sedex: { objects: 0, amount: 0 } });

  return {
    rows,
    validRows,
    invalidRows,
    headers: header.headers,
    headerRow: header.index + 1,
    delimiter: parsed.meta?.delimiter || '',
    skippedWithoutSro,
    summary,
    errors: (parsed.errors || []).slice(0, 20).map((error) => error.message),
  };
}

export function chunkFinanceRows(rows, size = 200) {
  const chunks = [];
  const limit = Math.max(1, Math.min(200, Number(size) || 200));
  for (let index = 0; index < rows.length; index += limit) chunks.push(rows.slice(index, index + limit));
  return chunks;
}

export async function sha256Text(text) {
  const value = String(text ?? '');
  if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
