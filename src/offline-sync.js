import { validateOfflineManifest } from './offline-manifest.js';

export const OFFLINE_SYNC_MODES = Object.freeze({
  NEW_IMPORT: 'NEW_IMPORT',
  RECONCILE_EXISTING: 'RECONCILE_EXISTING',
  EXISTING_UNASSIGNED: 'EXISTING_UNASSIGNED',
  CONFLICT: 'CONFLICT',
  RESUME: 'RESUME',
});

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).replace(/\s/g, '').toUpperCase(); }
function service(value) {
  const current = text(value).toUpperCase();
  if (current.includes('SEDEX')) return 'SEDEX';
  if (current.startsWith('PAC') || current.startsWith('MINI')) return 'PAC';
  return current;
}
function trackingOk(value) { return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code(value)); }
function hashOk(value) { return /^[a-f0-9]{64}$/i.test(text(value)); }

export function canonicalOfflineObjectSet(manifest) {
  const rows = Array.isArray(manifest?.objects) ? manifest.objects : [];
  return rows.map((item) => `${code(item.trackingCode)}|${service(item.service)}`).sort().join('\n');
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 indisponivel neste navegador');
  let bytes;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else bytes = new TextEncoder().encode(String(value || ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function offlineObjectSetSha256(manifest) {
  return sha256Hex(canonicalOfflineObjectSet(manifest));
}

export async function rawFileFingerprint(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Arquivo invalido');
  return {
    name: text(file.name),
    size: Number(file.size || 0),
    type: text(file.type),
    sha256: await sha256Hex(await file.arrayBuffer()),
  };
}

export async function rawFileFingerprints(files) {
  const output = [];
  for (const file of files || []) output.push(await rawFileFingerprint(file));
  return output;
}

export function verifyOfflineSourceFiles(manifest, selectedFingerprints) {
  const expected = Array.isArray(manifest?.sourceFiles) ? manifest.sourceFiles : [];
  const selected = Array.isArray(selectedFingerprints) ? selectedFingerprints : [];
  const expectedByHash = new Map(expected.filter((item) => hashOk(item.sha256)).map((item) => [text(item.sha256).toLowerCase(), item]));
  const selectedByHash = new Map(selected.filter((item) => hashOk(item.sha256)).map((item) => [text(item.sha256).toLowerCase(), item]));
  const missing = [];
  const matched = [];
  for (const [sha256, item] of expectedByHash) {
    if (!selectedByHash.has(sha256)) missing.push({ name: text(item.name), sha256 });
    else matched.push({ expected: item, selected: selectedByHash.get(sha256) });
  }
  const unexpected = selected.filter((item) => !expectedByHash.has(text(item.sha256).toLowerCase()));
  return { exact: missing.length === 0, missing, unexpected, matched };
}

export function classifyOfflineOverlap(manifest, backendMatches = []) {
  const validation = validateOfflineManifest(manifest);
  if (!validation.valid) return { mode: OFFLINE_SYNC_MODES.CONFLICT, reason: 'MANIFEST_INVALID', problems: validation.problems };
  const expected = new Map((manifest.objects || []).map((item) => [code(item.trackingCode), service(item.service)]));
  const matches = Array.isArray(backendMatches) ? backendMatches : [];
  if (!matches.length) return { mode: OFFLINE_SYNC_MODES.NEW_IMPORT, matched: 0, expected: expected.size };

  const byCode = new Map();
  const duplicates = [];
  for (const row of matches) {
    const trackingCode = code(row.trackingCode || row.TRACKING_CODE || row.object || row.sro);
    if (!expected.has(trackingCode)) continue;
    if (byCode.has(trackingCode)) duplicates.push(trackingCode);
    else byCode.set(trackingCode, row);
  }
  const missing = [];
  const serviceMismatch = [];
  for (const [trackingCode, expectedService] of expected) {
    const row = byCode.get(trackingCode);
    if (!row) missing.push(trackingCode);
    else {
      const actualService = service(row.service || row.SERVICE);
      if (actualService !== expectedService) serviceMismatch.push({ trackingCode, expectedService, actualService });
    }
  }
  const productionBatchIds = [...new Set([...byCode.values()].map((row) => text(row.productionBatchId || row.PRODUCTION_BATCH_ID)).filter(Boolean))];
  if (duplicates.length || missing.length || serviceMismatch.length) {
    return {
      mode: OFFLINE_SYNC_MODES.CONFLICT,
      reason: 'OBJECT_OVERLAP_CONFLICT',
      matched: byCode.size,
      expected: expected.size,
      duplicates: [...new Set(duplicates)],
      missing,
      serviceMismatch,
      productionBatchIds,
    };
  }
  if (productionBatchIds.length === 1) {
    return { mode: OFFLINE_SYNC_MODES.RECONCILE_EXISTING, matched: byCode.size, expected: expected.size, productionBatchId: productionBatchIds[0] };
  }
  if (productionBatchIds.length === 0) {
    return { mode: OFFLINE_SYNC_MODES.EXISTING_UNASSIGNED, matched: byCode.size, expected: expected.size };
  }
  return {
    mode: OFFLINE_SYNC_MODES.CONFLICT,
    reason: 'MULTIPLE_PRODUCTION_BATCHES',
    matched: byCode.size,
    expected: expected.size,
    productionBatchIds,
  };
}

export function buildOfflineSyncInspectPayload({ campaignId, manifest, objectSetSha256, manifestSha256 }) {
  const validation = validateOfflineManifest(manifest);
  if (!validation.valid) throw new Error(`Manifesto invalido: ${validation.problems.join(', ')}`);
  if (!text(campaignId)) throw new Error('Campanha obrigatoria');
  if (!hashOk(objectSetSha256)) throw new Error('Hash do conjunto de objetos invalido');
  if (!hashOk(manifestSha256)) throw new Error('Hash do manifesto invalido');
  return {
    campaignId: text(campaignId),
    localBatchId: text(manifest.batchId),
    documentMode: text(manifest.documentMode),
    objectSetSha256: text(objectSetSha256).toLowerCase(),
    manifestSha256: text(manifestSha256).toLowerCase(),
    total: Number(manifest.summary?.total || 0),
    pac: Number(manifest.summary?.pac || 0),
    sedex: Number(manifest.summary?.sedex || 0),
    operationReference: text(manifest.operationReference),
    operationName: text(manifest.operationName),
    manifestCreatedAt: text(manifest.createdAt),
    sender: manifest.sender || {},
    sourceFiles: (manifest.sourceFiles || []).map((item) => ({ name: text(item.name), size: Number(item.size || 0), type: text(item.type), sha256: text(item.sha256).toLowerCase() })),
    objects: (manifest.objects || []).map((item) => ({ trackingCode: code(item.trackingCode), service: service(item.service) })),
  };
}

export function buildOfflineSyncStartPayload(args) {
  const inspect = buildOfflineSyncInspectPayload(args);
  return {
    ...inspect,
    operationEvents: (args.manifest.operationEvents || []).map((event) => ({
      id: text(event.id),
      type: text(event.type).toUpperCase(),
      service: service(event.service),
      quantity: Number(event.quantity || 0),
      occurredAt: text(event.occurredAt),
      trackingCode: code(event.trackingCode),
      receivedBy: text(event.receivedBy),
      note: text(event.note),
      metadata: event.metadata || {},
    })),
  };
}

export function chunkOfflineRows(rows, size = 200) {
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error('Tamanho de bloco invalido');
  const source = Array.isArray(rows) ? rows : [];
  const chunks = [];
  for (let index = 0; index < source.length; index += size) chunks.push(source.slice(index, index + size));
  return chunks;
}

export function summarizeOfflineSyncPlan({ manifest, inspectResult, sourceVerification = null }) {
  const mode = text(inspectResult?.mode);
  const base = {
    mode,
    total: Number(manifest?.summary?.total || 0),
    pac: Number(manifest?.summary?.pac || 0),
    sedex: Number(manifest?.summary?.sedex || 0),
    needsSourceFiles: mode === OFFLINE_SYNC_MODES.NEW_IMPORT,
    canProceed: false,
    message: '',
  };
  if (mode === OFFLINE_SYNC_MODES.NEW_IMPORT) {
    base.canProceed = !!sourceVerification?.exact;
    base.message = base.canProceed
      ? 'Lote novo: fontes originais conferidas por SHA-256 e prontas para reimportacao.'
      : 'Lote novo: selecione novamente o CSV e todos os PDFs originais para conferir os hashes antes da sincronizacao.';
    return base;
  }
  if (mode === OFFLINE_SYNC_MODES.RESUME && inspectResult?.sync?.mode === OFFLINE_SYNC_MODES.NEW_IMPORT && inspectResult?.sync?.status === 'RECEIVING') {
    base.needsSourceFiles = true;
    base.canProceed = !!sourceVerification?.exact;
    base.message = base.canProceed
      ? 'Sincronizacao de lote novo retomada: fontes conferidas e blocos podem ser reenviados com seguranca.'
      : 'Sincronizacao de lote novo incompleta: selecione novamente o CSV e os PDFs originais para retomar.';
    return base;
  }
  if (mode === OFFLINE_SYNC_MODES.RECONCILE_EXISTING || mode === OFFLINE_SYNC_MODES.RESUME) {
    base.canProceed = true;
    base.message = 'Os objetos ja existem no sistema conectado; a sincronizacao apenas reconcilia o lote e os eventos locais sem duplicar objetos.';
    return base;
  }
  if (mode === OFFLINE_SYNC_MODES.EXISTING_UNASSIGNED) {
    base.message = 'Os objetos existem, mas ainda nao estao vinculados a um unico lote de producao. Revisao administrativa obrigatoria.';
    return base;
  }
  base.message = 'Conflito detectado. A sincronizacao automatica foi bloqueada.';
  return base;
}
