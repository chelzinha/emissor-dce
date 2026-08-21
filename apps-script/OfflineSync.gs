function offlineSyncText_(value) {
  return String(value == null ? '' : value).trim();
}

function offlineSyncCode_(value) {
  return offlineSyncText_(value).replace(/\s/g, '').toUpperCase();
}

function offlineSyncService_(value) {
  const current = offlineSyncText_(value).toUpperCase();
  if (current.indexOf('SEDEX') !== -1) return 'SEDEX';
  if (current.indexOf('PAC') === 0 || current.indexOf('MINI') === 0) return 'PAC';
  return current;
}

function offlineSyncHashOk_(value) {
  return /^[a-f0-9]{64}$/i.test(offlineSyncText_(value));
}

function offlineSyncTrackingOk_(value) {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(offlineSyncCode_(value));
}

function offlineSyncHexDigest_(textValue) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(textValue || ''), Utilities.Charset.UTF_8);
  return bytes.map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function offlineSyncObjectSetHash_(rows) {
  const canonical = rows.map(function(row) {
    return offlineSyncCode_(row.trackingCode || row.TRACKING_CODE) + '|' + offlineSyncService_(row.service || row.SERVICE);
  }).sort().join('\n');
  return offlineSyncHexDigest_(canonical);
}

function offlineSyncByLocalBatch_(campaignId, localBatchId) {
  return findRow_('OFFLINE_SYNCS', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.LOCAL_BATCH_ID) === String(localBatchId);
  });
}

function offlineSyncStagedRows_(syncId) {
  return sheetRows_(getSheet_('OFFLINE_SYNC_OBJECTS')).filter(function(row) {
    return String(row.SYNC_ID) === String(syncId);
  });
}

function offlineSyncPublic_(row) {
  if (!row) return null;
  return {
    id: String(row.ID || ''),
    campaignId: String(row.CAMPAIGN_ID || ''),
    localBatchId: String(row.LOCAL_BATCH_ID || ''),
    status: String(row.STATUS || ''),
    mode: String(row.MODE || ''),
    documentMode: String(row.DOCUMENT_MODE || ''),
    objectSetSha256: String(row.OBJECT_SET_SHA256 || ''),
    manifestSha256: String(row.MANIFEST_SHA256 || ''),
    total: Number(row.TOTAL || 0),
    pac: Number(row.PAC || 0),
    sedex: Number(row.SEDEX || 0),
    productionBatchId: String(row.PRODUCTION_BATCH_ID || ''),
    portalReturnId: String(row.PORTAL_RETURN_ID || ''),
    source: safeJsonParse_(row.SOURCE_JSON, {}),
    events: safeJsonParse_(row.EVENTS_JSON, []),
    createdAt: String(row.CREATED_AT || ''),
    updatedAt: String(row.UPDATED_AT || '')
  };
}

function offlineSyncNormalizeObjects_(payload) {
  const rows = Array.isArray(payload.objects) ? payload.objects : [];
  if (!rows.length) throw new Error('Manifesto sem objetos para sincronizar.');
  if (rows.length > 10000) throw new Error('Manifesto acima do limite de seguranca.');
  const seen = {};
  return rows.map(function(source) {
    const trackingCode = offlineSyncCode_(source.trackingCode);
    const service = offlineSyncService_(source.service);
    if (!offlineSyncTrackingOk_(trackingCode)) throw new Error('SRO invalido no manifesto: ' + (trackingCode || 'VAZIO'));
    if (seen[trackingCode]) throw new Error('SRO duplicado no manifesto: ' + trackingCode);
    seen[trackingCode] = true;
    if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico invalido no manifesto: ' + trackingCode);
    return { trackingCode: trackingCode, service: service };
  });
}

