function clientDcePackage_(campaignId, packageId) {
  return findRow_('DCE_AUTH_PACKAGES', function(row) {
    return String(row.ID) === String(packageId) && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function clientDceItems_(campaignId, packageId) {
  return sheetRows_(getSheet_('DCE_AUTH_ITEMS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.PACKAGE_ID) === String(packageId);
  });
}

function publicClientDcePackage_(row) {
  if (!row) return null;
  return {
    id: String(row.ID || ''), campaignId: String(row.CAMPAIGN_ID || ''), productionBatchId: String(row.PRODUCTION_BATCH_ID || ''),
    status: String(row.STATUS || ''), environment: String(row.ENVIRONMENT || '2'), total: Number(row.TOTAL || 0),
    authorized: Number(row.AUTHORIZED || 0), rejected: Number(row.REJECTED || 0), errors: Number(row.ERRORS || 0),
    series: Number(row.SERIES || 0), firstNumber: Number(row.FIRST_NUMBER || 0), lastNumber: Number(row.LAST_NUMBER || 0),
    createdAt: String(row.CREATED_AT || ''), updatedAt: String(row.UPDATED_AT || '')
  };
}

function writeCampaignXmlFile_(campaignId, fileName, content) {
  const campaignFolder = getOrCreateFolder_(getRootFolder_(), 'campaign_' + campaignId);
  const dceFolder = getOrCreateFolder_(campaignFolder, 'dce');
  const yearFolder = getOrCreateFolder_(dceFolder, String(new Date().getUTCFullYear()));
  return yearFolder.createFile(sanitizeFileName_(fileName), String(content), MimeType.XML).getId();
}

function readClientDceXmlFile_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  const fileId = String(payload.fileId || '').trim();
  if (!fileId) throw new Error('Arquivo nao informado.');
  const allowed = sheetRows_(getSheet_('DCE_AUTH_ITEMS')).some(function(row) {
    if (String(row.CAMPAIGN_ID) !== campaignId) return false;
    return [row.SIGNED_XML_FILE_ID, row.PROCESSED_XML_FILE_ID].some(function(value) { return String(value || '') === fileId; });
  });
  if (!allowed) throw new Error('Arquivo nao pertence a esta operacao.');
  const file = DriveApp.getFileById(fileId);
  return { id: fileId, name: file.getName(), content: file.getBlob().getDataAsString('UTF-8') };
}

function startClientDcePreparation_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const productionBatchId = String(payload.productionBatchId || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const batch = dceProductionBatch_(campaignId, productionBatchId);
    if (!batch) throw new Error('Lote de producao nao encontrado.');
    if (String(batch.DOCUMENT_MODE) !== 'DCE_AUTHORIZED') throw new Error('Este lote nao utiliza DC-e.');
    const existing = findRow_('DCE_AUTH_PACKAGES', function(row) {
      return String(row.PRODUCTION_BATCH_ID) === productionBatchId && String(row.CAMPAIGN_ID) === campaignId;
    });
    if (existing) return Object.assign({ chunkSize: 100, resumed: true }, publicClientDcePackage_(existing));

    const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
    const issuerRow = issuerProfileForCampaign_(campaignId);
    if (!issuerRow || String(issuerRow.STATUS) !== 'ACTIVE') throw new Error('O cliente precisa concluir e confirmar o perfil fiscal antes da preparacao da DC-e.');
    const issuerProfile = safeJsonParse_(issuerRow.PROFILE_JSON, {});
    issuerProfile.cnpj = String(issuerRow.CNPJ || issuerProfile.cnpj || '');
    issuerProfile.name = String(issuerRow.NAME || issuerProfile.name || '');
    issuerProfile.series = Number(issuerRow.SERIES || issuerProfile.series || 0);
    issuerProfile.nonIcmsContributor = true;
    issuerProfile.operationWithoutInvoice = true;
    const issuer = validateCompany_(issuerProfile);
    if (digits_(issuer.cnpj) !== digits_(campaign && campaign.CNPJ)) throw new Error('CNPJ do perfil fiscal diverge do CNPJ da operacao.');

    const productionObjects = dceProductionObjects_(campaignId, productionBatchId);
    const total = Number(batch.TOTAL || productionObjects.length || 0);
    if (total < 1) throw new Error('Lote sem objetos para preparar.');
    if (productionObjects.length !== total) throw new Error('Quantidade de objetos diverge do total do lote de producao.');
    const firstNumber = Number(issuerRow.NEXT_NUMBER || 1);
    const lastNumber = firstNumber + total - 1;
    if (!Number.isInteger(firstNumber) || firstNumber < 1 || lastNumber > 999999999) throw new Error('Faixa de numeracao DC-e invalida ou esgotada.');
    const id = uuid_();
    const now = nowIso_();
    const environment = String(payload.environment) === '1' ? '1' : '2';
    appendObjects_('DCE_AUTH_PACKAGES', [{
      ID: id, CAMPAIGN_ID: campaignId, PRODUCTION_BATCH_ID: productionBatchId, STATUS: 'UPLOADING', ENVIRONMENT: environment,
      TOTAL: total, AUTHORIZED: 0, REJECTED: 0, ERRORS: 0, ISSUER_PROFILE_ID: String(issuerRow.ID),
      SERIES: Number(issuerRow.SERIES || issuer.series || 0), FIRST_NUMBER: firstNumber, LAST_NUMBER: lastNumber,
      ISSUER_JSON: issuer, CREATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
    }]);
    updateRow_('DCE_ISSUER_PROFILES', issuerRow._rowNumber, { NEXT_NUMBER: lastNumber + 1, UPDATED_BY: userId, UPDATED_AT: now });
    return Object.assign({ chunkSize: 100, resumed: false }, publicClientDcePackage_(clientDcePackage_(campaignId, id)));
  } finally {
    lock.releaseLock();
  }
}

function validatePreparedDceDraft_(source, postalObject) {
  const tracking = String(source.trackingCode || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{9}BR$/.test(tracking)) throw new Error('SRO invalido: ' + tracking);
  const service = String(postalObject.SERVICE || '').toUpperCase();
  if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico postal invalido para ' + tracking + '.');
  if (source.service && String(source.service).toUpperCase() !== service) throw new Error('Servico divergente para ' + tracking + '.');
  if (['AUTO_VERIFIED', 'VERIFIED'].indexOf(String(postalObject.MATRIX_STATUS || '')) === -1) throw new Error('Data Matrix nao verificado para ' + tracking + '.');

  const recipient = source.recipient || {};
  const recipientDocument = digits_(recipient.document);
  const documentType = String(recipient.documentType || (recipientDocument.length === 14 ? 'CNPJ' : 'CPF')).toUpperCase();
  if (documentType === 'CPF' && !isValidCpf_(recipientDocument)) throw new Error('CPF do destinatario invalido para ' + tracking + '.');
  if (documentType === 'CNPJ' && !isValidCnpj_(recipientDocument)) throw new Error('CNPJ do destinatario invalido para ' + tracking + '.');
  const address = recipient.address || {};
  if (String(recipient.name || '').trim().length < 2) throw new Error('Nome do destinatario obrigatorio para ' + tracking + '.');
  if (!String(address.street || '').trim() || !String(address.number || '').trim() || !String(address.district || '').trim() || !String(address.city || '').trim()) {
    throw new Error('Endereco do destinatario incompleto para ' + tracking + '.');
  }
  if (!/^[A-Z]{2}$/.test(String(address.uf || '').toUpperCase())) throw new Error('UF do destinatario invalida para ' + tracking + '.');
  if (!/^\d{8}$/.test(digits_(address.zip))) throw new Error('CEP do destinatario invalido para ' + tracking + '.');
  if (!/^\d{7}$/.test(digits_(address.cityCode))) throw new Error('Codigo IBGE do destinatario obrigatorio para ' + tracking + '.');

  const items = Array.isArray(source.items) ? source.items : [];
  if (!items.length || items.length > 999) throw new Error('Itens da DC-e invalidos para ' + tracking + '.');
  const normalizedItems = items.map(function(item) {
    const quantity = Number(item.quantity);
    const unitValue = Number(item.unitValue);
    const ncm = digits_(item.ncm);
    const description = String(item.description || '').trim();
    if (!description) throw new Error('Descricao do conteudo obrigatoria para ' + tracking + '.');
    if (!(quantity > 0)) throw new Error('Quantidade invalida para ' + tracking + '.');
    if (!(unitValue >= 0.01)) throw new Error('Valor unitario invalido para ' + tracking + '.');
    if (ncm && !/^\d{2}(?:\d{6})?$/.test(ncm)) throw new Error('NCM invalido para ' + tracking + '.');
    return { description: description, ncm: ncm, quantity: quantity, unitValue: unitValue, additionalInfo: String(item.additionalInfo || '') };
  });
  return {
    trackingCode: tracking,
    service: service,
    recipient: {
      documentType: documentType, document: recipientDocument, name: String(recipient.name || '').trim(),
      address: {
        street: String(address.street || '').trim(), number: String(address.number || '').trim(), complement: String(address.complement || '').trim(),
        district: String(address.district || '').trim(), cityCode: digits_(address.cityCode), city: String(address.city || '').trim(),
        uf: String(address.uf || '').toUpperCase(), zip: digits_(address.zip), countryCode: digits_(address.countryCode || '1058'),
        country: String(address.country || 'BRASIL'), phone: digits_(address.phone), email: String(address.email || '')
      }
    },
    items: normalizedItems,
    additionalInfo: String(source.additionalInfo || '')
  };
}

function appendClientDceDocuments_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const packageId = String(payload.packageId || '');
  const pkg = clientDcePackage_(campaignId, packageId);
  if (!pkg || String(pkg.STATUS) !== 'UPLOADING') throw new Error('Pacote de DC-e nao esta aberto para preparacao.');
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  if (!documents.length || documents.length > 100) throw new Error('Bloco de documentos invalido.');
  const productionObjects = dceProductionObjects_(campaignId, pkg.PRODUCTION_BATCH_ID).sort(function(a, b) { return Number(a._rowNumber) - Number(b._rowNumber); });
  const byTracking = {};
  productionObjects.forEach(function(row, index) { byTracking[String(row.TRACKING_CODE)] = { row: row, index: index }; });
  const existing = {};
  clientDceItems_(campaignId, packageId).forEach(function(row) { existing[String(row.TRACKING_CODE)] = row; });
  const issuer = safeJsonParse_(pkg.ISSUER_JSON, {});
  const now = nowIso_();
  const records = documents.map(function(source) {
    const tracking = String(source.trackingCode || '').replace(/\s/g, '').toUpperCase();
    const located = byTracking[tracking];
    if (!located) throw new Error('SRO nao pertence ao lote de producao: ' + tracking);
    if (existing[tracking]) return { _skip: true, TRACKING_CODE: tracking };
    existing[tracking] = { _new: true };
    const prepared = validatePreparedDceDraft_(source, located.row);
    const id = uuid_();
    const number = Number(pkg.FIRST_NUMBER || 0) + located.index;
    const document = {
      reference: id, trackingCode: tracking, service: prepared.service,
      identification: {
        series: Number(pkg.SERIES || 0), number: number, environment: String(pkg.ENVIRONMENT || '2'),
        emissionDateTime: String(pkg.CREATED_AT || now), authorizationSite: '0', processVersion: 'EMISSOR-DCE-' + DCE_CONFIG.VERSION
      },
      issuer: issuer, recipient: prepared.recipient, items: prepared.items, additionalInfo: prepared.additionalInfo
    };
    return {
      ID: id, PACKAGE_ID: packageId, CAMPAIGN_ID: campaignId, POSTAL_OBJECT_ID: String(located.row.ID),
      TRACKING_CODE: tracking, SERVICE: prepared.service, SEQUENCE: located.index + 1, STATUS: 'PREPARED',
      DOCUMENT_JSON: document, ACCESS_KEY: '', CSTAT: '', REASON: '', PROTOCOL: '', QR_CODE: '', AUTHORIZED_AT: '',
      SIGNED_XML_FILE_ID: '', PROCESSED_XML_FILE_ID: '', CREATED_AT: now, UPDATED_AT: now,
      _postalRow: located.row
    };
  });
  const newRecords = records.filter(function(record) { return !record._skip; });
  appendObjects_('DCE_AUTH_ITEMS', newRecords.map(function(record) { const copy = Object.assign({}, record); delete copy._postalRow; return copy; }));
  newRecords.forEach(function(record) {
    updateRow_('POSTAL_OBJECTS', record._postalRow._rowNumber, { STATUS: 'DCE_PREPARED', UPDATED_AT: now });
  });
  return { appended: newRecords.length, skipped: records.length - newRecords.length };
}

