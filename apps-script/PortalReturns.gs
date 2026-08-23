function startPortalReturn_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const portalExportId = String(payload.portalExportId || '');
  if (portalExportId) {
    const exportRow = findRow_('PORTAL_EXPORTS', function(row) {
      return String(row.ID) === portalExportId && String(row.CAMPAIGN_ID) === campaignId;
    });
    if (!exportRow) throw new Error('Exportacao do Portal Postal nao encontrada.');
  }
  const id = uuid_();
  const now = nowIso_();
  appendObjects_('PORTAL_RETURNS', [{
    ID: id, CAMPAIGN_ID: campaignId, PORTAL_EXPORT_ID: portalExportId, STATUS: 'UPLOADING',
    TOTAL_ROWS: 0, PAC_ROWS: 0, SEDEX_ROWS: 0, INVALID_ROWS: 0, MATRIX_SUMMARY_JSON: {},
    CSV_FILE_NAME: String(payload.csvFileName || '').slice(0, 180),
    CSV_SHA256: String(payload.csvSha256 || '').slice(0, 80),
    PDF_FILES_JSON: Array.isArray(payload.pdfFiles) ? payload.pdfFiles : [],
    DOCUMENT_MODE: '', CREATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
  }]);
  return { id: id, chunkSize: DCE_CONFIG.MAX_PORTAL_RETURN_CHUNK };
}

function portalObjectsForReturn_(campaignId, portalReturnId) {
  return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PORTAL_RETURN_ID) === String(portalReturnId);
  });
}

function normalizeMatrixStatus_(value) {
  const status = String(value || 'MISSING').toUpperCase();
  const allowed = ['AUTO_VERIFIED', 'VERIFIED', 'TEXT_ONLY', 'MANUAL_REVIEW', 'MISSING', 'DIVERGENT'];
  return allowed.indexOf(status) === -1 ? 'MANUAL_REVIEW' : status;
}

function appendPortalReturnObjects_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const portalReturn = findRow_('PORTAL_RETURNS', function(row) {
    return String(row.ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!portalReturn) throw new Error('Retorno do Portal Postal nao encontrado.');
  if (String(portalReturn.STATUS) !== 'UPLOADING') throw new Error('O retorno do Portal nao esta aberto para importacao.');
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length || rows.length > DCE_CONFIG.MAX_PORTAL_RETURN_CHUNK) {
    throw new Error('Bloco do retorno do Portal invalido.');
  }
  const existing = {};
  portalObjectsForReturn_(campaignId, portalReturnId).forEach(function(row) {
    if (row.TRACKING_CODE) existing[String(row.TRACKING_CODE)] = true;
  });
  const now = nowIso_();
  const records = rows.map(function(source) {
    const trackingCode = String(source.trackingCode || '').replace(/\s/g, '').toUpperCase();
    const service = String(source.service || '').toUpperCase();
    const errors = Array.isArray(source.errors) ? source.errors.slice() : [];
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) errors.push('SRO_INVALIDO');
    if (['PAC', 'SEDEX'].indexOf(service) === -1) errors.push('SERVICO_INVALIDO');
    if (trackingCode && existing[trackingCode]) errors.push('SRO_DUPLICADO');
    if (trackingCode) existing[trackingCode] = true;
    const matrix = source.matrix || {};
    const matrixStatus = normalizeMatrixStatus_(matrix.status);
    const uniqueErrors = errors.filter(function(value, index, array) { return array.indexOf(value) === index; });
    const blockedMatrix = ['MISSING', 'DIVERGENT'].indexOf(matrixStatus) !== -1;
    return {
      ID: uuid_(), CAMPAIGN_ID: campaignId, PORTAL_RETURN_ID: portalReturnId,
      TRACKING_CODE: trackingCode, SERVICE: service,
      STATUS: uniqueErrors.length || blockedMatrix ? 'REVIEW' : 'READY',
      POSTAL_JSON: source.postal || {}, RECIPIENT_JSON: source.recipient || {},
      CONTENT: String(source.content || ''), REFERENCE: String(source.reference || ''),
      ACCESS_KEY: String(source.accessKey || ''), PROTOCOL: String(source.protocol || ''),
      ERRORS_JSON: uniqueErrors, MATRIX_STATUS: matrixStatus, MATRIX_JSON: matrix,
      PRODUCTION_BATCH_ID: '', VOLUME_ID: '', CREATED_AT: now, UPDATED_AT: now
    };
  });
  appendObjects_('POSTAL_OBJECTS', records);
  return { appended: records.length };
}

