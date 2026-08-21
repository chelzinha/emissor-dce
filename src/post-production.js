export const POST_PRODUCTION_VERSION = "2026.08.21-local.10";
export const VOLUME_CAPACITY = 250;
export const TRACKING_RE = /^[A-Z]{2}\d{9}BR$/;
export const SERVICE_ORDER = Object.freeze(["SEDEX", "PAC"]);

export function normalizeTrackingCode(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

export function normalizeService(value) {
  const text = String(value || "").trim().toUpperCase();
  if (text.includes("SEDEX")) return "SEDEX";
  if (text.startsWith("PAC")) return "PAC";
  return text;
}

export function serviceTotals(objects) {
  const totals = { PAC: 0, SEDEX: 0, total: 0 };
  for (const object of objects || []) {
    const service = normalizeService(object.service);
    if (service === "PAC") totals.PAC += 1;
    else if (service === "SEDEX") totals.SEDEX += 1;
    totals.total += 1;
  }
  return totals;
}

export function servicesPresent(objects) {
  const totals = serviceTotals(objects);
  return SERVICE_ORDER.filter((service) => totals[service] > 0);
}

export function validateObjectsForVolumes(objects) {
  const errors = [];
  const seen = new Set();
  for (const [index, source] of (objects || []).entries()) {
    const trackingCode = normalizeTrackingCode(source.trackingCode);
    const service = normalizeService(source.service);
    if (!TRACKING_RE.test(trackingCode)) errors.push(`OBJETO_${index + 1}_SRO_INVALIDO`);
    if (!SERVICE_ORDER.includes(service)) errors.push(`OBJETO_${index + 1}_SERVICO_INVALIDO`);
    if (trackingCode && seen.has(trackingCode)) errors.push(`SRO_DUPLICADO:${trackingCode}`);
    if (trackingCode) seen.add(trackingCode);
  }
  return [...new Set(errors)];
}

export function planPhysicalVolumes(objects, options = {}) {
  const capacity = Number(options.capacity ?? VOLUME_CAPACITY);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > VOLUME_CAPACITY) {
    throw new Error(`Capacidade deve ser inteira entre 1 e ${VOLUME_CAPACITY}`);
  }
  const errors = validateObjectsForVolumes(objects);
  if (errors.length) throw new Error(errors.join(" | "));

  const normalized = (objects || []).map((object, inputIndex) => ({
    ...object,
    inputIndex,
    trackingCode: normalizeTrackingCode(object.trackingCode),
    service: normalizeService(object.service),
  }));
  const drafts = [];
  for (const service of SERVICE_ORDER) {
    const rows = normalized.filter((row) => row.service === service);
    for (let start = 0; start < rows.length; start += capacity) {
      drafts.push({ service, rows: rows.slice(start, start + capacity) });
    }
  }
  const totalVolumes = drafts.length;
  return drafts.map((draft, index) => ({
    key: `V${String(index + 1).padStart(3, "0")}`,
    number: index + 1,
    totalVolumes,
    service: draft.service,
    quantity: draft.rows.length,
    trackingCodes: draft.rows.map((row) => row.trackingCode),
    firstTrackingCode: draft.rows[0]?.trackingCode || "",
    lastTrackingCode: draft.rows.at(-1)?.trackingCode || "",
  }));
}

