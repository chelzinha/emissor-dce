const PORTAL_POSTAL_HEADERS = Object.freeze([
  'NOME', 'EMPRESA', 'CPF', 'CEP', 'ENDEREÇO', 'NUMERO', 'COMPLEMENTO', 'BAIRRO', 'CIDADE', 'UF',
  'AOS_CUIDADOS', 'NOTA_FISCAL', 'SERVICO', 'SERV_ADICIONAIS', 'VALOR_DECLARADO', 'OBSERVAÇÕES',
  'CONTEUDO', 'DDD', 'TELEFONE', 'EMAIL', 'IDENTIFICADOR_CLIENTE (chave do cliente)', 'PESO', 'ALTURA',
  'LARGURA', 'COMPRIMENTO', 'ENTREGA_VIZINHO', 'RFID', 'CHAVE_NOTA_FISCAL'
]);

function startAddressList_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const fileName = String(payload.fileName || 'lista_enderecamento').slice(0, 180);
  const id = uuid_();
  const now = nowIso_();
  appendObjects_('ADDRESS_LISTS', [{
    ID: id, CAMPAIGN_ID: campaignId, FILE_NAME: fileName, STATUS: 'UPLOADING',
    TOTAL_ROWS: 0, READY_ROWS: 0, REVIEW_ROWS: 0, REJECTED_ROWS: 0,
    SOURCE_METADATA_JSON: payload.metadata || {}, CREATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
  }]);
  return { id: id, chunkSize: DCE_CONFIG.MAX_ADDRESS_CHUNK };
}

function appendAddressRows_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const list = findRow_('ADDRESS_LISTS', function(row) {
    return String(row.ID) === listId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!list) throw new Error('Lista de enderecamento nao encontrada.');
  if (String(list.STATUS) !== 'UPLOADING') throw new Error('A lista nao esta aberta para importacao.');
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length || rows.length > DCE_CONFIG.MAX_ADDRESS_CHUNK) throw new Error('Bloco de enderecos invalido.');
  const existingCount = sheetRows_(getSheet_('ADDRESS_ROWS')).filter(function(row) {
    return String(row.ADDRESS_LIST_ID) === listId;
  }).length;
  const now = nowIso_();
  appendObjects_('ADDRESS_ROWS', rows.map(function(source, index) {
    return {
      ID: uuid_(), CAMPAIGN_ID: campaignId, ADDRESS_LIST_ID: listId, ROW_NUMBER: existingCount + index + 1,
      STATUS: 'RAW', ORIGINAL_JSON: source || {}, CLEANED_JSON: source || {}, ISSUES_JSON: [],
      CLEANING_BATCH_ID: '', PORTAL_EXPORT_ID: '', CREATED_AT: now, UPDATED_AT: now
    };
  }));
  return { appended: rows.length };
}

function finishAddressList_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const list = findRow_('ADDRESS_LISTS', function(row) {
    return String(row.ID) === listId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!list) throw new Error('Lista de enderecamento nao encontrada.');
  const rows = addressRowsForList_(campaignId, listId);
  updateAddressListTotals_(list, rows, 'RECEIVED');
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'ADDRESS_LIST_RECEIVED', quantity: rows.length,
    sourceType: 'ADDRESS_LIST', sourceId: listId, idempotencyKey: 'address-list-received:' + listId,
    metadata: { fileName: String(list.FILE_NAME || '') }
  });
  return addressListSummary_(findRow_('ADDRESS_LISTS', function(row) { return String(row.ID) === listId; }));
}

function addressRowsForList_(campaignId, listId) {
  return sheetRows_(getSheet_('ADDRESS_ROWS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.ADDRESS_LIST_ID) === String(listId);
  });
}

