const TRACKING_RE = /^[A-Z]{2}\d{9}BR$/;
const UF_RE = /^[A-Z]{2}$/;

export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeTracking(value) {
  return String(value ?? "").replace(/\s/g, "").toUpperCase();
}

export function isValidCpf(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCnpj(value) {
  const cnpj = digits(value);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base, weights) => {
    const sum = base.split("").reduce((total, number, index) => total + Number(number) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calc(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const second = calc(cnpj.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return `${first}${second}` === cnpj.slice(12);
}

function parseDelimited(text, delimiter = ";") {
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

function normalizeHeader(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const ENRICHMENT_ALIASES = Object.freeze({
  trackingCode: ["SRO", "OBJETO", "CODIGO_RASTREAMENTO"],
  recipientDocument: ["CPF_CNPJ", "DOCUMENTO", "CPF", "CNPJ"],
  cityCode: ["COD_IBGE", "CODIGO_IBGE", "IBGE", "CODIGO_MUNICIPIO"],
  quantity: ["QUANTIDADE", "QTD"],
  unitValue: ["VALOR_UNITARIO", "VALOR", "UNIT_VALUE"],
  ncm: ["NCM"],
  description: ["DESCRICAO", "CONTEUDO"],
});

function pick(raw, aliases) {
  for (const alias of aliases) {
    if (raw[alias] != null && String(raw[alias]).trim() !== "") return String(raw[alias]).trim();
  }
  return "";
}

export function parseFiscalEnrichmentCsv(text) {
  const rows = parseDelimited(text, ";");
  if (!rows.length) return { rows: [], errors: ["CSV complementar vazio."] };
  const headers = rows[0].map(normalizeHeader);
  const results = [];
  const errors = [];
  const seen = new Set();
  rows.slice(1).forEach((cells, index) => {
    const raw = {};
    headers.forEach((header, column) => { raw[header] = cells[column] ?? ""; });
    const trackingCode = normalizeTracking(pick(raw, ENRICHMENT_ALIASES.trackingCode));
    if (!trackingCode) return;
    if (!TRACKING_RE.test(trackingCode)) errors.push(`Linha ${index + 2}: SRO invalido.`);
    if (seen.has(trackingCode)) errors.push(`Linha ${index + 2}: SRO duplicado ${trackingCode}.`);
    seen.add(trackingCode);
    const quantityText = pick(raw, ENRICHMENT_ALIASES.quantity).replace(",", ".");
    const rawValueText = pick(raw, ENRICHMENT_ALIASES.unitValue);
    const valueText = rawValueText.includes(",") ? rawValueText.replace(/\./g, "").replace(",", ".") : rawValueText;
    results.push({
      trackingCode,
      recipientDocument: digits(pick(raw, ENRICHMENT_ALIASES.recipientDocument)),
      cityCode: digits(pick(raw, ENRICHMENT_ALIASES.cityCode)),
      quantity: quantityText ? Number(quantityText) : null,
      unitValue: valueText ? Number(valueText) : null,
      ncm: digits(pick(raw, ENRICHMENT_ALIASES.ncm)),
      description: pick(raw, ENRICHMENT_ALIASES.description),
    });
  });
  return { rows: results, errors };
}

export function fiscalEnrichmentTemplate() {
  return "SRO;CPF_CNPJ;COD_IBGE;QUANTIDADE;VALOR_UNITARIO;NCM;DESCRICAO\r\n";
}

export function normalizeIssuerProfile(profile = {}) {
  const address = profile.address || {};
  return {
    cnpj: digits(profile.cnpj),
    name: String(profile.name || "").trim(),
    series: Number(profile.series ?? 0),
    nextNumber: Number(profile.nextNumber ?? 1),
    status: String(profile.status || "").toUpperCase(),
    confirmedAt: String(profile.confirmedAt || ""),
    nonIcmsContributor: profile.nonIcmsContributor === true,
    operationWithoutInvoice: profile.operationWithoutInvoice === true,
    address: {
      street: String(address.street || "").trim(),
      number: String(address.number || "").trim(),
      complement: String(address.complement || "").trim(),
      district: String(address.district || "").trim(),
      city: String(address.city || "").trim(),
      uf: String(address.uf || "").trim().toUpperCase(),
      zip: digits(address.zip),
      cityCode: digits(address.cityCode),
      countryCode: digits(address.countryCode || "1058"),
      country: String(address.country || "BRASIL").trim(),
      phone: digits(address.phone || profile.phone),
      email: String(address.email || profile.email || "").trim(),
    },
  };
}

export function issuerBlockers(profile = {}) {
  const p = normalizeIssuerProfile(profile);
  const errors = [];
  if (!isValidCnpj(p.cnpj)) errors.push({ code: "ISSUER_CNPJ_INVALID", field: "issuer.cnpj", message: "CNPJ do emitente invalido." });
  if (p.name.length < 2) errors.push({ code: "ISSUER_NAME_REQUIRED", field: "issuer.name", message: "Razao social do emitente obrigatoria." });
  if (!p.address.street) errors.push({ code: "ISSUER_STREET_REQUIRED", field: "issuer.address.street", message: "Logradouro do emitente obrigatorio." });
  if (!p.address.number) errors.push({ code: "ISSUER_NUMBER_REQUIRED", field: "issuer.address.number", message: "Numero do emitente obrigatorio." });
  if (!p.address.district) errors.push({ code: "ISSUER_DISTRICT_REQUIRED", field: "issuer.address.district", message: "Bairro do emitente obrigatorio." });
  if (!p.address.city) errors.push({ code: "ISSUER_CITY_REQUIRED", field: "issuer.address.city", message: "Municipio do emitente obrigatorio." });
  if (!UF_RE.test(p.address.uf)) errors.push({ code: "ISSUER_UF_INVALID", field: "issuer.address.uf", message: "UF do emitente invalida." });
  if (!/^\d{8}$/.test(p.address.zip)) errors.push({ code: "ISSUER_ZIP_INVALID", field: "issuer.address.zip", message: "CEP do emitente invalido." });
  if (!/^\d{7}$/.test(p.address.cityCode)) errors.push({ code: "ISSUER_CITY_CODE_REQUIRED", field: "issuer.address.cityCode", message: "Codigo IBGE do emitente obrigatorio." });
  if (!Number.isInteger(p.series) || p.series < 0 || p.series > 999) errors.push({ code: "ISSUER_SERIES_INVALID", field: "issuer.series", message: "Serie DC-e invalida." });
  if (!Number.isInteger(p.nextNumber) || p.nextNumber < 1 || p.nextNumber > 999999999) errors.push({ code: "ISSUER_NEXT_NUMBER_INVALID", field: "issuer.nextNumber", message: "Proximo numero DC-e invalido." });
  if (!p.nonIcmsContributor) errors.push({ code: "ISSUER_NON_ICMS_NOT_CONFIRMED", field: "issuer.nonIcmsContributor", message: "Declaracao de nao contribuinte do ICMS ainda nao confirmada pelo cliente." });
  if (!p.operationWithoutInvoice) errors.push({ code: "ISSUER_NO_INVOICE_NOT_CONFIRMED", field: "issuer.operationWithoutInvoice", message: "Declaracao de operacao sem nota fiscal ainda nao confirmada pelo cliente." });
  if (p.status && p.status !== "ACTIVE") errors.push({ code: "ISSUER_PROFILE_NOT_ACTIVE", field: "issuer.status", message: "Perfil fiscal do emitente ainda nao esta ativo." });
  return errors;
}

function recipientDocumentType(document) {
  const value = digits(document);
  return value.length === 14 ? "CNPJ" : "CPF";
}

function normalizeObject(raw = {}) {
  const recipient = raw.recipient || raw.RECIPIENT_JSON || {};
  const address = recipient.address || {};
  return {
    id: String(raw.id || raw.ID || ""),
    trackingCode: normalizeTracking(raw.trackingCode || raw.TRACKING_CODE),
    service: String(raw.service || raw.SERVICE || "").trim().toUpperCase(),
    status: String(raw.status || raw.STATUS || "").trim().toUpperCase(),
    matrixStatus: String(raw.matrixStatus || raw.MATRIX_STATUS || raw.matrix?.status || "").trim().toUpperCase(),
    content: String(raw.content || raw.CONTENT || "").trim(),
    reference: String(raw.reference || raw.REFERENCE || "").trim(),
    recipient: {
      name: String(recipient.name || "").trim(),
      document: digits(recipient.document),
      address: {
        street: String(address.street || "").trim(), number: String(address.number || "").trim(),
        complement: String(address.complement || "").trim(), district: String(address.district || "").trim(),
        city: String(address.city || "").trim(), uf: String(address.uf || "").trim().toUpperCase(),
        zip: digits(address.zip), cityCode: digits(address.cityCode),
        countryCode: digits(address.countryCode || "1058"), country: String(address.country || "BRASIL").trim(),
        phone: digits(address.phone), email: String(address.email || "").trim(),
      },
    },
  };
}

function objectBlockers(object, enrichment, defaults) {
  const o = normalizeObject(object);
  const e = enrichment || {};
  const d = defaults || {};
  const errors = [];
  const document = digits(e.recipientDocument || o.recipient.document);
  const cityCode = digits(e.cityCode || o.recipient.address.cityCode);
  const description = String(e.description || o.content || d.description || "").trim();
  const quantity = e.quantity != null ? Number(e.quantity) : (d.quantity != null ? Number(d.quantity) : NaN);
  const unitValue = e.unitValue != null ? Number(e.unitValue) : (d.unitValue != null ? Number(d.unitValue) : NaN);
  const ncm = digits(e.ncm || d.ncm || "");

  if (!TRACKING_RE.test(o.trackingCode)) errors.push({ code:"SRO_INVALID", field:"trackingCode", message:"Codigo SRO invalido." });
  if (!["PAC","SEDEX"].includes(o.service)) errors.push({ code:"SERVICE_INVALID", field:"service", message:"Servico deve ser PAC ou SEDEX." });
  if (o.status && !["READY","DCE_PREPARED"].includes(o.status)) errors.push({ code:"OBJECT_NOT_READY", field:"status", message:"Objeto nao esta pronto para preparacao fiscal." });
  if (!["AUTO_VERIFIED","VERIFIED"].includes(o.matrixStatus)) errors.push({ code:"MATRIX_NOT_VERIFIED", field:"matrixStatus", message:"Data Matrix precisa estar verificado antes da DC-e." });
  if (document.length === 11 && !isValidCpf(document)) errors.push({ code:"RECIPIENT_CPF_INVALID", field:"recipient.document", message:"CPF do destinatario invalido." });
  else if (document.length === 14 && !isValidCnpj(document)) errors.push({ code:"RECIPIENT_CNPJ_INVALID", field:"recipient.document", message:"CNPJ do destinatario invalido." });
  else if (![11,14].includes(document.length)) errors.push({ code:"RECIPIENT_DOCUMENT_REQUIRED", field:"recipient.document", message:"CPF/CNPJ do destinatario obrigatorio." });
  if (o.recipient.name.length < 2) errors.push({ code:"RECIPIENT_NAME_REQUIRED", field:"recipient.name", message:"Nome do destinatario obrigatorio." });
  if (!o.recipient.address.street) errors.push({ code:"RECIPIENT_STREET_REQUIRED", field:"recipient.address.street", message:"Logradouro do destinatario obrigatorio." });
  if (!o.recipient.address.number) errors.push({ code:"RECIPIENT_NUMBER_REQUIRED", field:"recipient.address.number", message:"Numero do destinatario obrigatorio." });
  if (!o.recipient.address.district) errors.push({ code:"RECIPIENT_DISTRICT_REQUIRED", field:"recipient.address.district", message:"Bairro do destinatario obrigatorio." });
  if (!o.recipient.address.city) errors.push({ code:"RECIPIENT_CITY_REQUIRED", field:"recipient.address.city", message:"Municipio do destinatario obrigatorio." });
  if (!UF_RE.test(o.recipient.address.uf)) errors.push({ code:"RECIPIENT_UF_INVALID", field:"recipient.address.uf", message:"UF do destinatario invalida." });
  if (!/^\d{8}$/.test(o.recipient.address.zip)) errors.push({ code:"RECIPIENT_ZIP_INVALID", field:"recipient.address.zip", message:"CEP do destinatario invalido." });
  if (!/^\d{7}$/.test(cityCode)) errors.push({ code:"RECIPIENT_CITY_CODE_REQUIRED", field:"recipient.address.cityCode", message:"Codigo IBGE do municipio do destinatario obrigatorio." });
  if (!description) errors.push({ code:"ITEM_DESCRIPTION_REQUIRED", field:"items[0].description", message:"Descricao/conteudo obrigatorio." });
  if (!(quantity > 0)) errors.push({ code:"ITEM_QUANTITY_REQUIRED", field:"items[0].quantity", message:"Quantidade deve ser informada e maior que zero." });
  if (!(unitValue >= 0.01)) errors.push({ code:"ITEM_UNIT_VALUE_REQUIRED", field:"items[0].unitValue", message:"Valor unitario deve ser informado e maior que zero." });
  if (ncm && !/^\d{2}(?:\d{6})?$/.test(ncm)) errors.push({ code:"ITEM_NCM_INVALID", field:"items[0].ncm", message:"NCM deve ter 2 ou 8 digitos." });

  return { object:o, document, cityCode, description, quantity, unitValue, ncm, errors };
}

export function preflightDcePreparation({ objects = [], issuerProfile = {}, defaults = {}, enrichments = [] } = {}) {
  const issuer = normalizeIssuerProfile(issuerProfile);
  const issuerErrors = issuerBlockers(issuer);
  const enrichmentMap = new Map();
  enrichments.forEach((row) => enrichmentMap.set(normalizeTracking(row.trackingCode), row));
  const seen = new Set();
  const rows = objects.map((source) => {
    const preliminary = normalizeObject(source);
    const duplicate = seen.has(preliminary.trackingCode);
    seen.add(preliminary.trackingCode);
    const checked = objectBlockers(source, enrichmentMap.get(preliminary.trackingCode), defaults);
    if (duplicate) checked.errors.push({ code:"SRO_DUPLICATE", field:"trackingCode", message:"SRO duplicado no lote." });
    const ready = issuerErrors.length === 0 && checked.errors.length === 0;
    const draft = ready ? {
      postalObjectId: checked.object.id,
      trackingCode: checked.object.trackingCode,
      service: checked.object.service,
      recipient: {
        documentType: recipientDocumentType(checked.document),
        document: checked.document,
        name: checked.object.recipient.name,
        address: { ...checked.object.recipient.address, cityCode: checked.cityCode },
      },
      items: [{
        description: checked.description,
        ncm: checked.ncm,
        quantity: checked.quantity,
        unitValue: checked.unitValue,
        additionalInfo: "",
      }],
      additionalInfo: checked.object.reference || "",
    } : null;
    return { trackingCode: checked.object.trackingCode, service: checked.object.service, ready, errors: checked.errors, draft };
  });
  const blockerCounts = {};
  [...issuerErrors, ...rows.flatMap((row) => row.errors)].forEach((error) => { blockerCounts[error.code] = (blockerCounts[error.code] || 0) + 1; });
  return {
    ready: issuerErrors.length === 0 && rows.length > 0 && rows.every((row) => row.ready),
    total: rows.length,
    readyCount: rows.filter((row) => row.ready).length,
    blockedCount: rows.filter((row) => !row.ready).length,
    issuerErrors,
    blockerCounts,
    rows,
    documents: rows.filter((row) => row.ready).map((row) => row.draft),
  };
}

export function chunkPreparedDocuments(documents = [], size = 100) {
  const limit = Math.max(1, Math.min(100, Number(size || 100)));
  const chunks = [];
  for (let index = 0; index < documents.length; index += limit) chunks.push(documents.slice(index, index + limit));
  return chunks;
}
