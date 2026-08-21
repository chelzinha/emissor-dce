export const OFFLINE_MANIFEST_SCHEMA = 'agf-postal-operations-local-manifest';
export const OFFLINE_MANIFEST_VERSION = 3;
export const OFFLINE_VOLUME_CAPACITY = 250;
export const OFFLINE_DOCUMENT_MODES = Object.freeze(['SIMPLIFIED_DECLARATION', 'DCE_AUTHORIZED']);
export const OFFLINE_MATRIX_OK = Object.freeze(['AUTO_VERIFIED', 'VERIFIED']);
export const OFFLINE_EVENT_TYPES = Object.freeze(['LABEL_TEST_APPROVED', 'LABEL_PRINTED', 'LABEL_HANDOFF']);

function text(value) { return String(value == null ? '' : value).trim(); }
function digits(value) { return text(value).replace(/\D/g, ''); }
function code(value) { return text(value).replace(/\s/g, '').toUpperCase(); }
function service(value) {
  const current = text(value).toUpperCase();
  if (current.includes('SEDEX')) return 'SEDEX';
  if (current.startsWith('PAC') || current.startsWith('MINI')) return 'PAC';
  return current;
}
function trackingOk(value) { return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code(value)); }
function hashOk(value) { return /^[a-f0-9]{64}$/i.test(text(value)); }
function validIso(value) { return !Number.isNaN(Date.parse(text(value))); }

function eventTotals(events, type) {
  const totals = { PAC: 0, SEDEX: 0 };
  for (const event of events.filter((item) => text(item.type).toUpperCase() === type)) {
    const normalizedService = service(event.service);
    if (totals[normalizedService] != null) totals[normalizedService] += Number(event.quantity || 0);
  }
  return totals;
}

