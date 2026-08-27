export const TRACKING_CATEGORIES = Object.freeze([
  "POSTED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
  "RETURNING",
  "RETURNED",
  "UNKNOWN",
]);

export const ANALYTICAL_POSTINGS_HEADERS = Object.freeze([
  "OBJETO",
  "SERVICO",
  "PESO",
  "QTD",
  "POSTAGEM",
  "VALOR",
  "DECLARADO",
  "A_COBRAR",
  "DESTINATARIO",
  "CEP",
  "SITUACAO",
  "DATA_SITUACAO",
  "NF",
  "DEPARTAMENTO",
  "ADICIONAIS",
  "CONTEUDO",
  "CONTRATO_ECT",
  "DESTINO",
  "CODIGO_PP",
  "LISTA_POSTAGEM",
  "CIDADE",
  "UF",
  "PRAZO_ESTIMADO",
  "PRAZO_REAL",
  "OBS",
  "ALTURA",
  "LARGURA",
  "COMPRIMENTO",
  "CODIGO_ECT",
  "CARTAO_POSTAGEM",
  "PLP",
  "RFID",
]);

const ANALYTICAL_TRACKING_REQUIRED_HEADERS = Object.freeze([
  "OBJETO",
  "SITUACAO",
  "DATA_SITUACAO",
]);

const HEADER_ALIASES = Object.freeze({
  trackingCode: ["OBJETO", "OBJETO_POSTAL", "CODIGO_RASTREAMENTO", "COD_RASTREAMENTO", "RASTREAMENTO", "SRO", "TRACKING_CODE"],
  status: ["STATUS", "SITUACAO", "SITUACAO_OBJETO", "EVENTO", "DESCRICAO_EVENTO"],
  description: ["DESCRICAO", "DETALHE", "DETALHES", "MENSAGEM", "DESCRICAO_STATUS", "OBSERVACAO", "OBS"],
  date: ["DATA_EVENTO", "DATA_SITUACAO", "DATA", "DATA_HORA", "DATAHORA", "EVENT_AT", "DT_EVENTO"],
  time: ["HORA_EVENTO", "HORA", "HORARIO"],
  explicitLocation: ["LOCAL", "LOCALIDADE", "UNIDADE", "LOCAL_EVENTO"],
  city: ["CIDADE"],
  state: ["UF", "ESTADO"],
});

export function normalizeTrackingText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTrackingHeader(value) {
  return normalizeTrackingText(value).replace(/\s+/g, "_");
}