function matrixSummaryForPortalObjects_(rows) {
  const summary = {
    autoVerified: 0, verified: 0, textOnly: 0, manualReview: 0, missing: 0, divergent: 0
  };
  rows.forEach(function(row) {
    const status = String(row.MATRIX_STATUS || 'MISSING');
    if (status === 'AUTO_VERIFIED') summary.autoVerified += 1;
    else if (status === 'VERIFIED') summary.verified += 1;
    else if (status === 'TEXT_ONLY') summary.textOnly += 1;
    else if (status === 'MANUAL_REVIEW') summary.manualReview += 1;
    else if (status === 'DIVERGENT') summary.divergent += 1;
    else summary.missing += 1;
  });
  summary.matched = summary.autoVerified + summary.verified + summary.textOnly + summary.manualReview;
  summary.fullyAutoVerified = rows.length > 0 && summary.autoVerified === rows.length;
  return summary;
}

function finishPortalReturn_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const portalReturn = findRow_('PORTAL_RETURNS', function(row) {
    return String(row.ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!portalReturn) throw new Error('Retorno do Portal Postal nao encontrado.');
  const rows = portalObjectsForReturn_(campaignId, portalReturnId);
  if (!rows.length) throw new Error('Nenhum objeto importado no retorno do Portal.');
  const pac = rows.filter(function(row) { return String(row.SERVICE) === 'PAC'; }).length;
  const sedex = rows.filter(function(row) { return String(row.SERVICE) === 'SEDEX'; }).length;
  const invalid = rows.filter(function(row) {
    const errors = safeJsonParse_(row.ERRORS_JSON, []);
    return errors.length || ['MISSING', 'DIVERGENT'].indexOf(String(row.MATRIX_STATUS)) !== -1;
  }).length;
  const matrixSummary = matrixSummaryForPortalObjects_(rows);
  const status = invalid ? 'REVIEW' : 'READY';
  const now = nowIso_();
  updateRow_('PORTAL_RETURNS', portalReturn._rowNumber, {
    STATUS: status, TOTAL_ROWS: rows.length, PAC_ROWS: pac, SEDEX_ROWS: sedex,
    INVALID_ROWS: invalid, MATRIX_SUMMARY_JSON: matrixSummary, UPDATED_AT: now
  });
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'PORTAL_RETURN_IMPORTED', quantity: rows.length,
    sourceType: 'PORTAL_RETURN', sourceId: portalReturnId,
    idempotencyKey: 'portal-return:' + portalReturnId,
    metadata: { pac: pac, sedex: sedex, invalid: invalid, matrix: matrixSummary }
  });
  return {
    id: portalReturnId, status: status, total: rows.length, pac: pac, sedex: sedex,
    invalid: invalid, matrix: matrixSummary
  };
}

function listPortalReturns_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('PORTAL_RETURNS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).map(publicRecord_).reverse();
}

function listPostalObjects_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId);
  const status = String(payload.status || '').toUpperCase();
  const limit = Math.max(1, Math.min(1000, Number(payload.limit || 250)));
  return portalObjectsForReturn_(campaignId, portalReturnId).filter(function(row) {
    return !status || String(row.STATUS) === status;
  }).slice(0, limit).map(function(row) {
    return {
      id: String(row.ID), trackingCode: String(row.TRACKING_CODE), service: String(row.SERVICE),
      status: String(row.STATUS), postal: safeJsonParse_(row.POSTAL_JSON, {}),
      recipient: safeJsonParse_(row.RECIPIENT_JSON, {}), content: String(row.CONTENT || ''),
      reference: String(row.REFERENCE || ''), accessKey: String(row.ACCESS_KEY || ''),
      protocol: String(row.PROTOCOL || ''), errors: safeJsonParse_(row.ERRORS_JSON, []),
      matrixStatus: String(row.MATRIX_STATUS || ''), matrix: safeJsonParse_(row.MATRIX_JSON, {}),
      productionBatchId: String(row.PRODUCTION_BATCH_ID || ''), volumeId: String(row.VOLUME_ID || '')
    };
  });
}

