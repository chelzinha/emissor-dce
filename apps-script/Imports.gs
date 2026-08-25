function startImport_(userId, payload) {
  const fileName = String(payload.fileName || 'importacao').slice(0, 160);
  const fileType = String(payload.fileType || '').toUpperCase().slice(0, 10);
  if (['CSV', 'XML'].indexOf(fileType) === -1) throw new Error('Tipo de arquivo deve ser CSV ou XML.');
  const id = uuid_();
  const now = nowIso_();
  appendObjects_('IMPORTS', [{
    ID: id, USER_ID: userId, FILE_NAME: fileName, FILE_TYPE: fileType,
    STATUS: 'UPLOADING', TOTAL_ROWS: 0, VALID_ROWS: 0, ERROR_ROWS: 0,
    CREATED_AT: now, UPDATED_AT: now
  }]);
  return { id: id, chunkSize: DCE_CONFIG.MAX_IMPORT_CHUNK };
}

function appendImport_(userId, payload) {
  const importId = String(payload.importId || '');
  const importRow = findRow_('IMPORTS', function(row) {
    return String(row.ID) === importId && String(row.USER_ID) === String(userId);
  });
  if (!importRow) throw new Error('Importação não encontrada.');
  if (String(importRow.STATUS) !== 'UPLOADING') throw new Error('Importação já finalizada.');
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length < 1 || rows.length > DCE_CONFIG.MAX_IMPORT_CHUNK) {
    throw new Error(`Cada bloco deve conter de 1 a ${DCE_CONFIG.MAX_IMPORT_CHUNK} registros.`);
  }
  const existingTracking = {};
  rowsForUser_('REMITTANCES', userId).forEach(function(row) {
    const code = String(row.TRACKING_CODE || '').toUpperCase();
    if (code) existingTracking[code] = true;
  });
  const now = nowIso_();
  const records = rows.map(function(source, index) {
    const normalized = normalizeImportedRemittance_(source || {});
    if (normalized.trackingCode && existingTracking[normalized.trackingCode]) {
      normalized.errors.push('Código de rastreamento já importado.');
    }
    if (normalized.trackingCode) existingTracking[normalized.trackingCode] = true;
    return {
      ID: uuid_(), USER_ID: userId, IMPORT_ID: importId,
      TRACKING_CODE: normalized.trackingCode, SERVICE: normalized.service,
      REFERENCE: normalized.reference || String(index + 1),
      STATUS: normalized.errors.length ? 'INVALID' : 'READY',
      DOCUMENT_JSON: normalized.document, ERRORS_JSON: normalized.errors,
      CREATED_AT: now, UPDATED_AT: now
    };
  });
  appendObjects_('REMITTANCES', records);
  return { appended: records.length };
}

function finishImport_(userId, payload) {
  const importId = String(payload.importId || '');
  const row = findRow_('IMPORTS', function(item) {
    return String(item.ID) === importId && String(item.USER_ID) === String(userId);
  });
  if (!row) throw new Error('Importação não encontrada.');
  const remittances = rowsForUser_('REMITTANCES', userId).filter(function(item) {
    return String(item.IMPORT_ID) === importId;
  });
  const valid = remittances.filter(function(item) { return String(item.STATUS) === 'READY'; }).length;
  const invalid = remittances.length - valid;
  updateRow_('IMPORTS', row._rowNumber, {
    STATUS: invalid ? 'REVIEW' : 'READY', TOTAL_ROWS: remittances.length,
    VALID_ROWS: valid, ERROR_ROWS: invalid, UPDATED_AT: nowIso_()
  });
  return { id: importId, total: remittances.length, valid: valid, invalid: invalid };
}

