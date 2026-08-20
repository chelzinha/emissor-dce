const MANIFEST_VERSION = 1;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeService(value) {
  const service = text(value).toUpperCase();
  if (service.startsWith("SEDEX")) return "SEDEX";
  if (service.startsWith("PAC")) return "PAC";
  return service;
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 indisponivel neste navegador");
  let bytes;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else bytes = new TextEncoder().encode(String(value || ""));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fileFingerprint(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Arquivo invalido para fingerprint");
  return {
    name: text(file.name),
    size: Number(file.size || 0),
    type: text(file.type),
    sha256: await sha256Hex(await file.arrayBuffer()),
  };
}

export function summarizeObjects(rows) {
  const summary = { total: rows.length, pac: 0, sedex: 0, matrixVerified: 0, matrixPending: 0 };
  rows.forEach((row) => {
    const service = normalizeService(row.service);
    if (service === "PAC") summary.pac += 1;
    if (service === "SEDEX") summary.sedex += 1;
    if (["AUTO_VERIFIED", "VERIFIED"].includes(String(row.matrix?.status || ""))) summary.matrixVerified += 1;
    else summary.matrixPending += 1;
  });
  return summary;
}

export function buildContingencyManifest({
  batchId,
  campaignReference = "",
  documentMode,
  rows,
  volumes = [],
  sourceFiles = [],
  generatedFiles = [],
  operator = {},
  appVersion = "",
  createdAt = new Date().toISOString(),
}) {
  if (!text(batchId)) throw new Error("Identificador do lote obrigatorio");
  if (!Array.isArray(rows) || !rows.length) throw new Error("O lote precisa conter objetos");
  const objects = rows.map((row) => ({
    trackingCode: text(row.trackingCode).replace(/\s/g, "").toUpperCase(),
    service: normalizeService(row.service),
    matrixStatus: text(row.matrix?.status || "MISSING"),
    matrixOrigin: text(row.matrix?.origin),
    stripe: text(row.matrix?.stripe || row.stripe).toUpperCase(),
    reference: text(row.reference),
    accessKey: text(row.accessKey).replace(/\D/g, ""),
    protocol: text(row.protocol).replace(/\D/g, ""),
  }));
  return {
    schema: "agf-election-local-manifest",
    version: MANIFEST_VERSION,
    batchId: text(batchId),
    campaignReference: text(campaignReference),
    documentMode: text(documentMode),
    createdAt: text(createdAt),
    appVersion: text(appVersion),
    operator: { id: text(operator.id), email: text(operator.email) },
    summary: summarizeObjects(rows),
    sourceFiles: sourceFiles.map((file) => ({ ...file })),
    generatedFiles: generatedFiles.map((file) => ({ ...file })),
    volumes: volumes.map((volume) => ({
      number: Number(volume.number || 0),
      totalVolumes: Number(volume.totalVolumes || volumes.length),
      service: normalizeService(volume.service),
      quantity: Number(volume.quantity || 0),
      trackingCodes: Array.isArray(volume.trackingCodes) ? volume.trackingCodes.map((code) => text(code).replace(/\s/g, "").toUpperCase()) : [],
    })),
    objects,
  };
}

export function validateContingencyManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.schema !== "agf-election-local-manifest") errors.push("SCHEMA_INVALIDO");
  if (Number(manifest?.version) !== MANIFEST_VERSION) errors.push("VERSAO_NAO_SUPORTADA");
  if (!text(manifest?.batchId)) errors.push("LOTE_AUSENTE");
  if (!Array.isArray(manifest?.objects) || !manifest.objects.length) errors.push("OBJETOS_AUSENTES");
  const tracking = new Set();
  for (const object of manifest?.objects || []) {
    const code = text(object.trackingCode).replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) errors.push(`SRO_INVALIDO:${code || "VAZIO"}`);
    if (tracking.has(code)) errors.push(`SRO_DUPLICADO:${code}`);
    tracking.add(code);
    if (!["PAC", "SEDEX"].includes(normalizeService(object.service))) errors.push(`SERVICO_INVALIDO:${code}`);
  }
  const declaredTotal = Number(manifest?.summary?.total || 0);
  if (declaredTotal !== (manifest?.objects?.length || 0)) errors.push("TOTAL_DIVERGENTE");
  const volumeCodes = new Set();
  for (const volume of manifest?.volumes || []) {
    if (Number(volume.quantity || 0) > 250) errors.push(`VOLUME_ACIMA_250:${volume.number}`);
    for (const code of volume.trackingCodes || []) {
      if (volumeCodes.has(code)) errors.push(`OBJETO_EM_DOIS_VOLUMES:${code}`);
      volumeCodes.add(code);
      const object = (manifest.objects || []).find((item) => item.trackingCode === code);
      if (!object) errors.push(`OBJETO_VOLUME_INEXISTENTE:${code}`);
      else if (normalizeService(object.service) !== normalizeService(volume.service)) errors.push(`VOLUME_MISTURA_SERVICO:${code}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function serializeContingencyManifest(manifest) {
  const validation = validateContingencyManifest(manifest);
  if (!validation.valid) throw new Error(`Manifesto invalido: ${validation.errors.join(", ")}`);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseContingencyManifest(textValue) {
  let manifest;
  try { manifest = JSON.parse(String(textValue || "")); }
  catch { throw new Error("Arquivo de contingencia nao contem JSON valido"); }
  const validation = validateContingencyManifest(manifest);
  if (!validation.valid) throw new Error(`Arquivo de contingencia invalido: ${validation.errors.join(", ")}`);
  return manifest;
}