function offlineSyncValidateHeader_(payload) {
  const campaignId = offlineSyncText_(payload.campaignId);
  const localBatchId = offlineSyncText_(payload.localBatchId);
  const documentMode = productionDocumentMode_(payload.documentMode);
  const objectSetSha256 = offlineSyncText_(payload.objectSetSha256).toLowerCase();
  const manifestSha256 = offlineSyncText_(payload.manifestSha256).toLowerCase();
  const total = Number(payload.total || 0);
  const pac = Number(payload.pac || 0);
  const sedex = Number(payload.sedex || 0);
  if (!campaignId) throw new Error('Campanha nao informada.');
  if (!localBatchId) throw new Error('Identificador local do lote ausente.');
  if (!offlineSyncHashOk_(objectSetSha256)) throw new Error('Hash do conjunto de objetos invalido.');
  if (!offlineSyncHashOk_(manifestSha256)) throw new Error('Hash do manifesto invalido.');
  if (!Number.isInteger(total) || total < 1) throw new Error('Total do manifesto invalido.');
  if (!Number.isInteger(pac) || !Number.isInteger(sedex) || pac < 0 || sedex < 0 || pac + sedex !== total) {
    throw new Error('Totais PAC/SEDEX divergentes no manifesto.');
  }
  return {
    campaignId: campaignId,
    localBatchId: localBatchId,
    documentMode: documentMode,
    objectSetSha256: objectSetSha256,
    manifestSha256: manifestSha256,
    total: total,
    pac: pac,
    sedex: sedex
  };
}

function offlineSyncFindBackendMatches_(campaignId, requestedRows) {
  const wanted = {};
  requestedRows.forEach(function(row) { wanted[row.trackingCode] = row.service; });
  return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && !!wanted[String(row.TRACKING_CODE)];
  });
}

function offlineSyncInspect_(userId, payload) {
  const header = offlineSyncValidateHeader_(payload);
  requireCampaignAccess_(header.campaignId, userId, ['AGENCY_ADMIN']);
  const requested = offlineSyncNormalizeObjects_(payload);
  if (requested.length !== header.total) throw new Error('Total de objetos divergente no manifesto.');
  if (offlineSyncObjectSetHash_(requested) !== header.objectSetSha256) throw new Error('Hash do conjunto de objetos nao confere.');

  const existingSync = offlineSyncByLocalBatch_(header.campaignId, header.localBatchId);
  if (existingSync) {
    if (String(existingSync.OBJECT_SET_SHA256) !== header.objectSetSha256) {
      return { mode: 'CONFLICT', reason: 'LOCAL_BATCH_ID_REUSED_WITH_DIFFERENT_OBJECTS', existingSync: offlineSyncPublic_(existingSync) };
    }
    return {
      mode: 'RESUME',
      completed: String(existingSync.STATUS) === 'COMPLETED',
      sync: offlineSyncPublic_(existingSync)
    };
  }

  const matches = offlineSyncFindBackendMatches_(header.campaignId, requested);
  if (!matches.length) return { mode: 'NEW_IMPORT', matched: 0, expected: requested.length };

  const byCode = {};
  const duplicates = [];
  matches.forEach(function(row) {
    const trackingCode = String(row.TRACKING_CODE || '');
    if (byCode[trackingCode]) duplicates.push(trackingCode);
    else byCode[trackingCode] = row;
  });
  const missing = [];
  const serviceMismatch = [];
  requested.forEach(function(item) {
    const match = byCode[item.trackingCode];
    if (!match) missing.push(item.trackingCode);
    else if (offlineSyncService_(match.SERVICE) !== item.service) {
      serviceMismatch.push({ trackingCode: item.trackingCode, expectedService: item.service, actualService: offlineSyncService_(match.SERVICE) });
    }
  });
  if (duplicates.length || missing.length || serviceMismatch.length) {
    return {
      mode: 'CONFLICT', reason: 'OBJECT_OVERLAP_CONFLICT', matched: matches.length, expected: requested.length,
      duplicates: duplicates.slice(0, 50), missing: missing.slice(0, 50), serviceMismatch: serviceMismatch.slice(0, 50)
    };
  }
  const productionBatchIds = [];
  matches.forEach(function(row) {
    const id = String(row.PRODUCTION_BATCH_ID || '');
    if (id && productionBatchIds.indexOf(id) === -1) productionBatchIds.push(id);
  });
  if (productionBatchIds.length === 1) {
    return { mode: 'RECONCILE_EXISTING', matched: matches.length, expected: requested.length, productionBatchId: productionBatchIds[0] };
  }
  if (!productionBatchIds.length) {
    return { mode: 'EXISTING_UNASSIGNED', matched: matches.length, expected: requested.length };
  }
  return { mode: 'CONFLICT', reason: 'MULTIPLE_PRODUCTION_BATCHES', productionBatchIds: productionBatchIds.slice(0, 20) };
}