export function validateVolumePlan(volumes, objects, options = {}) {
  const capacity = Number(options.capacity ?? VOLUME_CAPACITY);
  const errors = [];
  const expected = new Map();
  for (const source of objects || []) {
    const sro = normalizeTrackingCode(source.trackingCode);
    if (sro) expected.set(sro, normalizeService(source.service));
  }
  const seen = new Set();
  const totalVolumes = (volumes || []).length;
  for (const volume of volumes || []) {
    const service = normalizeService(volume.service);
    const trackingCodes = (volume.trackingCodes || []).map(normalizeTrackingCode);
    if (!SERVICE_ORDER.includes(service)) errors.push(`VOLUME_${volume.number}_SERVICO_INVALIDO`);
    if (trackingCodes.length < 1 || trackingCodes.length > capacity) errors.push(`VOLUME_${volume.number}_QUANTIDADE_INVALIDA`);
    if (Number(volume.quantity) !== trackingCodes.length) errors.push(`VOLUME_${volume.number}_QUANTIDADE_DIVERGENTE`);
    if (Number(volume.totalVolumes) !== totalVolumes) errors.push(`VOLUME_${volume.number}_TOTAL_VOLUMES_DIVERGENTE`);
    for (const sro of trackingCodes) {
      if (seen.has(sro)) errors.push(`VOLUME_SRO_DUPLICADO:${sro}`);
      seen.add(sro);
      if (!expected.has(sro)) errors.push(`VOLUME_SRO_DESCONHECIDO:${sro}`);
      else if (expected.get(sro) !== service) errors.push(`VOLUME_SERVICO_DIVERGENTE:${sro}`);
    }
  }
  for (const sro of expected.keys()) if (!seen.has(sro)) errors.push(`VOLUME_SRO_AUSENTE:${sro}`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function approvalService(value) {
  return normalizeService(value?.service || value?.metadata?.service || "");
}

export function summarizeLabelTestApprovals(objects, approvals = []) {
  const requiredServices = servicesPresent(objects);
  const approved = new Set();
  for (const item of approvals || []) {
    const service = approvalService(item);
    if (requiredServices.includes(service) && item.approved !== false) approved.add(service);
  }
  const missing = requiredServices.filter((service) => !approved.has(service));
  return { requiredServices, approvedServices: [...approved], missingServices: missing, ready: missing.length === 0 };
}

export function summarizePrintConfirmations(objects, confirmations = []) {
  const totals = serviceTotals(objects);
  const requiredServices = servicesPresent(objects);
  const confirmed = { PAC: 0, SEDEX: 0 };
  for (const item of confirmations || []) {
    const service = normalizeService(item.service || item.metadata?.service);
    if (!requiredServices.includes(service)) continue;
    const quantity = Number(item.quantity || 0);
    if (Number.isFinite(quantity)) confirmed[service] = Math.max(confirmed[service], quantity);
  }
  const byService = {};
  for (const service of requiredServices) {
    byService[service] = {
      expected: totals[service],
      confirmed: confirmed[service],
      ready: confirmed[service] === totals[service],
    };
  }
  return {
    byService,
    requiredServices,
    ready: requiredServices.every((service) => byService[service].ready),
  };
}

export function derivePostProductionStatus({ objects = [], approvals = [], printConfirmations = [], handedOff = false } = {}) {
  if (!objects.length) return "EMPTY";
  if (handedOff) return "HANDED_OFF";
  const tests = summarizeLabelTestApprovals(objects, approvals);
  if (!tests.ready) return "READY_FOR_LABEL_TEST";
  const printing = summarizePrintConfirmations(objects, printConfirmations);
  if (!printing.ready) {
    const anyPrinted = Object.values(printing.byService).some((row) => row.confirmed > 0);
    return anyPrinted ? "PRINTING" : "READY_FOR_PRINT";
  }
  return "PRINTED";
}

export function handoffReadiness({ objects = [], volumes = [], approvals = [], printConfirmations = [], receiver = "" } = {}) {
  const reasons = [];
  const objectErrors = validateObjectsForVolumes(objects);
  if (objectErrors.length) reasons.push(...objectErrors);
  const volumeValidation = validateVolumePlan(volumes, objects);
  if (!volumeValidation.valid) reasons.push(...volumeValidation.errors);
  const tests = summarizeLabelTestApprovals(objects, approvals);
  if (!tests.ready) reasons.push(`ETIQUETA_TESTE_PENDENTE:${tests.missingServices.join(",")}`);
  const printing = summarizePrintConfirmations(objects, printConfirmations);
  if (!printing.ready) {
    const missing = printing.requiredServices.filter((service) => !printing.byService[service].ready);
    reasons.push(`IMPRESSAO_PENDENTE:${missing.join(",")}`);
  }
  if (!String(receiver || "").trim()) reasons.push("RECEBEDOR_OBRIGATORIO");
  return {
    ready: reasons.length === 0,
    reasons: [...new Set(reasons)],
    total: objects.length,
    services: servicesPresent(objects),
    volumes: volumes.length,
  };
}

export function buildHandoffRecord({ productionBatchId, campaignId, objects, volumes, approvals, printConfirmations, receiver, occurredAt = "" }) {
  const check = handoffReadiness({ objects, volumes, approvals, printConfirmations, receiver });
  if (!check.ready) throw new Error(check.reasons.join(" | "));
  const cleanReceiver = String(receiver).replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    campaignId: String(campaignId || ""),
    productionBatchId: String(productionBatchId || ""),
    receiver: cleanReceiver,
    occurredAt: String(occurredAt || ""),
    quantity: objects.length,
    volumeCount: volumes.length,
    services: servicesPresent(objects),
    idempotencyKey: `label-handoff:${String(productionBatchId || "")}`,
  };
}

export function buildVolumeLabelModels(volumes, context = {}) {
  const operationName = String(context.operationName || context.name || "Operacao postal").trim();
  const batchId = String(context.productionBatchId || context.batchId || "").trim();
  const cnpj = String(context.cnpj || "").replace(/\D/g, "");
  return (volumes || []).map((volume) => ({
    title: "CONTROLE INTERNO DE VOLUME",
    operationName,
    cnpj,
    productionBatchId: batchId,
    volumeNumber: Number(volume.number || 0),
    totalVolumes: Number(volume.totalVolumes || volumes.length),
    service: normalizeService(volume.service),
    quantity: Number(volume.quantity || 0),
    firstTrackingCode: normalizeTrackingCode(volume.firstTrackingCode || volume.trackingCodes?.[0]),
    lastTrackingCode: normalizeTrackingCode(volume.lastTrackingCode || volume.trackingCodes?.at?.(-1)),
    trackingCodes: (volume.trackingCodes || []).map(normalizeTrackingCode),
  }));
}
