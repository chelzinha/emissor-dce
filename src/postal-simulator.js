export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeCep(value) {
  const cep = digits(value);
  if (cep.length !== 8) throw new Error("CEP deve possuir 8 dígitos.");
  return cep;
}

export function normalizeService(value) {
  const service = String(value || "").trim().toUpperCase();
  if (service.startsWith("PAC")) return "PAC";
  if (service.startsWith("SEDEX")) return "SEDEX";
  throw new Error("Serviço deve ser PAC ou SEDEX.");
}

function number(value, label, { min = 0, positive = false } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || (positive && result <= 0)) throw new Error(`${label} inválido.`);
  return result;
}

export function normalizeQuoteRequest(input = {}) {
  return {
    campaignId: String(input.campaignId || "").trim(),
    originCep: normalizeCep(input.originCep),
    destinationCep: normalizeCep(input.destinationCep),
    service: normalizeService(input.service),
    weightGrams: Math.round(number(input.weightGrams, "Peso", { positive: true })),
    heightCm: number(input.heightCm || 0, "Altura", { min: 0 }),
    widthCm: number(input.widthCm || 0, "Largura", { min: 0 }),
    lengthCm: number(input.lengthCm || 0, "Comprimento", { min: 0 }),
  };
}

function cepInt(value) {
  const normalized = digits(value);
  return normalized ? Number(normalized) : null;
}

function within(value, start, end) {
  if (start == null && end == null) return true;
  if (start != null && value < start) return false;
  if (end != null && value > end) return false;
  return true;
}

export function tariffRowMatches(row, request) {
  const service = normalizeService(row.service || row.SERVICE);
  if (service !== request.service) return false;
  const origin = Number(request.originCep);
  const destination = Number(request.destinationCep);
  const originStart = cepInt(row.originCepStart ?? row.ORIGIN_CEP_START);
  const originEnd = cepInt(row.originCepEnd ?? row.ORIGIN_CEP_END);
  const destStart = cepInt(row.destinationCepStart ?? row.DEST_CEP_START);
  const destEnd = cepInt(row.destinationCepEnd ?? row.DEST_CEP_END);
  const weightMin = Number(row.weightMinGrams ?? row.WEIGHT_MIN_G ?? 0);
  const weightMaxRaw = row.weightMaxGrams ?? row.WEIGHT_MAX_G;
  const weightMax = weightMaxRaw === "" || weightMaxRaw == null ? Number.POSITIVE_INFINITY : Number(weightMaxRaw);
  return within(origin, originStart, originEnd)
    && within(destination, destStart, destEnd)
    && request.weightGrams >= weightMin
    && request.weightGrams <= weightMax;
}

function specificity(row) {
  const destStart = cepInt(row.destinationCepStart ?? row.DEST_CEP_START) ?? 0;
  const destEnd = cepInt(row.destinationCepEnd ?? row.DEST_CEP_END) ?? 99999999;
  const originStart = cepInt(row.originCepStart ?? row.ORIGIN_CEP_START) ?? 0;
  const originEnd = cepInt(row.originCepEnd ?? row.ORIGIN_CEP_END) ?? 99999999;
  const weightMin = Number(row.weightMinGrams ?? row.WEIGHT_MIN_G ?? 0);
  const weightMaxRaw = row.weightMaxGrams ?? row.WEIGHT_MAX_G;
  const weightMax = weightMaxRaw === "" || weightMaxRaw == null ? 999999999 : Number(weightMaxRaw);
  return (destEnd - destStart) + (originEnd - originStart) + Math.max(0, weightMax - weightMin);
}

export function selectTariffRow(rows = [], rawRequest = {}) {
  const request = normalizeQuoteRequest(rawRequest);
  const matches = rows.filter((row) => tariffRowMatches(row, request));
  matches.sort((a, b) => specificity(a) - specificity(b));
  return { request, row: matches[0] || null, matches: matches.length };
}

export function quoteFromTariffRows(rows = [], rawRequest = {}, version = {}) {
  const { request, row } = selectTariffRow(rows, rawRequest);
  if (!rows.length) {
    return { configured: false, matched: false, request, reason: "TABELA_NAO_CONFIGURADA" };
  }
  if (!row) {
    return { configured: true, matched: false, request, reason: "FAIXA_NAO_ENCONTRADA", version };
  }
  const priceCents = Number(row.priceCents ?? row.PRICE_CENTS);
  const deadlineBusinessDays = Number(row.deadlineBusinessDays ?? row.DEADLINE_BUSINESS_DAYS);
  if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error("Tarifa configurada possui preço inválido.");
  if (!Number.isFinite(deadlineBusinessDays) || deadlineBusinessDays < 0) throw new Error("Tarifa configurada possui prazo inválido.");
  return {
    configured: true,
    matched: true,
    request,
    version,
    service: request.service,
    priceCents,
    deadlineBusinessDays,
    metadata: row.metadata || row.METADATA_JSON || {},
  };
}