function offlineSyncSanitizeEvents_(events, totalByService, requestedCodes) {
  const source = Array.isArray(events) ? events : [];
  if (source.length > 50) throw new Error('Quantidade de eventos offline acima do limite.');
  const ids = {};
  const printedServices = {};
  return source.map(function(event) {
    const id = offlineSyncText_(event.id);
    const type = offlineSyncText_(event.type).toUpperCase();
    const service = offlineSyncService_(event.service);
    const quantity = Number(event.quantity || 0);
    const trackingCode = offlineSyncCode_(event.trackingCode);
    const occurredAt = offlineSyncText_(event.occurredAt);
    const receivedBy = offlineSyncText_(event.receivedBy).slice(0, 160);
    const note = offlineSyncText_(event.note).slice(0, 800);
    if (!id || ids[id]) throw new Error('Evento offline sem ID unico.');
    ids[id] = true;
    if (['LABEL_TEST_APPROVED', 'LABEL_PRINTED', 'LABEL_HANDOFF'].indexOf(type) === -1) throw new Error('Tipo de evento offline invalido.');
    if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico de evento offline invalido.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(totalByService[service] || 0)) throw new Error('Quantidade de evento offline invalida.');
    if (!occurredAt || isNaN(Date.parse(occurredAt))) throw new Error('Data de evento offline invalida.');
    if (type === 'LABEL_TEST_APPROVED') {
      if (!offlineSyncTrackingOk_(trackingCode) || !requestedCodes[trackingCode]) throw new Error('SRO de teste offline invalido.');
      if (requestedCodes[trackingCode] !== service) throw new Error('Servico do teste offline divergente.');
    }
    if (type === 'LABEL_PRINTED') {
      if (printedServices[service]) throw new Error('Mais de um evento de impressao offline para ' + service + '.');
      printedServices[service] = true;
      if (quantity !== Number(totalByService[service] || 0)) throw new Error('Impressao offline precisa representar o total integral de ' + service + '.');
    }
    if (type === 'LABEL_HANDOFF' && receivedBy.length < 2) throw new Error('Recebedor do evento de entrega offline ausente.');
    return {
      id: id, type: type, service: service, quantity: quantity, trackingCode: trackingCode,
      occurredAt: occurredAt, receivedBy: receivedBy, note: note, metadata: event.metadata || {}
    };
  });
}