function finishClientDcePreparation_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const packageId = String(payload.packageId || '');
  const pkg = clientDcePackage_(campaignId, packageId);
  if (!pkg) throw new Error('Pacote nao encontrado.');
  const items = clientDceItems_(campaignId, packageId);
  if (items.length !== Number(pkg.TOTAL || 0)) throw new Error('Pacote incompleto: ' + items.length + ' de ' + Number(pkg.TOTAL || 0) + ' documentos preparados.');
  const unique = {};
  items.forEach(function(item) {
    const tracking = String(item.TRACKING_CODE || '');
    if (unique[tracking]) throw new Error('SRO duplicado no pacote: ' + tracking);
    unique[tracking] = true;
  });
  const now = nowIso_();
  updateRow_('DCE_AUTH_PACKAGES', pkg._rowNumber, { STATUS: 'READY_FOR_AUTHORIZATION', UPDATED_AT: now });
  const batch = dceProductionBatch_(campaignId, pkg.PRODUCTION_BATCH_ID);
  if (batch) updateRow_('PRODUCTION_BATCHES', batch._rowNumber, { STATUS: 'AWAITING_CLIENT_AUTHORIZATION', UPDATED_AT: now });
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'DCE_PREPARED', quantity: items.length,
    sourceType: 'DCE_AUTH_PACKAGE', sourceId: packageId,
    idempotencyKey: 'dce-package-prepared:' + packageId,
    metadata: { environment: String(pkg.ENVIRONMENT || '2'), series: Number(pkg.SERIES || 0), firstNumber: Number(pkg.FIRST_NUMBER || 0), lastNumber: Number(pkg.LAST_NUMBER || 0) }
  });
  return publicClientDcePackage_(clientDcePackage_(campaignId, packageId));
}

