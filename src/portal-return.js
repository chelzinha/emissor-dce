export const TRACKING_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
export const VOLUME_CAPACITY = 250;
export const VERIFIED_MATRIX_STATUSES = Object.freeze(["AUTO_VERIFIED", "VERIFIED"]);

const HEADER_ALIASES = Object.freeze({
  trackingCode: ["OBJETO", "OBJETO_POSTAL", "NUMERO_ETIQUETA", "CODIGO_RASTREAMENTO", "SRO"],
  service: ["SERVICO", "TIPO_SERVICO"],
  recipientName: ["DESTINATARIO", "NOME_DESTINATARIO", "NOME"],
  recipientDocument: ["CPF_CNPJ", "CPFCNPJ", "DOCUMENTO", "CPF", "CNPJ"],
  street: ["ENDERECO", "LOGRADOURO"],
  number: ["NUM", "NUMERO"],
  complement: ["COMPL", "COMPLEMENTO"],
  district: ["BAIRRO"],
  city: ["CIDADE", "MUNICIPIO"],
  uf: ["UF", "ESTADO"],
  zip: ["CEP"],
  content: ["CONTEUDO", "DESCRICAO"],
  reference: ["CODIGO_PP", "REFERENCIA", "PEDIDO", "NF_PEDIDO"],
  accessKey: ["CHAVE", "CHAVE_DCE"],
  protocol: ["PROTOCOLO", "PROTOCOLO_AUTORIZACAO"],
});