function offlineSyncStart_(userId, payload) {
  const header = offlineSyncValidateHeader_(payload);
  requireCampaignAccess_(header.campaignId, userId, ['AGENCY_ADMIN']);
  const requested = offlineSyncNormalizeObjects_(payload);
  if (requested.length !== header.total) throw new Error('Total de objetos divergente no manifesto.');
  if (offlineSyncObjectSetHash_(requested) !== header.objectSetSha256) throw new Error('Hash do conjunto de objetos nao confere.');
  const requestedCodes = {};
  requested.forEach(function(row) { requestedCodes[row.trackingCode] = row.service; });
  const events = offlineSyncSanitizeEvents_(payload.operationEvents, { PAC: header.pac, SEDEX: header.sedex }, requestedCodes);
  const inspect = offlineSyncInspect_(userId, payload);
  if (inspect.mode === 'CONFLICT' || inspect.mode === 'EXISTING_UNASSIGNED') {
    throw new Error('Sincronizacao automatica bloqueada: ' + String(inspect.reason || inspect.mode));
  }
  if (inspect.mode === 'RESUME') {
    const existing = findRow_('OFFLINE_SYNCS', function(row) {
      return String(row.ID) === String(inspect.sync && inspect.sync.id) && String(row.CAMPAIGN_ID) === header.campaignId;
    });
    if (!existing) throw new Error('Sincronizacao existente nao encontrada.');
    const source = safeJsonParse_(existing.SOURCE_JSON, {});
    const manifestChanged = String(existing.MANIFEST_SHA256 || '') !== header.manifestSha256;
    const nextStatus = String(existing.STATUS) === 'COMPLETED' && manifestChanged && String(existing.PRODUCTION_BATCH_ID || '') ? 'LINKED' : String(existing.STATUS || 'RECEIVING');
    updateRow_('OFFLINE_SYNCS', existing._rowNumber, {
      MANIFEST_SHA256: header.manifestSha256,
      EVENTS_JSON: events,
      SOURCE_JSON: {
        operationReference: offlineSyncText_(payload.operationReference || source.operationReference).slice(0, 180),
        operationName: offlineSyncText_(payload.operationName || source.operationName).slice(0, 180),
        manifestCreatedAt: offlineSyncText_(payload.manifestCreatedAt || source.manifestCreatedAt),
        sender: payload.sender || source.sender || {},
        sourceFiles: Array.isArray(payload.sourceFiles) ? payload.sourceFiles : (source.sourceFiles || [])
      },
      STATUS: nextStatus,
      UPDATED_AT: nowIso_()
    });
    return offlineSyncPublic_(findRow_('OFFLINE_SYNCS', function(row) { return String(row.ID) === String(existing.ID); }));
  }

  let productionBatchId = '';
  let portalReturnId = '';
  let status = 'RECEIVING';
  if (inspect.mode === 'RECONCILE_EXISTING') {
    productionBatchId = String(inspect.productionBatchId || '');
    const batch = findRow_('PRODUCTION_BATCHES', function(row) {
      return String(row.ID) === productionBatchId && String(row.CAMPAIGN_ID) === header.campaignId;
    });
    if (!batch) throw new Error('Lote conectado indicado para reconciliacao nao foi encontrado.');
    portalReturnId = String(batch.PORTAL_RETURN_ID || '');
    if (String(batch.DOCUMENT_MODE || '') !== header.documentMode) throw new Error('Modo documental divergente entre lote local e lote conectado.');
    status = 'LINKED';
  }

  const id = uuid_();
  const now = nowIso_();
  appendObjects_('OFFLINE_SYNCS', [{
    ID: id,
    CAMPAIGN_ID: header.campaignId,
    LOCAL_BATCH_ID: header.localBatchId,
    STATUS: status,
    MODE: inspect.mode,
    DOCUMENT_MODE: header.documentMode,
    OBJECT_SET_SHA256: header.objectSetSha256,
    MANIFEST_SHA256: header.manifestSha256,
    TOTAL: header.total,
    PAC: header.pac,
    SEDEX: header.sedex,
    PRODUCTION_BATCH_ID: productionBatchId,
    PORTAL_RETURN_ID: portalReturnId,
    SOURCE_JSON: {
      operationReference: offlineSyncText_(payload.operationReference).slice(0, 180),
      operationName: offlineSyncText_(payload.operationName).slice(0, 180),
      manifestCreatedAt: offlineSyncText_(payload.manifestCreatedAt),
      sender: payload.sender || {},
      sourceFiles: Array.isArray(payload.sourceFiles) ? payload.sourceFiles : []
    },
    EVENTS_JSON: events,
    CREATED_BY: userId,
    CREATED_AT: now,
    UPDATED_AT: now
  }]);
  return offlineSyncPublic_(findRow_('OFFLINE_SYNCS', function(row) { return String(row.ID) === id; }));
}