function cleanText_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeUf_(value) {
  return cleanText_(value).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function digitsOnly_(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function normalizePortalCandidate_(source, defaults) {
  const row = source || {};
  const d = defaults || {};
  return {
    name: cleanText_(row.name || row.NOME || row.destinatario || row.DESTINATARIO),
    company: cleanText_(row.company || row.EMPRESA),
    cpf: digitsOnly_(row.cpf || row.CPF),
    zip: digitsOnly_(row.zip || row.cep || row.CEP),
    street: cleanText_(row.street || row.endereco || row['ENDEREÇO'] || row.ENDERECO),
    number: cleanText_(row.number || row.numero || row.NUMERO),
    complement: cleanText_(row.complement || row.complemento || row.COMPLEMENTO),
    district: cleanText_(row.district || row.bairro || row.BAIRRO),
    city: cleanText_(row.city || row.cidade || row.CIDADE),
    uf: normalizeUf_(row.uf || row.UF),
    careOf: cleanText_(row.careOf || row.AOS_CUIDADOS),
    invoice: cleanText_(row.invoice || row.NOTA_FISCAL),
    service: cleanText_(row.service || row.servico || row.SERVICO || d.service).toUpperCase(),
    additionalServices: cleanText_(row.additionalServices || row.SERV_ADICIONAIS),
    declaredValue: cleanText_(row.declaredValue || row.VALOR_DECLARADO),
    observations: cleanText_(row.observations || row['OBSERVAÇÕES'] || row.OBSERVACOES),
    content: cleanText_(row.content || row.conteudo || row.CONTEUDO || d.content),
    ddd: digitsOnly_(row.ddd || row.DDD),
    phone: digitsOnly_(row.phone || row.telefone || row.TELEFONE),
    email: cleanText_(row.email || row.EMAIL),
    customerId: cleanText_(row.customerId || row['IDENTIFICADOR_CLIENTE (chave do cliente)']),
    weight: cleanText_(row.weight || row.peso || row.PESO || d.weight),
    height: cleanText_(row.height || row.altura || row.ALTURA || d.height),
    width: cleanText_(row.width || row.largura || row.LARGURA || d.width),
    length: cleanText_(row.length || row.comprimento || row.COMPRIMENTO || d.length),
    neighborDelivery: cleanText_(row.neighborDelivery || row.ENTREGA_VIZINHO),
    rfid: cleanText_(row.rfid || row.RFID),
    invoiceKey: cleanText_(row.invoiceKey || row.CHAVE_NOTA_FISCAL)
  };
}

function validateCleanAddress_(row) {
  const issues = [];
  if (!row.name) issues.push({ field: 'NOME', code: 'REQUIRED', severity: 'ERROR', message: 'Nome obrigatorio.' });
  if (!/^\d{8}$/.test(row.zip)) issues.push({ field: 'CEP', code: 'INVALID_CEP', severity: 'ERROR', message: 'CEP deve ter 8 digitos.' });
  if (!row.street) issues.push({ field: 'ENDEREÇO', code: 'REQUIRED', severity: 'ERROR', message: 'Logradouro obrigatorio.' });
  if (!row.number) issues.push({ field: 'NUMERO', code: 'REQUIRED', severity: 'ERROR', message: 'Numero obrigatorio.' });
  if (digitsOnly_(row.number).length > 8 && /^\d+$/.test(row.number)) issues.push({ field: 'NUMERO', code: 'SUSPICIOUS_NUMBER', severity: 'REVIEW', message: 'Numero com quantidade incomum de digitos.' });
  if (!row.district) issues.push({ field: 'BAIRRO', code: 'REQUIRED', severity: 'ERROR', message: 'Bairro obrigatorio.' });
  if (!row.city) issues.push({ field: 'CIDADE', code: 'REQUIRED', severity: 'ERROR', message: 'Cidade obrigatoria.' });
  if (!/^[A-Z]{2}$/.test(row.uf)) issues.push({ field: 'UF', code: 'INVALID_UF', severity: 'ERROR', message: 'UF invalida.' });
  if (['PAC', 'SEDEX'].indexOf(row.service) === -1) issues.push({ field: 'SERVICO', code: 'INVALID_SERVICE', severity: 'ERROR', message: 'Servico deve ser PAC ou SEDEX.' });
  if (!row.content) issues.push({ field: 'CONTEUDO', code: 'REQUIRED', severity: 'ERROR', message: 'Conteudo obrigatorio.' });
  return issues;
}

function cleaningStatusFromIssues_(issues) {
  if (issues.some(function(issue) { return issue.severity === 'ERROR'; })) return 'REVIEW';
  if (issues.some(function(issue) { return issue.severity === 'REVIEW'; })) return 'REVIEW';
  return 'READY';
}

function processCleaningBatch_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const list = findRow_('ADDRESS_LISTS', function(row) {
    return String(row.ID) === listId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!list) throw new Error('Lista de enderecamento nao encontrada.');
  const requestedIds = Array.isArray(payload.rowIds) ? payload.rowIds.map(String) : [];
  const allRows = addressRowsForList_(campaignId, listId);
  const candidates = requestedIds.length ? allRows.filter(function(row) { return requestedIds.indexOf(String(row.ID)) !== -1; }) : allRows.filter(function(row) { return ['RAW', 'REVIEW'].indexOf(String(row.STATUS)) !== -1; });
  if (!candidates.length) throw new Error('Nenhum cadastro disponivel para limpeza.');
  if (candidates.length > DCE_CONFIG.MAX_ADDRESS_CHUNK) throw new Error('Processe no maximo ' + DCE_CONFIG.MAX_ADDRESS_CHUNK + ' registros por baixa.');
  const batchId = uuid_();
  const now = nowIso_();
  let ready = 0, review = 0, rejected = 0;
  candidates.forEach(function(row) {
    const source = safeJsonParse_(row.CLEANED_JSON, safeJsonParse_(row.ORIGINAL_JSON, {}));
    const cleaned = normalizePortalCandidate_(source, payload.defaults || {});
    const issues = validateCleanAddress_(cleaned);
    const status = cleaningStatusFromIssues_(issues);
    if (status === 'READY') ready += 1;
    else if (status === 'REJECTED') rejected += 1;
    else review += 1;
    updateRow_('ADDRESS_ROWS', row._rowNumber, {
      STATUS: status, CLEANED_JSON: cleaned, ISSUES_JSON: issues, CLEANING_BATCH_ID: batchId, UPDATED_AT: now
    });
  });
  const summary = { processed: candidates.length, ready: ready, review: review, rejected: rejected };
  appendObjects_('CLEANING_BATCHES', [{
    ID: batchId, CAMPAIGN_ID: campaignId, ADDRESS_LIST_ID: listId, STATUS: 'FINISHED',
    PROCESSED: candidates.length, READY: ready, REVIEW: review, REJECTED: rejected,
    SUMMARY_JSON: summary, CREATED_BY: userId, CREATED_AT: now
  }]);
  updateAddressListTotals_(list, addressRowsForList_(campaignId, listId), 'CLEANING');
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'ADDRESS_CLEANING_COMPLETED', quantity: candidates.length,
    sourceType: 'CLEANING_BATCH', sourceId: batchId, idempotencyKey: 'cleaning-batch:' + batchId,
    metadata: summary
  });
  return { id: batchId, summary: summary };
}