function parseDelimitedRows(text, delimiter) {
  const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '"') {
      if (quoted && clean[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field.trim()); field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

export function detectTrackingDelimiter(text) {
  const candidates = [";", ",", "\t", "|"];
  const sample = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).slice(0, 8);
  let best = ";", bestScore = -1;
  for (const delimiter of candidates) {
    const counts = sample.map((line) => parseDelimitedRows(line, delimiter)[0]?.length || 0);
    if (!counts.length || counts[0] < 2) continue;
    const consistency = counts.filter((count) => count === counts[0]).length / counts.length;
    const score = consistency * 100 + counts[0];
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }
  return best;
}

function pick(raw, aliases) {
  for (const alias of aliases) {
    if (raw[alias] != null && String(raw[alias]).trim() !== "") return String(raw[alias]).trim();
  }
  return "";
}

function analyticalPostingsFormat(headers) {
  return ANALYTICAL_TRACKING_REQUIRED_HEADERS.every((header) => headers.includes(header));
}

function shouldIgnoreTrackingRow(rawTrackingCode) {
  return normalizeTrackingText(rawTrackingCode) === "SEM REGISTRO";
}

function trackingLocation(raw) {
  const explicit = pick(raw, HEADER_ALIASES.explicitLocation);
  if (explicit) return explicit;
  const city = pick(raw, HEADER_ALIASES.city);
  const state = pick(raw, HEADER_ALIASES.state).toUpperCase();
  return [city, state].filter(Boolean).join("/");
}

export function classifyTrackingStatus(status, description = "") {
  const text = normalizeTrackingText(`${status} ${description}`);
  if (!text) return "UNKNOWN";
  if (/DEVOLVIDO AO REMETENTE|ENTREGUE AO REMETENTE|DEVOLUCAO CONCLUIDA|OBJETO DEVOLVIDO/.test(text)) return "RETURNED";
  if (/EM DEVOLUCAO|DEVOLUCAO AO REMETENTE|ENCAMINHADO PARA DEVOLUCAO|RETORNO AO REMETENTE/.test(text)) return "RETURNING";
  if (/OBJETO ENTREGUE|ENTREGUE AO DESTINATARIO|ENTREGA EFETUADA|ENTREGA REALIZADA/.test(text)) return "DELIVERED";
  if (/SAIDA PARA ENTREGA CANCELADA|ENTREGA CANCELADA|ENCAMINHADO PARA RETIRADA|INCONSISTENCIAS? NO ENDERECAMENTO/.test(text)) return "EXCEPTION";
  if (/SAIU PARA ENTREGA|SAIDA PARA ENTREGA|EM ROTA DE ENTREGA/.test(text)) return "OUT_FOR_DELIVERY";
  if (/NAO ENTREGUE|ENTREGA NAO EFETUADA|TENTATIVA DE ENTREGA|DESTINATARIO AUSENTE|ENDERECO INCORRETO|ENDERECO INEXISTENTE|ENDERECO INSUFICIENTE|AGUARDANDO RETIRADA|EXTRAVI|ROUB|AVARIA|RECUSADO/.test(text)) return "EXCEPTION";
  if (/EM TRANSITO|ENCAMINHADO|TRANSFERIDO|EM TRANSFERENCIA|UNIDADE DE TRATAMENTO|UNIDADE DE DISTRIBUICAO/.test(text)) return "IN_TRANSIT";
  if (/OBJETO POSTADO|POSTADO|RECEBIDO PELOS CORREIOS|ACEITO PELOS CORREIOS/.test(text)) return "POSTED";
  return "UNKNOWN";
}

export function parseTrackingDate(dateValue, timeValue = "") {
  const raw = `${String(dateValue || "").trim()} ${String(timeValue || "").trim()}`.trim();
  if (!raw) return "";
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = br;
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mm}:${ss}`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function trackingSourceKey(row) {
  return [row.trackingCode, row.eventAt, row.category, normalizeTrackingText(row.status), normalizeTrackingText(row.description), normalizeTrackingText(row.location)].join("|").slice(0, 700);
}

export function parseTrackingCsv(text, forcedDelimiter = "auto") {
  const delimiter = !forcedDelimiter || forcedDelimiter === "auto" ? detectTrackingDelimiter(text) : forcedDelimiter;
  const parsed = parseDelimitedRows(text, delimiter);
  if (!parsed.length) return { delimiter, format: "EMPTY", headers: [], rows: [], errors: ["CSV vazio"] };
  const headers = parsed[0].map(normalizeTrackingHeader);
  const format = analyticalPostingsFormat(headers) ? "POSTAGENS_ANALITICO" : "TRACKING_GENERIC";
  const errors = [];
  const rows = parsed.slice(1).map((cells, index) => {
    const raw = {};
    headers.forEach((header, column) => { raw[header] = cells[column] ?? ""; });
    const sourceTrackingCode = pick(raw, HEADER_ALIASES.trackingCode);
    const ignored = shouldIgnoreTrackingRow(sourceTrackingCode);
    const trackingCode = sourceTrackingCode.replace(/\s/g, "").toUpperCase();
    const status = pick(raw, HEADER_ALIASES.status);
    const description = pick(raw, HEADER_ALIASES.description);
    const location = trackingLocation(raw);

    if (ignored) {
      return {
        rowNumber: index + 2,
        trackingCode,
        status,
        description,
        eventAt: "",
        location,
        category: "UNKNOWN",
        raw,
        errors: [],
        ignored: true,
        ignoreReason: "SEM_REGISTRO",
        sourceKey: "",
      };
    }

    const eventAt = parseTrackingDate(pick(raw, HEADER_ALIASES.date), pick(raw, HEADER_ALIASES.time));
    const category = classifyTrackingStatus(status, description);
    const rowErrors = [];
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) rowErrors.push("SRO_INVALIDO");
    if (!eventAt) rowErrors.push("DATA_EVENTO_INVALIDA");
    if (!status && !description) rowErrors.push("STATUS_AUSENTE");
    const row = { rowNumber: index + 2, trackingCode, status, description, eventAt, location, category, raw, errors: rowErrors, ignored: false };
    return { ...row, sourceKey: trackingSourceKey(row) };
  });
  if (!headers.some((header) => HEADER_ALIASES.trackingCode.includes(header))) errors.push("Coluna de SRO não encontrada");
  if (!headers.some((header) => HEADER_ALIASES.date.includes(header))) errors.push("Coluna de data do evento não encontrada");
  return {
    delimiter,
    format,
    headers,
    rows,
    errors,
    summary: {
      total: rows.length,
      valid: rows.filter((row) => !row.ignored && !row.errors?.length).length,
      ignored: rows.filter((row) => row.ignored).length,
      invalid: rows.filter((row) => !row.ignored && row.errors?.length).length,
    },
  };
}

export function trackingImportRows(rows) {
  return rows.filter((row) => !row.ignored && !row.errors?.length).map((row) => ({
    trackingCode: row.trackingCode,
    category: row.category,
    status: row.status,
    description: row.description,
    eventAt: row.eventAt,
    location: row.location,
    sourceKey: row.sourceKey,
  }));
}

export function chunkTrackingRows(rows, size = 200) {
  if (!Number.isInteger(size) || size < 1) throw new Error("Tamanho de bloco inválido");
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