function offlineSyncAppend_(userId, payload) {
  const campaignId = offlineSyncText_(payload.campaignId);
  const syncId = offlineSyncText_(payload.syncId);
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const sync = findRow_('OFFLINE_SYNCS', function(row) {
    return String(row.ID) === syncId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!sync) throw new Error('Sincronizacao offline nao encontrada.');
  if (String(sync.STATUS) !== 'RECEIVING' || String(sync.MODE) !== 'NEW_IMPORT') throw new Error('Esta sincronizacao nao aceita novos blocos.');
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length || rows.length > 200) throw new Error('Bloco de sincronizacao invalido.');

  const existing = {};
  offlineSyncStagedRows_(syncId).forEach(function(row) { existing[String(row.TRACKING_CODE)] = String(row.SERVICE || ''); });
  const now = nowIso_();
  const records = [];
  rows.forEach(function(source) {
    const trackingCode = offlineSyncCode_(source.trackingCode);
    const service = offlineSyncService_(source.service);
    const matrix = source.matrix || {};
    const matrixStatus = offlineSyncText_(matrix.status).toUpperCase();
    const matrixPayload = offlineSyncText_(matrix.payload).toUpperCase();
    const errors = Array.isArray(source.errors) ? source.errors : [];
    if (!offlineSyncTrackingOk_(trackingCode)) throw new Error('SRO invalido no bloco offline.');
    if (existing[trackingCode]) {
      if (offlineSyncService_(existing[trackingCode]) !== service) throw new Error('SRO ja recebido com servico divergente: ' + trackingCode);
      return;
    }
    existing[trackingCode] = service;
    if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico invalido no bloco offline: ' + trackingCode);
    if (errors.length) throw new Error('Objeto com pendencia nao pode ser sincronizado: ' + trackingCode);
    if (['AUTO_VERIFIED', 'VERIFIED'].indexOf(matrixStatus) === -1) throw new Error('Data Matrix nao verificado: ' + trackingCode);
    if (matrixStatus === 'AUTO_VERIFIED' && matrixPayload.indexOf(trackingCode) === -1) throw new Error('Payload do Data Matrix nao confirma o SRO: ' + trackingCode);
    if (String(sync.DOCUMENT_MODE) === 'DCE_AUTHORIZED') {
      if (offlineSyncText_(source.accessKey).replace(/\D/g, '').length !== 44) throw new Error('Chave DC-e invalida: ' + trackingCode);
      if (!offlineSyncText_(source.protocol)) throw new Error('Protocolo DC-e ausente: ' + trackingCode);
    }
    records.push({
      ID: uuid_(), SYNC_ID: syncId, CAMPAIGN_ID: campaignId,
      TRACKING_CODE: trackingCode, SERVICE: service,
      OBJECT_JSON: source,
      CREATED_AT: now
    });
  });
  if (records.length) appendObjects_('OFFLINE_SYNC_OBJECTS', records);
  return { appended: records.length, staged: offlineSyncStagedRows_(syncId).length };
}

function offlineSyncEnsureExactExistingBatch_(sync) {
  const productionBatchId = String(sync.PRODUCTION_BATCH_ID || '');
  const campaignId = String(sync.CAMPAIGN_ID || '');
  const batch = findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === productionBatchId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!batch) throw new Error('Lote conectado nao encontrado para reconciliacao.');
  const rows = sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.PRODUCTION_BATCH_ID) === productionBatchId;
  }).map(function(row) { return { trackingCode: String(row.TRACKING_CODE), service: String(row.SERVICE) }; });
  if (rows.length !== Number(sync.TOTAL || 0)) throw new Error('Quantidade do lote conectado diverge do manifesto offline.');
  if (offlineSyncObjectSetHash_(rows) !== String(sync.OBJECT_SET_SHA256 || '')) throw new Error('Objetos do lote conectado divergem do manifesto offline.');
  return { batch: batch, rows: rows };
}

