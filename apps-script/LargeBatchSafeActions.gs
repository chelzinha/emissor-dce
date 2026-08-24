function updateRowsBatchSafe_(sheetName, updates) {
  const items = (updates || []).filter(function(item) {
    return item && Number(item.rowNumber) >= 2 && item.changes;
  }).map(function(item) {
    return { rowNumber: Number(item.rowNumber), changes: item.changes };
  }).sort(function(a, b) { return a.rowNumber - b.rowNumber; });
  if (!items.length) return;

  const sheet = getSheet_(sheetName);
  const map = headerMap_(sheet);
  const width = sheet.getLastColumn();
  let cursor = 0;
  while (cursor < items.length) {
    let end = cursor + 1;
    while (end < items.length && items[end].rowNumber === items[end - 1].rowNumber + 1) end += 1;
    const firstRow = items[cursor].rowNumber;
    const values = sheet.getRange(firstRow, 1, end - cursor, width).getValues();
    for (let index = cursor; index < end; index += 1) {
      const target = values[index - cursor];
      const changes = items[index].changes || {};
      Object.keys(changes).forEach(function(key) {
        if (map[key] == null) return;
        const raw = changes[key];
        target[map[key]] = raw == null ? '' : (typeof raw === 'object' ? JSON.stringify(raw) : raw);
      });
    }
    sheet.getRange(firstRow, 1, values.length, width).setValues(values);
    cursor = end;
  }
}

function portalExportForListSafe_(campaignId, listId) {
  const rows = sheetRows_(getSheet_('PORTAL_EXPORTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.ADDRESS_LIST_ID) === String(listId);
  });
  rows.sort(function(a, b) { return String(b.CREATED_AT || '').localeCompare(String(a.CREATED_AT || '')); });
  return rows[0] || null;
}

function repairExistingPortalExportSafe_(userId, campaignId, list, existing) {
  const exportId = String(existing.ID || '');
  const fileId = String(existing.FILE_ID || '');
  if (!exportId || !fileId) throw new Error('A exportacao existente esta incompleta.');
  const file = DriveApp.getFileById(fileId);
  const now = nowIso_();
  const rows = addressRowsForList_(campaignId, String(list.ID || '')).filter(function(row) {
    return String(row.STATUS) === 'READY' && String(row.PORTAL_EXPORT_ID || '') !== exportId;
  });
  updateRowsBatchSafe_('ADDRESS_ROWS', rows.map(function(row) {
    return { rowNumber: row._rowNumber, changes: { PORTAL_EXPORT_ID: exportId, UPDATED_AT: now } };
  }));
  updateRow_('ADDRESS_LISTS', list._rowNumber, { STATUS: 'EXPORTED', UPDATED_AT: now });
  return {
    id: exportId,
    service: String(existing.SERVICE || ''),
    total: Number(existing.TOTAL_ROWS || 0),
    fileName: String(existing.FILE_NAME || file.getName()),
    fileId: fileId,
    sha256: String(existing.SHA256 || ''),
    csv: file.getBlob().getDataAsString('UTF-8'),
    recovered: true
  };
}

