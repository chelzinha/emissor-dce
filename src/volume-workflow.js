export const VOLUME_CAPACITY = 250;
export const PRINT_EVENT = "LABEL_PRINTED";
export const HANDOFF_EVENT = "LABEL_HANDOFF";

const TRACKING_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

function clean(value) { return String(value ?? "").trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function num(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }

export function normalizeService(service) {
  const value = upper(service);
  if (value.startsWith("SEDEX")) return "SEDEX";
  if (value.startsWith("PAC") || value.startsWith("MINI")) return "PAC";
  return value;
}

export function normalizeVolume(volume) {
  const trackingCodes = Array.isArray(volume?.trackingCodes)
    ? volume.trackingCodes
    : Array.isArray(volume?.TRACKING_CODES_JSON)
      ? volume.TRACKING_CODES_JSON
      : [];
  const normalizedCodes = trackingCodes.map((value) => upper(value).replace(/\s/g, "")).filter(Boolean);
  return {
    id: clean(volume?.id || volume?.ID),
    service: normalizeService(volume?.service || volume?.SERVICE),
    number: num(volume?.number || volume?.VOLUME_NUMBER),
    totalVolumes: num(volume?.totalVolumes || volume?.TOTAL_VOLUMES),
    quantity: num(volume?.quantity || volume?.QUANTITY || normalizedCodes.length),
    trackingCodes: normalizedCodes,
    status: upper(volume?.status || volume?.STATUS || "PLANNED"),
    deliveredAt: clean(volume?.deliveredAt || volume?.DELIVERED_AT),
    receivedBy: clean(volume?.receivedBy || volume?.RECEIVED_BY),
  };
}

export function validateVolumePlan(volumes, objects = []) {
  const normalized = (volumes || []).map(normalizeVolume).sort((a, b) => a.number - b.number);
  const problems = [];
  const seen = new Map();
  const expectedTotalVolumes = normalized.length;

  normalized.forEach((volume, index) => {
    const label = `VOLUME_${volume.number || index + 1}`;
    if (!volume.id) problems.push(`${label}_ID_AUSENTE`);
    if (!["PAC", "SEDEX"].includes(volume.service)) problems.push(`${label}_SERVICO_INVALIDO`);
    if (!Number.isInteger(volume.number) || volume.number < 1) problems.push(`${label}_NUMERO_INVALIDO`);
    if (volume.totalVolumes && volume.totalVolumes !== expectedTotalVolumes) problems.push(`${label}_TOTAL_VOLUMES_DIVERGENTE`);
    if (!Number.isInteger(volume.quantity) || volume.quantity < 1 || volume.quantity > VOLUME_CAPACITY) problems.push(`${label}_QUANTIDADE_INVALIDA`);
    if (volume.quantity !== volume.trackingCodes.length) problems.push(`${label}_QUANTIDADE_SRO_DIVERGENTE`);
    volume.trackingCodes.forEach((code) => {
      if (!TRACKING_RE.test(code)) problems.push(`${label}_SRO_INVALIDO:${code}`);
      if (seen.has(code)) problems.push(`SRO_DUPLICADO:${code}`);
      else seen.set(code, volume.id || label);
    });
  });

  const objectCodes = (objects || []).map((row) => upper(row?.trackingCode || row?.TRACKING_CODE).replace(/\s/g, "")).filter(Boolean);
  if (objectCodes.length) {
    const objectSet = new Set(objectCodes);
    for (const code of objectSet) if (!seen.has(code)) problems.push(`SRO_FORA_DOS_VOLUMES:${code}`);
    for (const code of seen.keys()) if (!objectSet.has(code)) problems.push(`SRO_VOLUME_NAO_PERTENCE_AO_LOTE:${code}`);
    if (objectSet.size !== seen.size) problems.push("COBERTURA_DOS_VOLUMES_INCOMPLETA");
  }

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index].number !== index + 1) problems.push("NUMERACAO_DE_VOLUMES_NAO_SEQUENCIAL");
  }

  return {
    ready: problems.length === 0 && normalized.length > 0,
    problems: [...new Set(problems)],
    volumes: normalized,
    summary: volumeSummary(normalized),
  };
}