function listClientDcePending_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('DCE_AUTH_PACKAGES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && ['READY_FOR_AUTHORIZATION', 'PROCESSING', 'PARTIAL'].indexOf(String(row.STATUS)) !== -1;
  }).map(publicClientDcePackage_).reverse();
}

function getClientDcePackage_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  const packageId = String(payload.packageId || '');
  const pkg = clientDcePackage_(campaignId, packageId);
  if (!pkg) throw new Error('Pacote de DC-e nao encontrado.');
  const result = publicClientDcePackage_(pkg);
  result.documents = clientDceItems_(campaignId, packageId).sort(function(a, b) { return Number(a.SEQUENCE || 0) - Number(b.SEQUENCE || 0); }).map(function(row) {
    const document = safeJsonParse_(row.DOCUMENT_JSON, {});
    document.status = String(row.STATUS || 'PREPARED');
    document.accessKey = String(row.ACCESS_KEY || '');
    document.protocol = String(row.PROTOCOL || '');
    document.qrCode = String(row.QR_CODE || '');
    document.authorizedAt = String(row.AUTHORIZED_AT || '');
    document.reason = String(row.REASON || '');
    return document;
  });
  return result;
}

function refreshClientDceTotals_(campaignId, pkg) {
  const items = clientDceItems_(campaignId, pkg.ID);
  const authorized = items.filter(function(row) { return String(row.STATUS) === 'AUTHORIZED'; }).length;
  const rejected = items.filter(function(row) { return String(row.STATUS) === 'REJECTED'; }).length;
  const errors = items.filter(function(row) { return ['ERROR', 'INVALID'].indexOf(String(row.STATUS)) !== -1; }).length;
  let status = 'READY_FOR_AUTHORIZATION';
  if (authorized === items.length && items.length) status = 'AUTHORIZED';
  else if (rejected || errors) status = 'PARTIAL';
  else if (authorized) status = 'PROCESSING';
  updateRow_('DCE_AUTH_PACKAGES', pkg._rowNumber, { STATUS: status, AUTHORIZED: authorized, REJECTED: rejected, ERRORS: errors, UPDATED_AT: nowIso_() });
  const batch = dceProductionBatch_(campaignId, pkg.PRODUCTION_BATCH_ID);
  if (batch) updateRow_('PRODUCTION_BATCHES', batch._rowNumber, { STATUS: status === 'AUTHORIZED' ? 'READY_FOR_LABEL_TEST' : 'AWAITING_CLIENT_AUTHORIZATION', UPDATED_AT: nowIso_() });
  return publicClientDcePackage_(clientDcePackage_(campaignId, pkg.ID));
}