function updateCleanAddressRow_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const rowId = String(payload.rowId || '');
  const row = findRow_('ADDRESS_ROWS', function(item) {
    return String(item.ID) === rowId && String(item.CAMPAIGN_ID) === campaignId;
  });
  if (!row) throw new Error('Cadastro nao encontrado.');
  if (row.PORTAL_EXPORT_ID) throw new Error('Cadastro ja exportado para o Portal Postal.');
  const cleaned = normalizePortalCandidate_(payload.data || {}, payload.defaults || {});
  const issues = validateCleanAddress_(cleaned);
  const status = cleaningStatusFromIssues_(issues);
  updateRow_('ADDRESS_ROWS', row._rowNumber, { STATUS: status, CLEANED_JSON: cleaned, ISSUES_JSON: issues, UPDATED_AT: nowIso_() });
  const list = findRow_('ADDRESS_LISTS', function(item) { return String(item.ID) === String(row.ADDRESS_LIST_ID); });
  if (list) updateAddressListTotals_(list, addressRowsForList_(campaignId, row.ADDRESS_LIST_ID), 'CLEANING');
  return { id: rowId, status: status, data: cleaned, issues: issues };
}

function updateAddressListTotals_(list, rows, status) {
  const ready = rows.filter(function(row) { return String(row.STATUS) === 'READY'; }).length;
  const review = rows.filter(function(row) { return String(row.STATUS) === 'REVIEW'; }).length;
  const rejected = rows.filter(function(row) { return String(row.STATUS) === 'REJECTED'; }).length;
  updateRow_('ADDRESS_LISTS', list._rowNumber, {
    STATUS: status || list.STATUS, TOTAL_ROWS: rows.length, READY_ROWS: ready,
    REVIEW_ROWS: review, REJECTED_ROWS: rejected, UPDATED_AT: nowIso_()
  });
}