function offlineSyncCreateConnectedBatch_(userId, sync) {
  const staged = offlineSyncStagedRows_(sync.ID);
  if (staged.length !== Number(sync.TOTAL || 0)) throw new Error('Sincronizacao incompleta: quantidade de objetos recebidos diverge do manifesto.');
  const rows = staged.map(function(row) {
    const object = safeJsonParse_(row.OBJECT_JSON, {});
    return { trackingCode: String(row.TRACKING_CODE), service: String(row.SERVICE), object: object };
  });
  if (offlineSyncObjectSetHash_(rows) !== String(sync.OBJECT_SET_SHA256 || '')) throw new Error('Hash dos objetos recebidos diverge do manifesto.');

  const campaignId = String(sync.CAMPAIGN_ID || '');
  const requested = rows.map(function(row) { return { trackingCode: row.trackingCode, service: row.service }; });
  if (offlineSyncFindBackendMatches_(campaignId, requested).length) throw new Error('Objetos deste lote passaram a existir no sistema durante a sincronizacao. Revise antes de continuar.');

  const source = safeJsonParse_(sync.SOURCE_JSON, {});
  const sourceFiles = Array.isArray(source.sourceFiles) ? source.sourceFiles : [];
  const csvFile = sourceFiles.find(function(item) { return /\.csv$/i.test(String(item.name || '')); }) || {};
  const pdfFiles = sourceFiles.filter(function(item) { return /\.pdf$/i.test(String(item.name || '')); });
  const matrixSummary = { autoVerified: 0, verified: 0, textOnly: 0, manualReview: 0, missing: 0, divergent: 0 };
  rows.forEach(function(item) {
    const status = offlineSyncText_(item.object.matrix && item.object.matrix.status).toUpperCase();
    if (status === 'AUTO_VERIFIED') matrixSummary.autoVerified += 1;
    else matrixSummary.verified += 1;
  });
  matrixSummary.matched = matrixSummary.autoVerified + matrixSummary.verified;
  matrixSummary.fullyAutoVerified = matrixSummary.autoVerified === rows.length;

  const portalReturnId = uuid_();
  const now = nowIso_();
  appendObjects_('PORTAL_RETURNS', [{
    ID: portalReturnId,
    CAMPAIGN_ID: campaignId,
    PORTAL_EXPORT_ID: '',
    STATUS: 'READY',
    TOTAL_ROWS: rows.length,
    PAC_ROWS: Number(sync.PAC || 0),
    SEDEX_ROWS: Number(sync.SEDEX || 0),
    INVALID_ROWS: 0,
    MATRIX_SUMMARY_JSON: matrixSummary,
    CSV_FILE_NAME: String(csvFile.name || 'retorno_offline.csv').slice(0, 180),
    CSV_SHA256: String(csvFile.sha256 || '').slice(0, 80),
    PDF_FILES_JSON: pdfFiles,
    DOCUMENT_MODE: '',
    CREATED_BY: userId,
    CREATED_AT: now,
    UPDATED_AT: now
  }]);

  const postalRecords = rows.map(function(item) {
    const sourceObject = item.object || {};
    return {
      ID: uuid_(), CAMPAIGN_ID: campaignId, PORTAL_RETURN_ID: portalReturnId,
      TRACKING_CODE: item.trackingCode, SERVICE: item.service, STATUS: 'READY',
      POSTAL_JSON: sourceObject.postal || {}, RECIPIENT_JSON: sourceObject.recipient || {},
      CONTENT: String(sourceObject.content || ''), REFERENCE: String(sourceObject.reference || ''),
      ACCESS_KEY: String(sourceObject.accessKey || ''), PROTOCOL: String(sourceObject.protocol || ''),
      ERRORS_JSON: [], MATRIX_STATUS: String(sourceObject.matrix && sourceObject.matrix.status || ''),
      MATRIX_JSON: sourceObject.matrix || {}, PRODUCTION_BATCH_ID: '', VOLUME_ID: '', CREATED_AT: now, UPDATED_AT: now
    };
  });
  appendObjects_('POSTAL_OBJECTS', postalRecords);

  const occurredAt = source.manifestCreatedAt && !isNaN(Date.parse(source.manifestCreatedAt)) ? String(source.manifestCreatedAt) : now;
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'PORTAL_RETURN_IMPORTED', quantity: rows.length,
    sourceType: 'OFFLINE_SYNC', sourceId: String(sync.ID), idempotencyKey: 'offline-return:' + String(sync.LOCAL_BATCH_ID),
    occurredAt: occurredAt,
    metadata: { origin: 'OFFLINE_CONTINGENCY', localBatchId: String(sync.LOCAL_BATCH_ID), matrix: matrixSummary }
  });
  ['PAC', 'SEDEX'].forEach(function(service) {
    const quantity = service === 'PAC' ? Number(sync.PAC || 0) : Number(sync.SEDEX || 0);
    if (!quantity) return;
    recordOperationEvent_(userId, {
      campaignId: campaignId, type: 'LABEL_GENERATED', quantity: quantity, service: service,
      sourceType: 'OFFLINE_SYNC', sourceId: String(sync.ID), idempotencyKey: 'offline-label-generated:' + String(sync.LOCAL_BATCH_ID) + ':' + service,
      occurredAt: occurredAt, metadata: { origin: 'OFFLINE_CONTINGENCY' }
    });
  });

  const prepared = prepareProductionBatch_(userId, {
    campaignId: campaignId,
    portalReturnId: portalReturnId,
    documentMode: String(sync.DOCUMENT_MODE)
  });
  updateRow_('OFFLINE_SYNCS', sync._rowNumber, {
    PORTAL_RETURN_ID: portalReturnId,
    PRODUCTION_BATCH_ID: prepared.id,
    STATUS: 'LINKED',
    UPDATED_AT: nowIso_()
  });
  return { portalReturnId: portalReturnId, productionBatchId: prepared.id };
}