function recordClientDceAuthorizedEvent_(userId, campaignId, item, packageId) {
  const idempotencyKey = 'client-dce-authorized:' + String(item.ID);
  const duplicate = findRow_('OPERATION_EVENTS', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.IDEMPOTENCY_KEY) === idempotencyKey;
  });
  if (duplicate) return;
  const occurredAt = nowIso_();
  appendObjects_('OPERATION_EVENTS', [{
    ID: uuid_(), CAMPAIGN_ID: campaignId, USER_ID: userId, TYPE: 'DCE_AUTHORIZED',
    SOURCE_TYPE: 'DCE_AUTH_ITEM', SOURCE_ID: String(item.ID), SERVICE: String(item.SERVICE || ''), QUANTITY: 1,
    IDEMPOTENCY_KEY: idempotencyKey, METADATA_JSON: { packageId: packageId, trackingCode: String(item.TRACKING_CODE || '') },
    OCCURRED_AT: occurredAt, CREATED_AT: occurredAt
  }]);
  refreshDailySummary_(campaignId, localDateFromIso_(occurredAt));
}

function saveClientDceResults_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  const packageId = String(payload.packageId || '');
  const pkg = clientDcePackage_(campaignId, packageId);
  if (!pkg) throw new Error('Pacote de DC-e nao encontrado.');
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (!results.length || results.length > DCE_CONFIG.MAX_RESULT_CHUNK) throw new Error('Bloco de resultados invalido.');
  const items = clientDceItems_(campaignId, packageId);
  results.forEach(function(result) {
    const item = items.find(function(row) { return String(row.ID) === String(result.reference); });
    if (!item) throw new Error('Resultado nao pertence ao pacote de DC-e.');
    const status = String(result.status || 'ERROR').toUpperCase();
    if (['AUTHORIZED', 'REJECTED', 'ERROR', 'INVALID'].indexOf(status) === -1) throw new Error('Status de resultado DC-e invalido.');
    if (String(item.STATUS) === 'AUTHORIZED' && status !== 'AUTHORIZED') return;
    const accessKey = digits_(result.accessKey || item.ACCESS_KEY || '');
    const protocol = String(result.protocolNumber || '');
    const qrCode = String(result.qrCode || item.QR_CODE || '').trim();
    if (status === 'AUTHORIZED' && !/^\d{44}$/.test(accessKey)) throw new Error('Chave de acesso autorizada invalida para ' + item.TRACKING_CODE + '.');
    if (status === 'AUTHORIZED' && !protocol) throw new Error('Protocolo de autorizacao ausente para ' + item.TRACKING_CODE + '.');
    if (status === 'AUTHORIZED' && !/^https:\/\//i.test(qrCode)) throw new Error('QR Code da DC-e ausente para ' + item.TRACKING_CODE + '.');
    if (status === 'AUTHORIZED' && qrCode.indexOf(accessKey) === -1) throw new Error('QR Code da DC-e diverge da chave autorizada para ' + item.TRACKING_CODE + '.');
    let signedId = String(item.SIGNED_XML_FILE_ID || '');
    let processedId = String(item.PROCESSED_XML_FILE_ID || '');
    if (result.signedXml && !signedId) signedId = writeCampaignXmlFile_(campaignId, (accessKey || item.ID) + '-dce.xml', String(result.signedXml));
    if (result.processedXml && !processedId) processedId = writeCampaignXmlFile_(campaignId, (accessKey || item.ID) + '-procDCe.xml', String(result.processedXml));
    updateRow_('DCE_AUTH_ITEMS', item._rowNumber, {
      STATUS: status, ACCESS_KEY: accessKey, CSTAT: String(result.cStat || ''), REASON: String(result.reason || result.error || ''),
      PROTOCOL: protocol, QR_CODE: qrCode, AUTHORIZED_AT: String(result.receivedAt || ''), SIGNED_XML_FILE_ID: signedId,
      PROCESSED_XML_FILE_ID: processedId, UPDATED_AT: nowIso_()
    });
    const object = findRow_('POSTAL_OBJECTS', function(row) {
      return String(row.ID) === String(item.POSTAL_OBJECT_ID) && String(row.CAMPAIGN_ID) === campaignId;
    });
    if (object && status === 'AUTHORIZED') updateRow_('POSTAL_OBJECTS', object._rowNumber, {
      STATUS: 'DCE_AUTHORIZED', ACCESS_KEY: accessKey, PROTOCOL: protocol, UPDATED_AT: nowIso_()
    });
    if (status === 'AUTHORIZED') recordClientDceAuthorizedEvent_(userId, campaignId, item, packageId);
  });
  return refreshClientDceTotals_(campaignId, pkg);
}