function normalizeImportedRemittance_(source) {
  const errors = [];
  const trackingCode = String(source.trackingCode || '').replace(/\s/g, '').toUpperCase();
  const service = String(source.service || '').trim().toUpperCase();
  const document = source.document || source;
  if (!/^[A-Z]{2}\d{9}BR$/.test(trackingCode)) errors.push('Código SRO inválido.');
  if (['PAC', 'SEDEX'].indexOf(service) === -1) errors.push('Serviço deve ser PAC ou SEDEX.');
  if (!document.recipient || !String(document.recipient.name || '').trim()) errors.push('Destinatário obrigatório.');
  const recipientDocument = normalizeRecipientDocument_(document.recipient && document.recipient.document, document.recipient && document.recipient.documentType);
  if (!recipientDocument.valid) errors.push('Documento do destinatário inválido.');
  if (!document.recipient || !document.recipient.address) errors.push('Endereço do destinatário obrigatório.');
  const address = document.recipient && document.recipient.address || {};
  if (!String(address.street || '').trim() || !String(address.number || '').trim() || !String(address.district || '').trim() || !String(address.city || '').trim()) errors.push('Endereço do destinatário incompleto.');
  if (!/^[A-Z]{2}$/.test(String(address.uf || '').toUpperCase())) errors.push('UF do destinatário inválida.');
  if (!/^\d{8}$/.test(digits_(address.zip))) errors.push('CEP do destinatário inválido.');
  if (!/^\d{7}$/.test(digits_(address.cityCode))) errors.push('Código IBGE do destinatário inválido.');
  if (!Array.isArray(document.items) || !document.items.length) errors.push('Conteúdo e valor da remessa obrigatórios.');
  (Array.isArray(document.items) ? document.items : []).forEach(function(item, index) {
    if (!String(item.description || '').trim()) errors.push(`Descrição do item ${index + 1} obrigatória.`);
    if (!(Number(item.quantity) > 0)) errors.push(`Quantidade do item ${index + 1} inválida.`);
    if (!(Number(item.unitValue) >= 0.01)) errors.push(`Valor do item ${index + 1} inválido.`);
    if (Number(item.quantity) * Number(item.unitValue) > 10000000) errors.push(`Valor total do item ${index + 1} acima de R$ 10.000.000,00.`);
    const ncm = digits_(item.ncm);
    if (ncm && !/^\d{2}(?:\d{6})?$/.test(ncm)) errors.push(`NCM do item ${index + 1} inválido.`);
  });
  if ((Array.isArray(document.items) ? document.items : []).reduce(function(total, item) { return total + Number(item.quantity || 0) * Number(item.unitValue || 0); }, 0) > 10000000) errors.push('Valor total da DC-e acima de R$ 10.000.000,00.');
  return {
    trackingCode: trackingCode,
    service: service,
    reference: String(source.reference || trackingCode || ''),
    document: {
      reference: String(source.reference || trackingCode || ''),
      trackingCode: trackingCode,
      service: service,
      recipient: Object.assign({}, document.recipient || {}, { document: recipientDocument.document, documentType: recipientDocument.documentType }),
      items: Array.isArray(document.items) ? document.items : [],
      additionalInfo: String(document.additionalInfo || '')
    },
    errors: errors
  };
}

function listImports_(userId) {
  return rowsForUser_('IMPORTS', userId).map(publicRecord_).reverse();
}

function listRemittances_(userId, payload) {
  const importId = String(payload.importId || '');
  return rowsForUser_('REMITTANCES', userId)
    .filter(function(row) { return !importId || String(row.IMPORT_ID) === importId; })
    .map(function(row) {
      return {
        id: String(row.ID), importId: String(row.IMPORT_ID), trackingCode: String(row.TRACKING_CODE),
        service: String(row.SERVICE), reference: String(row.REFERENCE), status: String(row.STATUS),
        document: safeJsonParse_(row.DOCUMENT_JSON, {}), errors: safeJsonParse_(row.ERRORS_JSON, [])
      };
    });
}

function updateRemittances_(userId, payload) {
  const changes = Array.isArray(payload.rows) ? payload.rows : [];
  if (changes.length > DCE_CONFIG.MAX_IMPORT_CHUNK) throw new Error('Bloco de atualização muito grande.');
  const allRows = rowsForUser_('REMITTANCES', userId);
  let updated = 0;
  changes.forEach(function(change) {
    const row = allRows.find(function(item) { return String(item.ID) === String(change.id); });
    if (!row || ['RESERVED', 'AUTHORIZED', 'CANCELLED'].indexOf(String(row.STATUS)) !== -1) return;
    const normalized = normalizeImportedRemittance_(change);
    updateRow_('REMITTANCES', row._rowNumber, {
      TRACKING_CODE: normalized.trackingCode, SERVICE: normalized.service,
      REFERENCE: normalized.reference, STATUS: normalized.errors.length ? 'INVALID' : 'READY',
      DOCUMENT_JSON: normalized.document, ERRORS_JSON: normalized.errors, UPDATED_AT: nowIso_()
    });
    updated += 1;
  });
  return { updated: updated };
}