function offlineSyncReplayEvents_(userId, sync) {
  const campaignId = String(sync.CAMPAIGN_ID || '');
  const productionBatchId = String(sync.PRODUCTION_BATCH_ID || '');
  const events = safeJsonParse_(sync.EVENTS_JSON, []);
  const totals = { PAC: Number(sync.PAC || 0), SEDEX: Number(sync.SEDEX || 0) };
  const printedByService = { PAC: 0, SEDEX: 0 };
  const handoffEvents = [];

  events.forEach(function(event) {
    if (event.type === 'LABEL_TEST_APPROVED') {
      recordOperationEvent_(userId, {
        campaignId: campaignId, type: 'LABEL_TEST_APPROVED', service: event.service, quantity: 1,
        sourceType: 'PRODUCTION_BATCH', sourceId: productionBatchId,
        idempotencyKey: 'label-test-approved:' + productionBatchId + ':' + event.service + ':' + event.trackingCode,
        occurredAt: event.occurredAt,
        metadata: { trackingCode: event.trackingCode, origin: 'OFFLINE_CONTINGENCY', localEventId: event.id, localBatchId: String(sync.LOCAL_BATCH_ID) }
      });
    } else if (event.type === 'LABEL_PRINTED') {
      printedByService[event.service] += Number(event.quantity || 0);
      recordOperationEvent_(userId, {
        campaignId: campaignId, type: 'LABEL_PRINTED', service: event.service, quantity: Number(event.quantity || 0),
        sourceType: 'PRODUCTION_BATCH', sourceId: productionBatchId,
        idempotencyKey: 'labels-printed:' + productionBatchId + ':' + event.service,
        occurredAt: event.occurredAt,
        metadata: { origin: 'OFFLINE_CONTINGENCY', localEventId: event.id, localBatchId: String(sync.LOCAL_BATCH_ID), physicalPrintConfirmed: true }
      });
    } else if (event.type === 'LABEL_HANDOFF') {
      handoffEvents.push(event);
    }
  });

  ['PAC', 'SEDEX'].forEach(function(service) {
    if (printedByService[service] > totals[service]) throw new Error('Eventos offline registram impressao acima do total de ' + service + '.');
  });

  if (handoffEvents.length) {
    const byService = {};
    handoffEvents.forEach(function(event) {
      if (byService[event.service]) throw new Error('Mais de um evento de entrega offline para ' + event.service + '.');
      byService[event.service] = event;
    });
    const presentServices = ['PAC', 'SEDEX'].filter(function(service) { return totals[service] > 0; });
    presentServices.forEach(function(service) {
      if (!byService[service] || Number(byService[service].quantity || 0) !== totals[service]) {
        throw new Error('Entrega offline precisa contemplar integralmente todos os servicos do lote.');
      }
      if (printedByService[service] < totals[service]) throw new Error('Entrega offline sem impressao integral registrada para ' + service + '.');
    });
    const receiver = String(handoffEvents[0].receivedBy || '');
    const occurredAt = String(handoffEvents[0].occurredAt || nowIso_());
    if (handoffEvents.some(function(event) { return String(event.receivedBy || '') !== receiver; })) throw new Error('Recebedores divergentes nos eventos de entrega offline.');
    handoffDeliveryVolumes_(userId, {
      campaignId: campaignId,
      productionBatchId: productionBatchId,
      receivedBy: receiver,
      occurredAt: occurredAt,
      note: String(handoffEvents[0].note || '')
    });
  }
  return { events: events.length, handoff: handoffEvents.length > 0 };
}

