function prepareBatch_(userId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const company = rowsForUser_('COMPANIES', userId)[0];
    if (!company) throw new Error('Cadastre a empresa emitente antes de preparar o lote.');
    const profile = safeJsonParse_(company.PROFILE_JSON, {});
    const ids = Array.isArray(payload.remittanceIds) ? payload.remittanceIds.map(String) : [];
    if (!ids.length) throw new Error('Selecione pelo menos uma remessa.');
    const remittances = rowsForUser_('REMITTANCES', userId).filter(function(row) {
      return ids.indexOf(String(row.ID)) !== -1;
    });
    if (remittances.length !== ids.length) throw new Error('Uma ou mais remessas não foram encontradas.');
    const blocked = remittances.find(function(row) { return String(row.STATUS) !== 'READY'; });
    if (blocked) throw new Error(`A remessa ${blocked.TRACKING_CODE || blocked.ID} não está pronta.`);
    const firstNumber = Number(company.NEXT_NUMBER || 1);
    if (firstNumber + remittances.length - 1 > 999999999) throw new Error('Faixa de numeração esgotada para a série.');
    const environment = String(payload.environment) === '1' ? '1' : '2';
    const batchId = uuid_();
    const now = nowIso_();
    const numericCodes = remittances.map(function() { return numericCode_(); });
    const documents = remittances.map(function(row, index) {
      const stored = safeJsonParse_(row.DOCUMENT_JSON, {});
      return {
        reference: String(row.ID), trackingCode: String(row.TRACKING_CODE), service: String(row.SERVICE),
        identification: {
          series: Number(company.SERIES || 0), number: firstNumber + index,
          environment: environment, emissionDateTime: now,
          authorizationSite: '0', numericCode: numericCodes[index], processVersion: `EMISSOR-DCE-${DCE_CONFIG.VERSION}`
        },
        issuer: profile,
        recipient: stored.recipient,
        items: stored.items,
        additionalInfo: stored.additionalInfo || ''
      };
    });
    updateRow_('COMPANIES', company._rowNumber, {
      NEXT_NUMBER: firstNumber + remittances.length, UPDATED_AT: now
    });
    appendObjects_('BATCHES', [{
      ID: batchId, USER_ID: userId, COMPANY_ID: company.ID, ENVIRONMENT: environment,
      STATUS: 'PREPARED', TOTAL: documents.length, AUTHORIZED: 0, REJECTED: 0,
      ERRORS: 0, CREATED_AT: now, UPDATED_AT: now
    }]);
    appendObjects_('DCE', remittances.map(function(row, index) {
      return {
        ID: uuid_(), USER_ID: userId, BATCH_ID: batchId, REMITTANCE_ID: row.ID,
        CNPJ: company.CNPJ, SERIES: company.SERIES, NUMBER: firstNumber + index, NUMERIC_CODE: numericCodes[index],
        ACCESS_KEY: '', STATUS: 'PREPARED', CSTAT: '', REASON: '', PROTOCOL: '',
        AUTHORIZED_AT: '', SIGNED_XML_FILE_ID: '', PROCESSED_XML_FILE_ID: '', DACE_FILE_ID: '',
        CREATED_AT: now, UPDATED_AT: now
      };
    }));
    remittances.forEach(function(row) {
      updateRow_('REMITTANCES', row._rowNumber, { STATUS: 'RESERVED', UPDATED_AT: now });
    });
    return { id: batchId, environment: environment, documents: documents };
  } finally {
    lock.releaseLock();
  }
}

function getBatch_(userId, payload) {
  const batchId = String(payload.batchId || '');
  const batch = findRow_('BATCHES', function(row) {
    return String(row.ID) === batchId && String(row.USER_ID) === String(userId);
  });
  if (!batch) throw new Error('Lote não encontrado.');
  const company = rowsForUser_('COMPANIES', userId).find(function(row) {
    return String(row.ID) === String(batch.COMPANY_ID);
  });
  const profile = safeJsonParse_(company && company.PROFILE_JSON, {});
  const remittances = rowsForUser_('REMITTANCES', userId);
  const documents = rowsForUser_('DCE', userId)
    .filter(function(row) { return String(row.BATCH_ID) === batchId; })
    .map(function(dce) {
      const remittance = remittances.find(function(row) { return String(row.ID) === String(dce.REMITTANCE_ID); });
      const stored = safeJsonParse_(remittance && remittance.DOCUMENT_JSON, {});
      return {
        reference: String(dce.REMITTANCE_ID), trackingCode: String(remittance && remittance.TRACKING_CODE || ''),
        service: String(remittance && remittance.SERVICE || ''),
        identification: { series: Number(dce.SERIES), number: Number(dce.NUMBER), numericCode: String(dce.NUMERIC_CODE), environment: String(batch.ENVIRONMENT), authorizationSite: '0' },
        issuer: profile, recipient: stored.recipient, items: stored.items, additionalInfo: stored.additionalInfo || ''
        , status: String(dce.STATUS), accessKey: String(dce.ACCESS_KEY || '')
      };
    });
  return { batch: publicRecord_(batch), documents: documents };
}

