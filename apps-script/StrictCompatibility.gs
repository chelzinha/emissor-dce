// Compatibility hardening for the consolidated postal-operations flow.
// This file intentionally wraps legacy functions instead of rewriting their source,
// reducing migration risk while enforcing the stricter production gates.

function processCleaningBatchStrict_(userId, payload) {
  const result = processCleaningBatch_(userId, payload);
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  addressRowsForList_(campaignId, listId).forEach(function(row) {
    if (String(row.CLEANING_BATCH_ID || '') !== String(result.id || '')) return;
    const original = safeJsonParse_(row.ORIGINAL_JSON, {});
    const cleaned = safeJsonParse_(row.CLEANED_JSON, {});
    const cityCode = digitsOnly_(
      cleaned.cityCode || cleaned.codigoIbge || cleaned.COD_IBGE ||
      original.cityCode || original.codigoIbge || original.COD_IBGE
    );
    if (!cityCode || cleaned.cityCode === cityCode) return;
    cleaned.cityCode = cityCode;
    updateRow_('ADDRESS_ROWS', row._rowNumber, { CLEANED_JSON: cleaned, UPDATED_AT: nowIso_() });
  });
  return result;
}

function updateCleanAddressRowStrict_(userId, payload) {
  const result = updateCleanAddressRow_(userId, payload);
  const campaignId = String(payload.campaignId || '');
  const rowId = String(payload.rowId || '');
  const row = findRow_('ADDRESS_ROWS', function(item) {
    return String(item.ID) === rowId && String(item.CAMPAIGN_ID) === campaignId;
  });
  if (!row) return result;
  const source = payload.data || {};
  const original = safeJsonParse_(row.ORIGINAL_JSON, {});
  const cleaned = safeJsonParse_(row.CLEANED_JSON, {});
  const cityCode = digitsOnly_(
    source.cityCode || source.codigoIbge || source.COD_IBGE ||
    original.cityCode || original.codigoIbge || original.COD_IBGE
  );
  if (cityCode) {
    cleaned.cityCode = cityCode;
    updateRow_('ADDRESS_ROWS', row._rowNumber, { CLEANED_JSON: cleaned, UPDATED_AT: nowIso_() });
    result.data = cleaned;
  }
  return result;
}

function exportPortalPostalStrict_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  const service = String(payload.service || '').toUpperCase();
  const selectedIds = Array.isArray(payload.rowIds) ? payload.rowIds.map(String) : [];
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  addressRowsForList_(campaignId, listId).forEach(function(row) {
    if (String(row.STATUS) !== 'READY' || String(row.PORTAL_EXPORT_ID || '')) return;
    if (selectedIds.length && selectedIds.indexOf(String(row.ID)) === -1) return;
    const cleaned = safeJsonParse_(row.CLEANED_JSON, {});
    if (String(cleaned.service || '').toUpperCase() !== service) return;
    if (!String(cleaned.customerId || '').trim()) {
      cleaned.customerId = String(row.ID);
      updateRow_('ADDRESS_ROWS', row._rowNumber, { CLEANED_JSON: cleaned, UPDATED_AT: nowIso_() });
    }
  });
  return exportPortalPostal_(userId, payload);
}

function addCampaignUserStrict_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const targetUserId = String(payload.userId || '').trim();
  const role = String(payload.role || 'CAMPAIGN_USER').toUpperCase();
  if (!targetUserId) throw new Error('Usuario nao informado.');
  if (['AGENCY_ADMIN', 'CAMPAIGN_USER', 'CLIENT_USER'].indexOf(role) === -1) {
    throw new Error('Perfil de acesso invalido.');
  }
  const now = nowIso_();
  const existing = findRow_('CAMPAIGN_USERS', function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.USER_ID) === targetUserId;
  });
  if (existing) {
    updateRow_('CAMPAIGN_USERS', existing._rowNumber, { ROLE: role, STATUS: 'ACTIVE', UPDATED_AT: now });
    return publicRecord_(findRow_('CAMPAIGN_USERS', function(row) { return String(row.ID) === String(existing.ID); }));
  }
  const record = {
    ID: uuid_(), CAMPAIGN_ID: campaignId, USER_ID: targetUserId, ROLE: role,
    STATUS: 'ACTIVE', CREATED_AT: now, UPDATED_AT: now
  };
  appendObjects_('CAMPAIGN_USERS', [record]);
  return record;
}