function offlineSyncFinish_(userId, payload) {
  const campaignId = offlineSyncText_(payload.campaignId);
  const syncId = offlineSyncText_(payload.syncId);
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  let sync = findRow_('OFFLINE_SYNCS', function(row) {
    return String(row.ID) === syncId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!sync) throw new Error('Sincronizacao offline nao encontrada.');
  if (String(sync.STATUS) === 'COMPLETED') return offlineSyncPublic_(sync);
  if (String(sync.MODE) === 'NEW_IMPORT' && !String(sync.PRODUCTION_BATCH_ID || '')) {
    offlineSyncCreateConnectedBatch_(userId, sync);
    sync = findRow_('OFFLINE_SYNCS', function(row) { return String(row.ID) === syncId; });
  } else {
    offlineSyncEnsureExactExistingBatch_(sync);
  }
  const replay = offlineSyncReplayEvents_(userId, sync);
  const now = nowIso_();
  updateRow_('OFFLINE_SYNCS', sync._rowNumber, { STATUS: 'COMPLETED', UPDATED_AT: now });
  recordOperationEvent_(userId, {
    campaignId: campaignId,
    type: 'OFFLINE_SYNC_COMPLETED',
    quantity: Number(sync.TOTAL || 0),
    sourceType: 'OFFLINE_SYNC',
    sourceId: syncId,
    idempotencyKey: 'offline-sync-completed:' + String(sync.LOCAL_BATCH_ID),
    metadata: {
      localBatchId: String(sync.LOCAL_BATCH_ID),
      manifestSha256: String(sync.MANIFEST_SHA256 || ''),
      productionBatchId: String(sync.PRODUCTION_BATCH_ID || ''),
      replayedEvents: replay.events
    }
  });
  return offlineSyncPublic_(findRow_('OFFLINE_SYNCS', function(row) { return String(row.ID) === syncId; }));
}

function listOfflineSyncs_(userId, payload) {
  const campaignId = offlineSyncText_(payload.campaignId);
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('OFFLINE_SYNCS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).map(offlineSyncPublic_).reverse();
}