export function validateOfflineManifest(manifest) {
  const problems = [];
  if (!manifest || manifest.schema !== OFFLINE_MANIFEST_SCHEMA) problems.push('SCHEMA_INVALIDO');
  if (Number(manifest?.version) !== OFFLINE_MANIFEST_VERSION) problems.push('VERSAO_NAO_SUPORTADA');
  if (!text(manifest?.batchId)) problems.push('LOTE_AUSENTE');
  if (!OFFLINE_DOCUMENT_MODES.includes(text(manifest?.documentMode))) problems.push('MODO_DOCUMENTAL_INVALIDO');

  const objects = Array.isArray(manifest?.objects) ? manifest.objects : [];
  if (!objects.length) problems.push('OBJETOS_AUSENTES');
  if (Number(manifest?.summary?.total || 0) !== objects.length) problems.push('TOTAL_DIVERGENTE');

  const objectByCode = new Map();
  for (const object of objects) {
    const trackingCode = code(object.trackingCode);
    if (!trackingOk(trackingCode)) problems.push(`SRO_INVALIDO:${trackingCode || 'VAZIO'}`);
    if (objectByCode.has(trackingCode)) problems.push(`SRO_DUPLICADO:${trackingCode}`);
    objectByCode.set(trackingCode, object);
    const normalizedService = service(object.service);
    if (!['PAC', 'SEDEX'].includes(normalizedService)) problems.push(`SERVICO_INVALIDO:${trackingCode}`);
    if (!OFFLINE_MATRIX_OK.includes(text(object.matrixStatus).toUpperCase())) problems.push(`MATRIX_NAO_VERIFICADO:${trackingCode}`);
    if (manifest?.documentMode === 'DCE_AUTHORIZED') {
      if (digits(object.accessKey).length !== 44) problems.push(`CHAVE_DCE_INVALIDA:${trackingCode}`);
      if (!text(object.protocol)) problems.push(`PROTOCOLO_DCE_AUSENTE:${trackingCode}`);
    }
  }

  const summaryPac = objects.filter((item) => service(item.service) === 'PAC').length;
  const summarySedex = objects.filter((item) => service(item.service) === 'SEDEX').length;
  if (Number(manifest?.summary?.pac || 0) !== summaryPac) problems.push('TOTAL_PAC_DIVERGENTE');
  if (Number(manifest?.summary?.sedex || 0) !== summarySedex) problems.push('TOTAL_SEDEX_DIVERGENTE');
  if (Number(manifest?.summary?.matrixVerified || 0) !== objects.length) problems.push('TOTAL_MATRIX_DIVERGENTE');
  if (Number(manifest?.summary?.matrixPending || 0) !== 0) problems.push('MATRIX_PENDENTE');

  const tests = Array.isArray(manifest?.physicalTests) ? manifest.physicalTests : [];
  const requiredServices = [...new Set(objects.map((item) => service(item.service)).filter((item) => ['PAC', 'SEDEX'].includes(item)))];
  for (const required of requiredServices) {
    const match = tests.find((item) => service(item.service) === required && item.approved === true && trackingOk(item.trackingCode));
    if (!match) problems.push(`TESTE_FISICO_AUSENTE:${required}`);
  }

  const volumeCodes = new Set();
  const volumes = Array.isArray(manifest?.volumes) ? manifest.volumes : [];
  for (const volume of volumes) {
    const trackingCodes = Array.isArray(volume.trackingCodes) ? volume.trackingCodes.map(code) : [];
    if (trackingCodes.length > OFFLINE_VOLUME_CAPACITY) problems.push(`VOLUME_ACIMA_250:${volume.number}`);
    if (Number(volume.quantity || 0) !== trackingCodes.length) problems.push(`VOLUME_QUANTIDADE_DIVERGENTE:${volume.number}`);
    const volumeService = service(volume.service);
    if (!['PAC', 'SEDEX'].includes(volumeService)) problems.push(`VOLUME_SERVICO_INVALIDO:${volume.number}`);
    for (const trackingCode of trackingCodes) {
      if (volumeCodes.has(trackingCode)) problems.push(`OBJETO_EM_DOIS_VOLUMES:${trackingCode}`);
      volumeCodes.add(trackingCode);
      const object = objectByCode.get(trackingCode);
      if (!object) problems.push(`OBJETO_VOLUME_INEXISTENTE:${trackingCode}`);
      else if (service(object.service) !== volumeService) problems.push(`VOLUME_MISTURA_SERVICO:${trackingCode}`);
    }
  }
  if (volumeCodes.size !== objects.length || [...objectByCode.keys()].some((item) => !volumeCodes.has(item))) problems.push('COBERTURA_VOLUMES_DIVERGENTE');

  const sourceFiles = Array.isArray(manifest?.sourceFiles) ? manifest.sourceFiles : [];
  if (!sourceFiles.length) problems.push('FONTES_AUSENTES');
  for (const file of sourceFiles) if (!hashOk(file.sha256)) problems.push(`HASH_FONTE_INVALIDO:${text(file.name)}`);
  for (const file of Array.isArray(manifest?.generatedFiles) ? manifest.generatedFiles : []) {
    if (!hashOk(file.sha256)) problems.push(`HASH_GERADO_INVALIDO:${text(file.name)}`);
  }

  const events = Array.isArray(manifest?.operationEvents) ? manifest.operationEvents : [];
  const eventIds = new Set();
  for (const event of events) {
    const eventId = text(event.id);
    const type = text(event.type).toUpperCase();
    const normalizedService = service(event.service);
    const quantity = Number(event.quantity || 0);
    if (!eventId) problems.push('EVENTO_ID_AUSENTE');
    else if (eventIds.has(eventId)) problems.push(`EVENTO_DUPLICADO:${eventId}`);
    eventIds.add(eventId);
    if (!OFFLINE_EVENT_TYPES.includes(type)) problems.push(`EVENTO_TIPO_INVALIDO:${eventId || type}`);
    if (!['PAC', 'SEDEX'].includes(normalizedService)) problems.push(`EVENTO_SERVICO_INVALIDO:${eventId || type}`);
    if (!Number.isInteger(quantity) || quantity < 1) problems.push(`EVENTO_QUANTIDADE_INVALIDA:${eventId || type}`);
    if (!validIso(event.occurredAt)) problems.push(`EVENTO_DATA_INVALIDA:${eventId || type}`);
    if (type === 'LABEL_TEST_APPROVED' && !trackingOk(event.trackingCode)) problems.push(`EVENTO_TESTE_SRO_INVALIDO:${eventId}`);
    if (type === 'LABEL_HANDOFF' && text(event.receivedBy).length < 2) problems.push(`EVENTO_RECEBEDOR_AUSENTE:${eventId}`);
  }

  const printed = eventTotals(events, 'LABEL_PRINTED');
  const handedOff = eventTotals(events, 'LABEL_HANDOFF');
  const serviceTotals = { PAC: summaryPac, SEDEX: summarySedex };
  for (const current of ['PAC', 'SEDEX']) {
    if (printed[current] > serviceTotals[current]) problems.push(`IMPRESSAO_ACIMA_TOTAL:${current}`);
    if (printed[current] > 0 && printed[current] !== serviceTotals[current]) problems.push(`IMPRESSAO_PARCIAL_NAO_PERMITIDA:${current}`);
    if (handedOff[current] > serviceTotals[current]) problems.push(`ENTREGA_ACIMA_TOTAL:${current}`);
    if (handedOff[current] > 0 && printed[current] < serviceTotals[current]) problems.push(`ENTREGA_SEM_IMPRESSAO_INTEGRAL:${current}`);
    if (handedOff[current] > 0 && handedOff[current] !== serviceTotals[current]) problems.push(`ENTREGA_PARCIAL_NAO_PERMITIDA:${current}`);
  }
  if (handedOff.PAC > 0 || handedOff.SEDEX > 0) {
    for (const current of ['PAC', 'SEDEX']) {
      if (serviceTotals[current] > 0 && handedOff[current] !== serviceTotals[current]) problems.push(`ENTREGA_LOTE_INCOMPLETA:${current}`);
    }
  }

  return {
    valid: problems.length === 0,
    problems: [...new Set(problems)],
    summary: {
      total: objects.length,
      pac: summaryPac,
      sedex: summarySedex,
      volumes: volumes.length,
      tests: tests.length,
      events: events.length,
      printed,
      handedOff,
    },
  };
}