function isVerifiedMatrixStatus_(status) {
  return ['AUTO_VERIFIED', 'VERIFIED'].indexOf(String(status || '').toUpperCase()) !== -1;
}

function finishPortalReturnStrict_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const portalReturn = findRow_('PORTAL_RETURNS', function(row) {
    return String(row.ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!portalReturn) throw new Error('Retorno do Portal Postal nao encontrado.');
  const rows = portalObjectsForReturn_(campaignId, portalReturnId);
  if (!rows.length) throw new Error('Nenhum objeto importado no retorno do Portal.');

  let pac = 0;
  let sedex = 0;
  let invalid = 0;
  rows.forEach(function(row) {
    if (String(row.SERVICE) === 'PAC') pac += 1;
    if (String(row.SERVICE) === 'SEDEX') sedex += 1;
    const errors = safeJsonParse_(row.ERRORS_JSON, []);
    const matrixVerified = isVerifiedMatrixStatus_(row.MATRIX_STATUS);
    if (errors.length || !matrixVerified) invalid += 1;
    if (!matrixVerified && String(row.STATUS) !== 'REVIEW') {
      updateRow_('POSTAL_OBJECTS', row._rowNumber, { STATUS: 'REVIEW', UPDATED_AT: nowIso_() });
    }
  });

  const matrixSummary = matrixSummaryForPortalObjects_(rows);
  matrixSummary.verifiedTotal = Number(matrixSummary.autoVerified || 0) + Number(matrixSummary.verified || 0);
  matrixSummary.pending = Number(matrixSummary.textOnly || 0) + Number(matrixSummary.manualReview || 0)
    + Number(matrixSummary.missing || 0) + Number(matrixSummary.divergent || 0);
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
  if (!invalid && pac) recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'LABEL_GENERATED', quantity: pac, service: 'PAC',
    sourceType: 'PORTAL_RETURN', sourceId: portalReturnId,
    idempotencyKey: 'portal-return-labels-pac:' + portalReturnId,
    metadata: { origin: 'PORTAL_POSTAL' }
  });
  if (!invalid && sedex) recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'LABEL_GENERATED', quantity: sedex, service: 'SEDEX',
    sourceType: 'PORTAL_RETURN', sourceId: portalReturnId,
    idempotencyKey: 'portal-return-labels-sedex:' + portalReturnId,
    metadata: { origin: 'PORTAL_POSTAL' }
  });
  return {
    id: portalReturnId, status: status, total: rows.length, pac: pac, sedex: sedex,
    invalid: invalid, matrix: matrixSummary
  };
}

function listPostalObjectsStrict_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId);
  const status = String(payload.status || '').toUpperCase();
  const limit = Math.max(1, Math.min(1000, Number(payload.limit || 250)));
  const offset = Math.max(0, Number(payload.offset || 0));
  return portalObjectsForReturn_(campaignId, portalReturnId).filter(function(row) {
    return !status || String(row.STATUS) === status;
  }).slice(offset, offset + limit).map(function(row) {
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

function prepareProductionBatchStrict_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const portalReturnId = String(payload.portalReturnId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const mode = productionDocumentMode_(payload.documentMode);
  const portalReturn = findRow_('PORTAL_RETURNS', function(row) {
    return String(row.ID) === portalReturnId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!portalReturn) throw new Error('Retorno do Portal Postal nao encontrado.');
  if (String(portalReturn.STATUS) !== 'READY') {
    throw new Error('O retorno do Portal possui pendencias e nao pode seguir para producao.');
  }
  const objects = portalObjectsForReturn_(campaignId, portalReturnId);
  const blocked = objects.find(function(row) {
    return String(row.STATUS) !== 'READY' || !isVerifiedMatrixStatus_(row.MATRIX_STATUS);
  });
  if (blocked) throw new Error('Ha objetos pendentes ou Data Matrix nao verificado no lote.');
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
  updateRow_('PORTAL_RETURNS', portalReturn._rowNumber, {
    DOCUMENT_MODE: mode, STATUS: 'IN_PRODUCTION', UPDATED_AT: now
  });
  const volumes = createDeliveryVolumes_(campaignId, batchId, objects);
  return {
    id: batchId, documentMode: mode, status: initialStatus,
    total: objects.length, pac: pac, sedex: sedex, volumes: volumes
  };
}