function exportPortalPostalSafe_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  const service = String(payload.service || '').toUpperCase();
  const content = cleanText_(payload.content || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Escolha PAC ou SEDEX para a exportacao.');
  if (!content) throw new Error('Informe o conteudo antes de exportar para o Portal Postal.');

  const list = findRow_('ADDRESS_LISTS', function(row) {
    return String(row.ID) === listId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!list) throw new Error('Lista de enderecamento nao encontrada.');

  const existing = portalExportForListSafe_(campaignId, listId);
  if (existing) return repairExistingPortalExportSafe_(userId, campaignId, list, existing);

  const sourceRows = addressRowsForList_(campaignId, listId).filter(function(row) {
    return String(row.STATUS) === 'READY' && !String(row.PORTAL_EXPORT_ID || '');
  });
  if (!sourceRows.length) throw new Error('Nenhum cadastro higienizado e disponivel para exportacao.');

  const cleanRows = sourceRows.map(function(row) {
    const clean = normalizePortalCandidate_(safeJsonParse_(row.CLEANED_JSON, {}), {});
    clean.service = service;
    clean.content = content;
    return clean;
  });
  cleanRows.forEach(function(row, index) {
    const issues = validatePortalExportRow_(row);
    if (issues.length) throw new Error('O cadastro ' + (index + 1) + ' ainda possui pendencias para o Portal Postal.');
  });

  const csv = buildPortalCsv_(cleanRows);
  const exportId = uuid_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Fortaleza', 'yyyyMMdd-HHmmss');
  const fileName = sanitizeFileName_('portal_postal_' + service + '_' + stamp + '_' + sourceRows.length + '.csv');
  const campaignFolder = getOrCreateFolder_(getRootFolder_(), 'campaign_' + campaignId);
  const portalFolder = getOrCreateFolder_(campaignFolder, 'portal-postal');
  const file = portalFolder.createFile(fileName, csv, MimeType.CSV);
  const hash = sha256Hex_(csv);
  const now = nowIso_();

  appendObjects_('PORTAL_EXPORTS', [{
    ID: exportId, CAMPAIGN_ID: campaignId, ADDRESS_LIST_ID: listId, SERVICE: service, STATUS: 'EXPORTED',
    TOTAL_ROWS: sourceRows.length, FILE_NAME: fileName, FILE_ID: file.getId(), SHA256: hash,
    CREATED_BY: userId, CREATED_AT: now
  }]);
  updateRowsBatchSafe_('ADDRESS_ROWS', sourceRows.map(function(row, index) {
    return {
      rowNumber: row._rowNumber,
      changes: { CLEANED_JSON: cleanRows[index], PORTAL_EXPORT_ID: exportId, UPDATED_AT: now }
    };
  }));
  updateRow_('ADDRESS_LISTS', list._rowNumber, { STATUS: 'EXPORTED', UPDATED_AT: now });
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'PORTAL_CSV_EXPORTED', quantity: sourceRows.length, service: service,
    sourceType: 'PORTAL_EXPORT', sourceId: exportId, idempotencyKey: 'portal-export:' + exportId,
    metadata: { fileName: fileName, sha256: hash, addressListId: listId, content: content }
  });
  return { id: exportId, service: service, total: sourceRows.length, fileName: fileName, fileId: file.getId(), sha256: hash, csv: csv };
}

function deliveryVolumesSafe_(campaignId, batchId, objectRows) {
  let existing = sheetRows_(getSheet_('DELIVERY_VOLUMES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.PRODUCTION_BATCH_ID) === batchId;
  });
  if (!existing.length) {
    const drafts = [];
    ['SEDEX', 'PAC'].forEach(function(service) {
      const rows = objectRows.filter(function(row) { return String(row.SERVICE) === service; });
      for (let index = 0; index < rows.length; index += DCE_CONFIG.VOLUME_CAPACITY) {
        drafts.push({ service: service, rows: rows.slice(index, index + DCE_CONFIG.VOLUME_CAPACITY) });
      }
    });
    const now = nowIso_();
    const totalVolumes = drafts.length;
    const records = drafts.map(function(draft, index) {
      return {
        ID: uuid_(), CAMPAIGN_ID: campaignId, PRODUCTION_BATCH_ID: batchId,
        SERVICE: draft.service, VOLUME_NUMBER: index + 1, TOTAL_VOLUMES: totalVolumes,
        QUANTITY: draft.rows.length,
        TRACKING_CODES_JSON: draft.rows.map(function(row) { return String(row.TRACKING_CODE); }),
        STATUS: 'PLANNED', DELIVERED_AT: '', RECEIVED_BY: '', PROOF_FILE_ID: '', CREATED_AT: now, UPDATED_AT: now
      };
    });
    appendObjects_('DELIVERY_VOLUMES', records);
    existing = records;
  }

  const byTracking = {};
  existing.forEach(function(volume) {
    safeJsonParse_(volume.TRACKING_CODES_JSON, []).forEach(function(code) {
      byTracking[productionOpsTracking_(code)] = String(volume.ID || '');
    });
  });
  const now = nowIso_();
  updateRowsBatchSafe_('POSTAL_OBJECTS', objectRows.map(function(row) {
    const volumeId = byTracking[productionOpsTracking_(row.TRACKING_CODE)] || '';
    if (!volumeId) throw new Error('Nao foi possivel associar o objeto ' + String(row.TRACKING_CODE || '') + ' a um volume.');
    return { rowNumber: row._rowNumber, changes: { PRODUCTION_BATCH_ID: batchId, VOLUME_ID: volumeId, UPDATED_AT: now } };
  }));

  return existing.map(function(row) {
    return {
      id: String(row.ID), service: String(row.SERVICE), number: Number(row.VOLUME_NUMBER || 0),
      totalVolumes: Number(row.TOTAL_VOLUMES || existing.length), quantity: Number(row.QUANTITY || 0),
      trackingCodes: safeJsonParse_(row.TRACKING_CODES_JSON, [])
    };
  });
}

