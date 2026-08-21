import { TRACKING_RE, normalizeService, normalizeTrackingCode } from "./post-production.js";

const LIST_ALIASES = ["LISTA", "NUMERO_LISTA", "N_LISTA", "LISTA_POSTAGEM", "NUM_LISTA", "ID_LISTA"];
const SERVICE_CODE_ALIASES = ["CODIGO_SERVICO", "COD_SERVICO", "SERVICO_CODIGO", "CODSERVICO"];
const POSTING_DATE_ALIASES = ["DATA_POSTAGEM", "DATA", "DT_POSTAGEM"];
const POSTING_TIME_ALIASES = ["HORA_POSTAGEM", "HORA", "HR_POSTAGEM"];
const ZIP_ALIASES = ["CEP", "CEP_DESTINATARIO"];
const RECIPIENT_ALIASES = ["DESTINATARIO", "NOME_DESTINATARIO", "NOME"];

function normalizedKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizedObject(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw || {})) out[normalizedKey(key)] = value;
  return out;
}

function pick(raw, aliases) {
  for (const alias of aliases) {
    const value = raw[alias];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function postalProtocolMetadata(object) {
  const raw = normalizedObject(object.postal || object.raw || {});
  const service = normalizeService(object.service || pick(raw, ["SERVICO", "TIPO_SERVICO"]));
  const listNumber = pick(raw, LIST_ALIASES);
  let serviceCode = pick(raw, SERVICE_CODE_ALIASES).replace(/\D/g, "");
  if (!serviceCode && service === "PAC") serviceCode = "4510";
  if (!serviceCode && service === "SEDEX") serviceCode = "4014";
  const recipient = String(object.recipient?.name || pick(raw, RECIPIENT_ALIASES)).replace(/\s+/g, " ").trim();
  const zip = String(object.recipient?.address?.zip || pick(raw, ZIP_ALIASES)).replace(/\D/g, "");
  return {
    trackingCode: normalizeTrackingCode(object.trackingCode),
    service,
    listNumber,
    serviceCode,
    postingDate: pick(raw, POSTING_DATE_ALIASES),
    postingTime: pick(raw, POSTING_TIME_ALIASES),
    zip,
    recipient,
  };
}

export function validateProtocolObject(object, index = 0) {
  const meta = postalProtocolMetadata(object);
  const errors = [];
  if (!TRACKING_RE.test(meta.trackingCode)) errors.push(`LINHA_${index + 1}_SRO_INVALIDO`);
  if (!["PAC", "SEDEX"].includes(meta.service)) errors.push(`LINHA_${index + 1}_SERVICO_INVALIDO`);
  if (!meta.listNumber) errors.push(`LINHA_${index + 1}_LISTA_AUSENTE`);
  if (!meta.serviceCode) errors.push(`LINHA_${index + 1}_CODIGO_SERVICO_AUSENTE`);
  if (!/^\d{8}$/.test(meta.zip)) errors.push(`LINHA_${index + 1}_CEP_INVALIDO`);
  if (!meta.recipient) errors.push(`LINHA_${index + 1}_DESTINATARIO_AUSENTE`);
  if (!meta.postingDate) errors.push(`LINHA_${index + 1}_DATA_AUSENTE`);
  if (!meta.postingTime) errors.push(`LINHA_${index + 1}_HORA_AUSENTE`);
  return { valid: errors.length === 0, errors, meta };
}

export function buildPostingProtocolModel(objects, context = {}) {
  const errors = [];
  const rows = [];
  const seen = new Set();
  (objects || []).forEach((object, index) => {
    const check = validateProtocolObject(object, index);
    errors.push(...check.errors);
    if (seen.has(check.meta.trackingCode)) errors.push(`SRO_DUPLICADO:${check.meta.trackingCode}`);
    seen.add(check.meta.trackingCode);
    rows.push(check.meta);
  });
  const uniqueDates = [...new Set(rows.map((row) => row.postingDate).filter(Boolean))];
  const protocolDate = String(context.protocolDate || "").trim();
  if (!protocolDate && uniqueDates.length > 1) errors.push("DATAS_DE_POSTAGEM_DIVERGENTES");
  if (errors.length) return { valid: false, errors: [...new Set(errors)], lists: [], total: rows.length };

  const map = new Map();
  for (const row of rows) {
    const key = `${row.listNumber}|${row.service}|${row.serviceCode}|${row.postingDate}`;
    if (!map.has(key)) map.set(key, { listNumber: row.listNumber, service: row.service, serviceCode: row.serviceCode, postingDate: row.postingDate, times: new Set(), rows: [] });
    const list = map.get(key);
    list.times.add(row.postingTime);
    list.rows.push(row);
  }
  const lists = [...map.values()].map((list) => {
    const times = [...list.times];
    return {
      listNumber: list.listNumber,
      service: list.service,
      serviceCode: list.serviceCode,
      postingDate: list.postingDate,
      postingTime: times[0],
      timeWarning: times.length > 1 ? `Horarios divergentes: ${times.join(", ")}` : "",
      quantity: list.rows.length,
      rows: list.rows.map((row, index) => ({ ...row, itemNumber: index + 1 })),
    };
  });
  return {
    valid: true,
    errors: [],
    senderName: String(context.senderName || context.operationName || "").trim(),
    cnpj: String(context.cnpj || "").replace(/\D/g, ""),
    protocolDate: protocolDate || uniqueDates[0] || "",
    total: rows.length,
    lists,
  };
}

export function paginatePostingProtocol(model, options = {}) {
  if (!model?.valid) throw new Error("Modelo do protocolo invalido");
  const rowsPerColumn = Number(options.rowsPerColumn || 88);
  if (!Number.isInteger(rowsPerColumn) || rowsPerColumn < 1) throw new Error("rowsPerColumn invalido");
  const columns = [];
  let current = { segments: [], used: 0 };
  const pushColumn = () => {
    columns.push(current);
    current = { segments: [], used: 0 };
  };
  for (const list of model.lists) {
    let offset = 0;
    while (offset < list.rows.length) {
      const available = rowsPerColumn - current.used;
      if (available <= 0) { pushColumn(); continue; }
      const slice = list.rows.slice(offset, offset + available);
      current.segments.push({
        listNumber: list.listNumber,
        service: list.service,
        serviceCode: list.serviceCode,
        postingDate: list.postingDate,
        postingTime: list.postingTime,
        quantity: list.quantity,
        continuation: offset > 0,
        rows: slice,
      });
      current.used += slice.length;
      offset += slice.length;
      if (current.used >= rowsPerColumn) pushColumn();
    }
  }
  if (current.segments.length || !columns.length) pushColumn();
  const pages = [];
  for (let index = 0; index < columns.length; index += 2) {
    pages.push({ left: columns[index], right: columns[index + 1] || { segments: [], used: 0 } });
  }
  return pages.map((page, index) => ({ ...page, pageNumber: index + 1, pageCount: pages.length }));
}