function saveBatchResults_(userId, payload) {
  const batchId = String(payload.batchId || '');
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (results.length > DCE_CONFIG.MAX_RESULT_CHUNK) throw new Error('Bloco de resultados muito grande.');
  const batch = findRow_('BATCHES', function(row) {
    return String(row.ID) === batchId && String(row.USER_ID) === String(userId);
  });
  if (!batch) throw new Error('Lote não encontrado.');
  const dceRows = rowsForUser_('DCE', userId).filter(function(row) { return String(row.BATCH_ID) === batchId; });
  const remittanceRows = rowsForUser_('REMITTANCES', userId);
  results.forEach(function(result) {
    const dce = dceRows.find(function(row) { return String(row.REMITTANCE_ID) === String(result.reference); });
    if (!dce) return;
    let signedId = String(dce.SIGNED_XML_FILE_ID || '');
    let processedId = String(dce.PROCESSED_XML_FILE_ID || '');
    const baseName = result.accessKey || `${dce.SERIES}-${dce.NUMBER}`;
    if (result.signedXml && !signedId) signedId = writeXmlFile_(userId, dce.CNPJ, `${baseName}-dce.xml`, result.signedXml);
    if (result.processedXml && !processedId) processedId = writeXmlFile_(userId, dce.CNPJ, `${baseName}-procDCe.xml`, result.processedXml);
    const status = String(result.status || 'ERROR');
    updateRow_('DCE', dce._rowNumber, {
      ACCESS_KEY: result.accessKey || dce.ACCESS_KEY, STATUS: status,
      CSTAT: result.cStat || '', REASON: result.reason || result.error || '',
      PROTOCOL: result.protocolNumber || '', AUTHORIZED_AT: result.receivedAt || '',
      SIGNED_XML_FILE_ID: signedId, PROCESSED_XML_FILE_ID: processedId, UPDATED_AT: nowIso_()
    });
    const remittance = remittanceRows.find(function(row) { return String(row.ID) === String(dce.REMITTANCE_ID); });
    if (remittance) updateRow_('REMITTANCES', remittance._rowNumber, {
      STATUS: status === 'AUTHORIZED' ? 'AUTHORIZED' : (status === 'REJECTED' ? 'REJECTED' : 'ERROR'),
      UPDATED_AT: nowIso_()
    });
  });
  return refreshBatchTotals_(userId, batch);
}

function refreshBatchTotals_(userId, batch) {
  const rows = rowsForUser_('DCE', userId).filter(function(row) { return String(row.BATCH_ID) === String(batch.ID); });
  const authorized = rows.filter(function(row) { return String(row.STATUS) === 'AUTHORIZED'; }).length;
  const rejected = rows.filter(function(row) { return String(row.STATUS) === 'REJECTED'; }).length;
  const errors = rows.filter(function(row) { return String(row.STATUS) === 'ERROR' || String(row.STATUS) === 'INVALID'; }).length;
  const finished = authorized + rejected === rows.length;
  const status = finished ? 'FINISHED' : (errors ? 'PARTIAL' : 'PROCESSING');
  updateRow_('BATCHES', batch._rowNumber, {
    STATUS: status, AUTHORIZED: authorized,
    REJECTED: rejected, ERRORS: errors, UPDATED_AT: nowIso_()
  });
  return { id: String(batch.ID), status: status, total: rows.length, authorized: authorized, rejected: rejected, errors: errors };
}

function listBatches_(userId) {
  return rowsForUser_('BATCHES', userId).map(publicRecord_).reverse();
}

function listDce_(userId, payload) {
  const batchId = String(payload.batchId || '');
  return rowsForUser_('DCE', userId)
    .filter(function(row) { return !batchId || String(row.BATCH_ID) === batchId; })
    .map(publicRecord_).reverse();
}

function recordDceEvent_(userId, payload) {
  const dceId = String(payload.dceId || '');
  const dce = findRow_('DCE', function(row) {
    return String(row.ID) === dceId && String(row.USER_ID) === String(userId);
  });
  if (!dce) throw new Error('DC-e não encontrada.');
  const event = payload.event || {};
  const status = String(event.status || 'REJECTED');
  appendObjects_('EVENTS', [{
    ID: uuid_(), USER_ID: userId, DCE_ID: dceId, TYPE: String(payload.type || 'QUERY'),
    STATUS: status, PROTOCOL: String(event.protocolNumber || ''),
    DETAILS_JSON: { cStat: event.cStat || '', reason: event.reason || '', receivedAt: event.receivedAt || '' },
    CREATED_AT: nowIso_()
  }]);
  if (status === 'CANCELLED') {
    updateRow_('DCE', dce._rowNumber, { STATUS: 'CANCELLED', CSTAT: event.cStat || '', REASON: event.reason || 'Cancelada', UPDATED_AT: nowIso_() });
    const remittance = findRow_('REMITTANCES', function(row) {
      return String(row.ID) === String(dce.REMITTANCE_ID) && String(row.USER_ID) === String(userId);
    });
    if (remittance) updateRow_('REMITTANCES', remittance._rowNumber, { STATUS: 'CANCELLED', UPDATED_AT: nowIso_() });
  }
  return { id: dceId, status: status };
}