function prepareProductionBatchSafe_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const mode = productionDocumentMode_(payload.documentMode);
  const portalReturn = findRow_('PORTAL_RETURNS', function(row) {
    return String(row.ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!portalReturn) throw new Error('Retorno do Portal Postal nao encontrado.');
  if (['READY', 'IN_PRODUCTION'].indexOf(String(portalReturn.STATUS)) === -1) throw new Error('O retorno do Portal possui pendencias e nao pode seguir para producao.');
  const objects = portalObjectsForReturn_(campaignId, portalReturnId);
  const blocked = objects.find(function(row) { return String(row.STATUS) !== 'READY'; });
  if (blocked) throw new Error('Ha objetos pendentes no lote.');

  let batch = findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.PORTAL_RETURN_ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (batch && String(batch.DOCUMENT_MODE || '') !== mode) throw new Error('Este retorno ja possui lote de producao com outro modo documental.');

  if (!batch) {
    const pac = objects.filter(function(row) { return String(row.SERVICE) === 'PAC'; }).length;
    const sedex = objects.filter(function(row) { return String(row.SERVICE) === 'SEDEX'; }).length;
    const batchId = uuid_();
    const now = nowIso_();
    const initialStatus = mode === 'DCE_AUTHORIZED' ? 'AWAITING_DCE_PREPARATION' : 'READY_FOR_UNIFIED_LABEL';
    appendObjects_('PRODUCTION_BATCHES', [{
      ID: batchId, CAMPAIGN_ID: campaignId, PORTAL_RETURN_ID: portalReturnId,
      DOCUMENT_MODE: mode, STATUS: initialStatus, TOTAL: objects.length, PAC: pac, SEDEX: sedex,
      MATRIX_SUMMARY_JSON: safeJsonParse_(portalReturn.MATRIX_SUMMARY_JSON, {}),
      CREATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
    }]);
    updateRow_('PORTAL_RETURNS', portalReturn._rowNumber, { DOCUMENT_MODE: mode, STATUS: 'IN_PRODUCTION', UPDATED_AT: now });
    batch = findRow_('PRODUCTION_BATCHES', function(row) { return String(row.ID) === batchId; });
  }

  const volumes = deliveryVolumesSafe_(campaignId, String(batch.ID), objects);
  return {
    id: String(batch.ID), documentMode: String(batch.DOCUMENT_MODE || mode), status: String(batch.STATUS || ''),
    total: Number(batch.TOTAL || objects.length), pac: Number(batch.PAC || 0), sedex: Number(batch.SEDEX || 0),
    volumes: volumes, recovered: String(portalReturn.STATUS) === 'IN_PRODUCTION'
  };
}

function confirmProductionPostingSafe_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const listId = String(payload.listId || '').trim();
  const service = String(payload.service || '').trim().toUpperCase();
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (!listId) throw new Error('Informe a lista postal confirmada como postada.');
  const protocol = productionProtocolData_(userId, { campaignId: campaignId, productionBatchId: batchId });
  if (!protocol.ready) throw new Error('Os dados do protocolo ainda possuem pendencias.');
  const matches = protocol.lists.filter(function(list) {
    return String(list.listId) === listId && (!service || String(list.service) === service);
  });
  if (matches.length !== 1) throw new Error(matches.length ? 'A lista informada e ambigua. Informe tambem o servico.' : 'Lista postal nao pertence a este lote.');
  const list = matches[0];
  const key = 'posting-list:' + batchId + ':' + listId + ':' + String(list.service) + ':' + String(list.serviceCode || '');
  const existing = postingEventForList_(campaignId, batchId, list);
  const tracking = {};
  list.objects.forEach(function(item) { tracking[productionOpsTracking_(item.trackingCode)] = true; });
  const now = nowIso_();
  updateRowsBatchSafe_('POSTAL_OBJECTS', productionOpsObjects_(campaignId, batchId).filter(function(object) {
    return tracking[productionOpsTracking_(object.TRACKING_CODE)];
  }).map(function(object) {
    return { rowNumber: object._rowNumber, changes: { STATUS: 'POSTED', UPDATED_AT: now } };
  }));
  if (existing) return { duplicate: true, list: postingPublicList_(campaignId, batchId, list), recovered: true };

  const occurredAt = String(payload.postedAt || now);
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'POSTING_COMPLETED', service: String(list.service), quantity: Number(list.total || 0),
    sourceType: 'POSTAL_LIST', sourceId: listId, idempotencyKey: key, occurredAt: occurredAt,
    metadata: { productionBatchId: batchId, listId: listId, serviceCode: String(list.serviceCode || ''), receiptReference: String(payload.receiptReference || '').slice(0, 160) }
  });
  return { duplicate: false, list: postingPublicList_(campaignId, batchId, list) };
}