function productionDocumentMode_(value) {
  const mode = String(value || '').toUpperCase();
  if (['SIMPLIFIED_DECLARATION', 'DCE_AUTHORIZED'].indexOf(mode) === -1) {
    throw new Error('Escolha Declaracao Simplificada ou DC-e com e-CNPJ.');
  }
  return mode;
}

function createDeliveryVolumes_(campaignId, productionBatchId, objectRows) {
  const serviceOrder = ['SEDEX', 'PAC'];
  const volumeDrafts = [];
  serviceOrder.forEach(function(service) {
    const rows = objectRows.filter(function(row) { return String(row.SERVICE) === service; });
    for (let index = 0; index < rows.length; index += DCE_CONFIG.VOLUME_CAPACITY) {
      volumeDrafts.push({ service: service, rows: rows.slice(index, index + DCE_CONFIG.VOLUME_CAPACITY) });
    }
  });
  const totalVolumes = volumeDrafts.length;
  const now = nowIso_();
  const records = volumeDrafts.map(function(draft, index) {
    return {
      ID: uuid_(), CAMPAIGN_ID: campaignId, PRODUCTION_BATCH_ID: productionBatchId,
      SERVICE: draft.service, VOLUME_NUMBER: index + 1, TOTAL_VOLUMES: totalVolumes,
      QUANTITY: draft.rows.length,
      TRACKING_CODES_JSON: draft.rows.map(function(row) { return String(row.TRACKING_CODE); }),
      STATUS: 'PLANNED', DELIVERED_AT: '', RECEIVED_BY: '', PROOF_FILE_ID: '',
      CREATED_AT: now, UPDATED_AT: now,
      _objects: draft.rows
    };
  });
  appendObjects_('DELIVERY_VOLUMES', records.map(function(record) {
    const copy = Object.assign({}, record); delete copy._objects; return copy;
  }));
  records.forEach(function(record) {
    record._objects.forEach(function(objectRow) {
      updateRow_('POSTAL_OBJECTS', objectRow._rowNumber, {
        PRODUCTION_BATCH_ID: productionBatchId, VOLUME_ID: record.ID, UPDATED_AT: now
      });
    });
  });
  return records.map(function(record) {
    return {
      id: record.ID, service: record.SERVICE, number: record.VOLUME_NUMBER,
      totalVolumes: record.TOTAL_VOLUMES, quantity: record.QUANTITY,
      trackingCodes: record.TRACKING_CODES_JSON
    };
  });
}

function prepareProductionBatch_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const mode = productionDocumentMode_(payload.documentMode);
  const portalReturn = findRow_('PORTAL_RETURNS', function(row) {
    return String(row.ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!portalReturn) throw new Error('Retorno do Portal Postal nao encontrado.');
  if (String(portalReturn.STATUS) !== 'READY') throw new Error('O retorno do Portal possui pendencias e nao pode seguir para producao.');
  const objects = portalObjectsForReturn_(campaignId, portalReturnId);
  const blocked = objects.find(function(row) { return String(row.STATUS) !== 'READY'; });
  if (blocked) throw new Error('Ha objetos pendentes no lote.');
  const existing = findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.PORTAL_RETURN_ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (existing) throw new Error('Este retorno do Portal ja possui lote de producao.');
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
  const volumes = createDeliveryVolumes_(campaignId, batchId, objects);
  return {
    id: batchId, documentMode: mode, status: initialStatus,
    total: objects.length, pac: pac, sedex: sedex, volumes: volumes
  };
}

function listProductionBatches_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('PRODUCTION_BATCHES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).map(publicRecord_).reverse();
}

function listDeliveryVolumes_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('DELIVERY_VOLUMES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId
      && (!productionBatchId || String(row.PRODUCTION_BATCH_ID) === productionBatchId);
  }).map(function(row) {
    return {
      id: String(row.ID), productionBatchId: String(row.PRODUCTION_BATCH_ID),
      service: String(row.SERVICE), number: Number(row.VOLUME_NUMBER || 0),
      totalVolumes: Number(row.TOTAL_VOLUMES || 0), quantity: Number(row.QUANTITY || 0),
      trackingCodes: safeJsonParse_(row.TRACKING_CODES_JSON, []), status: String(row.STATUS || ''),
      deliveredAt: String(row.DELIVERED_AT || ''), receivedBy: String(row.RECEIVED_BY || '')
    };
  });
}