export function upgradeOfflineManifest(manifest) {
  if (manifest && manifest.schema === OFFLINE_MANIFEST_SCHEMA && Number(manifest.version) === 2) {
    return { ...manifest, version: OFFLINE_MANIFEST_VERSION, operationEvents: Array.isArray(manifest.operationEvents) ? manifest.operationEvents : [] };
  }
  return manifest;
}

export function parseOfflineManifest(content) {
  let manifest;
  try { manifest = JSON.parse(String(content || '')); }
  catch { throw new Error('MANIFESTO_JSON_INVALIDO'); }
  manifest = upgradeOfflineManifest(manifest);
  const validation = validateOfflineManifest(manifest);
  if (!validation.valid) throw new Error(`MANIFESTO_INVALIDO:${validation.problems.join(',')}`);
  return manifest;
}

export function compareOfflineManifestObjects(manifest, backendObjects = []) {
  const manifestMap = new Map((manifest?.objects || []).map((item) => [code(item.trackingCode), service(item.service)]));
  const backendMap = new Map((backendObjects || []).map((item) => [code(item.trackingCode || item.object || item.sro), service(item.service)]));
  const missingInBackend = [];
  const extraInBackend = [];
  const serviceMismatch = [];
  for (const [trackingCode, expectedService] of manifestMap) {
    if (!backendMap.has(trackingCode)) missingInBackend.push(trackingCode);
    else if (backendMap.get(trackingCode) !== expectedService) serviceMismatch.push({ trackingCode, manifestService: expectedService, backendService: backendMap.get(trackingCode) });
  }
  for (const trackingCode of backendMap.keys()) if (!manifestMap.has(trackingCode)) extraInBackend.push(trackingCode);
  return {
    exact: missingInBackend.length === 0 && extraInBackend.length === 0 && serviceMismatch.length === 0,
    missingInBackend,
    extraInBackend,
    serviceMismatch,
  };
}