function addressListSummary_(row) {
  return {
    id: String(row.ID), campaignId: String(row.CAMPAIGN_ID), fileName: String(row.FILE_NAME || ''),
    status: String(row.STATUS || ''), total: Number(row.TOTAL_ROWS || 0), ready: Number(row.READY_ROWS || 0),
    review: Number(row.REVIEW_ROWS || 0), rejected: Number(row.REJECTED_ROWS || 0),
    createdAt: String(row.CREATED_AT || ''), updatedAt: String(row.UPDATED_AT || '')
  };
}

function listAddressLists_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('ADDRESS_LISTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).map(addressListSummary_).reverse();
}

function listAddressRows_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  requireCampaignAccess_(campaignId, userId);
  const status = String(payload.status || '').toUpperCase();
  const limit = Math.max(1, Math.min(500, Number(payload.limit || 200)));
  return addressRowsForList_(campaignId, listId).filter(function(row) {
    return !status || String(row.STATUS) === status;
  }).slice(0, limit).map(function(row) {
    return {
      id: String(row.ID), rowNumber: Number(row.ROW_NUMBER || 0), status: String(row.STATUS || ''),
      original: safeJsonParse_(row.ORIGINAL_JSON, {}), cleaned: safeJsonParse_(row.CLEANED_JSON, {}),
      issues: safeJsonParse_(row.ISSUES_JSON, []), portalExportId: String(row.PORTAL_EXPORT_ID || '')
    };
  });
}

function csvEscapePortal_(value) {
  const text = String(value == null ? '' : value);
  return /[;"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function portalRowValues_(row) {
  return [
    row.name, row.company, row.cpf, row.zip, row.street, row.number, row.complement, row.district, row.city, row.uf,
    row.careOf, row.invoice, row.service, row.additionalServices, row.declaredValue, row.observations, row.content,
    row.ddd, row.phone, row.email, row.customerId, row.weight, row.height, row.width, row.length,
    row.neighborDelivery, row.rfid, row.invoiceKey
  ];
}

function buildPortalCsv_(rows) {
  const lines = [PORTAL_POSTAL_HEADERS.map(csvEscapePortal_).join(';')];
  rows.forEach(function(row) { lines.push(portalRowValues_(row).map(csvEscapePortal_).join(';')); });
  return lines.join('\r\n') + '\r\n';
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte < 0 ? byte + 256 : byte).toString(16))).slice(-2); }).join('');
}

function exportPortalPostal_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const listId = String(payload.addressListId || '');
  const service = String(payload.service || '').toUpperCase();
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Escolha PAC ou SEDEX para a exportacao.');
  const list = findRow_('ADDRESS_LISTS', function(row) {
    return String(row.ID) === listId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!list) throw new Error('Lista de enderecamento nao encontrada.');
  const selectedIds = Array.isArray(payload.rowIds) ? payload.rowIds.map(String) : [];
  const sourceRows = addressRowsForList_(campaignId, listId).filter(function(row) {
    if (String(row.STATUS) !== 'READY' || String(row.PORTAL_EXPORT_ID || '')) return false;
    const clean = safeJsonParse_(row.CLEANED_JSON, {});
    if (String(clean.service || '').toUpperCase() !== service) return false;
    return !selectedIds.length || selectedIds.indexOf(String(row.ID)) !== -1;
  });
  if (!sourceRows.length) throw new Error('Nenhum cadastro pronto para exportacao ' + service + '.');
  const cleanRows = sourceRows.map(function(row) { return normalizePortalCandidate_(safeJsonParse_(row.CLEANED_JSON, {}), {}); });
  cleanRows.forEach(function(row, index) {
    const issues = validateCleanAddress_(row);
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
  sourceRows.forEach(function(row) { updateRow_('ADDRESS_ROWS', row._rowNumber, { PORTAL_EXPORT_ID: exportId, UPDATED_AT: now }); });
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'PORTAL_CSV_EXPORTED', quantity: sourceRows.length, service: service,
    sourceType: 'PORTAL_EXPORT', sourceId: exportId, idempotencyKey: 'portal-export:' + exportId,
    metadata: { fileName: fileName, sha256: hash, addressListId: listId }
  });
  return { id: exportId, service: service, total: sourceRows.length, fileName: fileName, fileId: file.getId(), sha256: hash, csv: csv };
}

function listPortalExports_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('PORTAL_EXPORTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).map(publicRecord_).reverse();
}