export function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseRows(text, delimiter) {
  const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') { field += '"'; i += 1; }
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

export function detectDelimiter(text) {
  const candidates = [";", ",", "\t", "|"];
  const sample = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean).slice(0, 8);
  let best = ";", bestScore = -1;
  for (const delimiter of candidates) {
    const counts = sample.map((line) => parseRows(line, delimiter)[0]?.length || 0);
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

export function normalizeService(value) {
  const service = String(value || "").trim().toUpperCase();
  if (service.includes("SEDEX")) return "SEDEX";
  if (service.startsWith("PAC")) return "PAC";
  return service;
}

export function parsePortalReturnCsv(text, forcedDelimiter = "auto") {
  const delimiter = !forcedDelimiter || forcedDelimiter === "auto" ? detectDelimiter(text) : forcedDelimiter;
  const parsed = parseRows(text, delimiter);
  if (!parsed.length) return { delimiter, headers: [], rows: [], errors: ["CSV vazio"] };
  const headers = parsed[0].map(normalizeHeader);
  const rows = [];
  const errors = [];
  const seen = new Map();

  parsed.slice(1).forEach((cells, index) => {
    const raw = {};
    headers.forEach((header, column) => { raw[header] = cells[column] ?? ""; });
    const trackingCode = pick(raw, HEADER_ALIASES.trackingCode).replace(/\s/g, "").toUpperCase();
    const service = normalizeService(pick(raw, HEADER_ALIASES.service));
    const normalized = {
      rowNumber: index + 2,
      trackingCode,
      service,
      recipient: {
        name: pick(raw, HEADER_ALIASES.recipientName),
        document: pick(raw, HEADER_ALIASES.recipientDocument).replace(/\D/g, ""),
        address: {
          street: pick(raw, HEADER_ALIASES.street),
          number: pick(raw, HEADER_ALIASES.number),
          complement: pick(raw, HEADER_ALIASES.complement),
          district: pick(raw, HEADER_ALIASES.district),
          city: pick(raw, HEADER_ALIASES.city),
          uf: pick(raw, HEADER_ALIASES.uf).toUpperCase(),
          zip: pick(raw, HEADER_ALIASES.zip).replace(/\D/g, ""),
        },
      },
      content: pick(raw, HEADER_ALIASES.content),
      reference: pick(raw, HEADER_ALIASES.reference),
      accessKey: pick(raw, HEADER_ALIASES.accessKey).replace(/\D/g, ""),
      protocol: pick(raw, HEADER_ALIASES.protocol).replace(/\D/g, ""),
      raw,
      errors: [],
    };
    if (!TRACKING_RE.test(trackingCode)) normalized.errors.push("SRO_INVALIDO");
    if (!["PAC", "SEDEX"].includes(service)) normalized.errors.push("SERVICO_INVALIDO");
    if (trackingCode) {
      const prior = seen.get(trackingCode);
      if (prior) {
        normalized.errors.push("SRO_DUPLICADO");
        prior.errors.push("SRO_DUPLICADO");
      } else seen.set(trackingCode, normalized);
    }
    rows.push(normalized);
  });
  if (!headers.some((header) => HEADER_ALIASES.trackingCode.includes(header))) errors.push("Coluna de objeto/SRO nao encontrada");
  return { delimiter, headers, rows, errors };
}

function auditKey(entry) {
  return String(entry?.object || entry?.objeto || entry?.trackingCode || "").replace(/\s/g, "").toUpperCase();
}

export function matrixStatusFor(trackingCode, auditEntry) {
  if (!auditEntry) return "MISSING";
  const payload = String(auditEntry.payload || auditEntry.payloadStart || "").toUpperCase();
  const origin = String(auditEntry.origin || auditEntry.origem || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (payload && !payload.includes(trackingCode)) return "DIVERGENT";
  if ((origin === "codigo" || origin === "code") && payload.includes(trackingCode)) return "AUTO_VERIFIED";
  if (origin === "texto" || origin === "text") return "TEXT_ONLY";
  if (payload.includes(trackingCode)) return "VERIFIED";
  return "MANUAL_REVIEW";
}

export function isMatrixVerified(status) {
  return VERIFIED_MATRIX_STATUSES.includes(String(status || "").toUpperCase());
}

export function mergePortalRowsWithMatrix(rows, audit = []) {
  const byObject = new Map();
  for (const entry of audit) {
    const key = auditKey(entry);
    if (key) byObject.set(key, entry);
  }
  return rows.map((row) => {
    const matrix = byObject.get(row.trackingCode) || null;
    return {
      ...row,
      matrix: matrix ? {
        status: matrixStatusFor(row.trackingCode, matrix),
        payload: String(matrix.payload || ""),
        origin: String(matrix.origin || matrix.origem || ""),
        fileName: String(matrix.fileName || matrix.arquivo || ""),
        page: Number(matrix.page || matrix.pagina || 0),
        stripe: String(matrix.stripe || matrix.tarja || ""),
      } : { status: "MISSING", payload: "", origin: "", fileName: "", page: 0, stripe: "" },
    };
  });
}

export function summarizePortalReturn(rows) {
  const summary = {
    total: rows.length, pac: 0, sedex: 0, invalid: 0, autoVerified: 0,
    verified: 0, textOnly: 0, manualReview: 0, missing: 0, divergent: 0,
  };
  rows.forEach((row) => {
    if (row.service === "PAC") summary.pac += 1;
    if (row.service === "SEDEX") summary.sedex += 1;
    if (row.errors?.length) summary.invalid += 1;
    const status = row.matrix?.status || "MISSING";
    if (status === "AUTO_VERIFIED") summary.autoVerified += 1;
    else if (status === "VERIFIED") summary.verified += 1;
    else if (status === "TEXT_ONLY") summary.textOnly += 1;
    else if (status === "MANUAL_REVIEW") summary.manualReview += 1;
    else if (status === "DIVERGENT") summary.divergent += 1;
    else summary.missing += 1;
  });
  summary.matrixVerified = summary.autoVerified + summary.verified;
  summary.matrixPending = summary.textOnly + summary.manualReview + summary.missing + summary.divergent;
  summary.matched = summary.matrixVerified + summary.textOnly + summary.manualReview;
  summary.readyForProduction = summary.invalid === 0 && summary.total > 0 && summary.matrixVerified === summary.total;
  summary.fullyAutoVerified = summary.invalid === 0 && summary.total > 0 && summary.autoVerified === summary.total;
  return summary;
}

export function planVolumes(rows, capacity = VOLUME_CAPACITY, serviceOrder = ["SEDEX", "PAC"]) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Capacidade de volume invalida");
  const groups = new Map();
  for (const service of serviceOrder) groups.set(service, []);
  rows.forEach((row) => {
    if (!groups.has(row.service)) groups.set(row.service, []);
    groups.get(row.service).push(row);
  });
  const volumes = [];
  for (const [service, serviceRows] of groups) {
    for (let start = 0; start < serviceRows.length; start += capacity) {
      const slice = serviceRows.slice(start, start + capacity);
      volumes.push({ service, quantity: slice.length, trackingCodes: slice.map((row) => row.trackingCode) });
    }
  }
  const totalVolumes = volumes.length;
  return volumes.map((volume, index) => ({ ...volume, number: index + 1, totalVolumes }));
}

export function buildPortalReturnBackendRows(rows) {
  return rows.map((row) => ({
    trackingCode: row.trackingCode,
    service: row.service,
    recipient: row.recipient,
    content: row.content,
    reference: row.reference,
    accessKey: row.accessKey,
    protocol: row.protocol,
    postal: row.raw,
    errors: row.errors || [],
    matrix: row.matrix || { status: "MISSING" },
  }));
}

export function chunkRows(rows, size = 200) {
  if (!Number.isInteger(size) || size < 1) throw new Error("Tamanho de bloco invalido");
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