export function volumeSummary(volumes) {
  const normalized = (volumes || []).map(normalizeVolume);
  const summary = {
    totalVolumes: normalized.length,
    totalLabels: 0,
    PAC: { volumes: 0, labels: 0 },
    SEDEX: { volumes: 0, labels: 0 },
    handedOffVolumes: 0,
    handedOffLabels: 0,
  };
  normalized.forEach((volume) => {
    summary.totalLabels += volume.quantity;
    if (summary[volume.service]) {
      summary[volume.service].volumes += 1;
      summary[volume.service].labels += volume.quantity;
    }
    if (["HANDED_OFF", "DELIVERED", "RECEIVED"].includes(volume.status)) {
      summary.handedOffVolumes += 1;
      summary.handedOffLabels += volume.quantity;
    }
  });
  return summary;
}

export function volumeReference(productionBatchId, volume) {
  const id = clean(productionBatchId).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "LOTE";
  const item = normalizeVolume(volume);
  return `VOL-${id}-${String(item.number || 0).padStart(2, "0")}`;
}

export function buildVolumeLabelModels({ productionBatchId, volumes, operationName = "", documentMode = "" }) {
  const validation = validateVolumePlan(volumes);
  if (!validation.ready) throw new Error(`Plano de volumes invalido: ${validation.problems.join(", ")}`);
  return validation.volumes.map((volume) => ({
    ...volume,
    productionBatchId: clean(productionBatchId),
    operationName: clean(operationName),
    documentMode: clean(documentMode),
    reference: volumeReference(productionBatchId, volume),
    firstTrackingCode: volume.trackingCodes[0] || "",
    lastTrackingCode: volume.trackingCodes.at(-1) || "",
  }));
}

export function buildPrintEvents({ campaignId, productionBatchId, volumes }) {
  const validation = validateVolumePlan(volumes);
  if (!campaignId || !productionBatchId) throw new Error("Dados do lote incompletos para registrar impressao.");
  if (!validation.ready) throw new Error(`Plano de volumes invalido: ${validation.problems.join(", ")}`);
  return ["SEDEX", "PAC"].map((service) => ({ service, quantity: validation.summary[service].labels }))
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      campaignId,
      type: PRINT_EVENT,
      sourceType: "PRODUCTION_BATCH",
      sourceId: productionBatchId,
      service: item.service,
      quantity: item.quantity,
      idempotencyKey: `labels-printed:${productionBatchId}:${item.service}`,
      metadata: {
        productionBatchId,
        volumeCount: validation.summary[item.service].volumes,
        physicalPrintConfirmed: true,
      },
    }));
}

export function printStateFromOperations(operations, productionBatchId, volumes) {
  const validation = validateVolumePlan(volumes);
  const expected = ["SEDEX", "PAC"].map((service) => ({
    service,
    quantity: validation.summary[service].labels,
  })).filter((item) => item.quantity > 0);
  const relevant = (operations || []).filter((event) => event.type === PRINT_EVENT && event.sourceId === productionBatchId);
  const services = expected.map((item) => {
    const matching = relevant.filter((event) => normalizeService(event.service) === item.service);
    const quantity = matching.reduce((sum, event) => sum + num(event.quantity), 0);
    return { ...item, recorded: quantity >= item.quantity, recordedQuantity: quantity };
  });
  return { services, ready: expected.length > 0 && services.every((item) => item.recorded) };
}

export function buildHandoffRequest({ campaignId, productionBatchId, volumes, receivedBy, note = "", occurredAt = "" }) {
  const validation = validateVolumePlan(volumes);
  if (!campaignId || !productionBatchId) throw new Error("Dados do lote incompletos para entrega a operacao.");
  if (!validation.ready) throw new Error(`Plano de volumes invalido: ${validation.problems.join(", ")}`);
  const receiver = clean(receivedBy);
  if (receiver.length < 2) throw new Error("Informe quem recebeu os volumes.");
  return {
    campaignId,
    productionBatchId,
    volumeIds: validation.volumes.map((volume) => volume.id),
    receivedBy: receiver.slice(0, 160),
    note: clean(note).slice(0, 800),
    occurredAt: clean(occurredAt),
  };
}