function appendDeliveredOperationEventsSafe_(userId, campaignId, deliveredRecords, byTracking, source) {
  if (!deliveredRecords.length) return;
  const existingKeys = {};
  sheetRows_(getSheet_('OPERATION_EVENTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).forEach(function(row) { existingKeys[String(row.IDEMPOTENCY_KEY || '')] = true; });
  const now = nowIso_();
  const rows = [];
  const dates = {};
  deliveredRecords.forEach(function(record) {
    const object = byTracking[trackingNormalizeCode_(record.TRACKING_CODE)];
    if (!object) return;
    const key = 'tracking-delivered:' + String(object.ID);
    if (existingKeys[key]) return;
    existingKeys[key] = true;
    rows.push({
      ID: uuid_(), CAMPAIGN_ID: campaignId, USER_ID: userId, TYPE: 'TRACKING_DELIVERED',
      SOURCE_TYPE: 'POSTAL_OBJECT', SOURCE_ID: String(object.ID), SERVICE: String(object.SERVICE || ''), QUANTITY: 1,
      IDEMPOTENCY_KEY: key, METADATA_JSON: { trackingCode: record.TRACKING_CODE, source: source, trackingSourceKey: record.SOURCE_KEY },
      OCCURRED_AT: record.EVENT_AT, CREATED_AT: now
    });
    dates[localDateFromIso_(record.EVENT_AT)] = true;
  });
  if (!rows.length) return;
  appendObjects_('OPERATION_EVENTS', rows);
  Object.keys(dates).forEach(function(date) { refreshDailySummary_(campaignId, date); });
}

function trackingAppendUpdatesSafe_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length || rows.length > Number(DCE_CONFIG.MAX_TRACKING_CHUNK || 200)) throw new Error('Bloco de rastreamento invalido.');
  const source = String(payload.source || 'CSV_IMPORT').trim().slice(0, 80) || 'CSV_IMPORT';
  const objects = sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) { return String(row.CAMPAIGN_ID) === campaignId; });
  const byTracking = {};
  objects.forEach(function(row) { byTracking[trackingNormalizeCode_(row.TRACKING_CODE)] = row; });
  const currentEvents = trackingEventsForCampaign_(campaignId);
  const existingKeys = {};
  currentEvents.forEach(function(row) { existingKeys[trackingNormalizeCode_(row.TRACKING_CODE) + '|' + String(row.SOURCE_KEY || '')] = true; });
  const latest = trackingLatestByObject_(currentEvents);
  const records = [];
  const latestUpdates = {};
  const errors = [];
  let duplicates = 0;
  const now = nowIso_();

  rows.forEach(function(input, index) {
    const trackingCode = trackingNormalizeCode_(input.trackingCode);
    const object = byTracking[trackingCode];
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) { errors.push({ row: index + 1, trackingCode: trackingCode, error: 'SRO_INVALIDO' }); return; }
    if (!object) { errors.push({ row: index + 1, trackingCode: trackingCode, error: 'SRO_NAO_PERTENCE_A_OPERACAO' }); return; }
    const objectStatus = String(object.STATUS || '');
    if (objectStatus !== 'POSTED' && objectStatus.indexOf('TRACKING_') !== 0) { errors.push({ row: index + 1, trackingCode: trackingCode, error: 'OBJETO_NAO_CONFIRMADO_COMO_POSTADO' }); return; }
    const category = trackingNormalizeCategory_(input.category);
    const eventDate = new Date(String(input.eventAt || ''));
    if (isNaN(eventDate.getTime())) { errors.push({ row: index + 1, trackingCode: trackingCode, error: 'DATA_EVENTO_INVALIDA' }); return; }
    const eventAt = eventDate.toISOString();
    const candidate = {
      trackingCode: trackingCode, eventAt: eventAt, category: category,
      status: String(input.status || '').slice(0, 220), description: String(input.description || '').slice(0, 500),
      location: String(input.location || '').slice(0, 220)
    };
    const sourceKey = String(input.sourceKey || trackingSourceKey_(candidate)).slice(0, 700);
    const uniqueKey = trackingCode + '|' + sourceKey;
    if (existingKeys[uniqueKey]) { duplicates += 1; return; }
    existingKeys[uniqueKey] = true;
    const record = {
      ID: uuid_(), CAMPAIGN_ID: campaignId, POSTAL_OBJECT_ID: String(object.ID), TRACKING_CODE: trackingCode,
      SERVICE: String(object.SERVICE || ''), CATEGORY: category, STATUS: candidate.status, DESCRIPTION: candidate.description,
      LOCATION: candidate.location, EVENT_AT: eventAt, SOURCE: source, SOURCE_KEY: sourceKey, CREATED_BY: userId, CREATED_AT: now
    };
    records.push(record);
    const prior = latest[String(object.ID)];
    if (!prior || eventAt >= String(prior.EVENT_AT || '')) {
      latest[String(object.ID)] = record;
      latestUpdates[String(object.ID)] = { object: object, record: record };
    }
  });

  if (records.length) appendObjects_('TRACKING_EVENTS', records);
  updateRowsBatchSafe_('POSTAL_OBJECTS', Object.keys(latestUpdates).map(function(objectId) {
    const item = latestUpdates[objectId];
    return { rowNumber: item.object._rowNumber, changes: { STATUS: trackingObjectStatus_(item.record.CATEGORY), UPDATED_AT: now } };
  }));
  appendDeliveredOperationEventsSafe_(userId, campaignId, records.filter(function(record) { return record.CATEGORY === 'DELIVERED'; }), byTracking, source);
  return { received: rows.length, inserted: records.length, duplicates: duplicates, errors: errors, summary: trackingSummary_(userId, { campaignId: campaignId }) };
}
