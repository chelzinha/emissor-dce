function productionDceImportName_(productionBatchId) {
  return 'AGF-DCE-' + String(productionBatchId || '');
}

function campaignRowById_(campaignId) {
  return findRow_('CAMPAIGNS', function(row) {
    return String(row.ID) === String(campaignId);
  });
}

function campaignClientUserId_(campaignId, requestedUserId) {
  const clients = sheetRows_(getSheet_('CAMPAIGN_USERS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.ROLE) === 'CAMPAIGN_USER'
      && String(row.STATUS) === 'ACTIVE';
  });
  const requested = String(requestedUserId || '').trim();
  if (requested) {
    const match = clients.find(function(row) { return String(row.USER_ID) === requested; });
    if (!match) throw new Error('Usuario do cliente nao pertence a esta operacao.');
    return String(match.USER_ID);
  }
  if (!clients.length) throw new Error('Nenhum usuario do cliente esta vinculado a esta operacao.');
  if (clients.length > 1) throw new Error('Ha mais de um usuario do cliente. Informe qual deve autorizar este lote.');
  return String(clients[0].USER_ID);
}

function campaignCompanyGet_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  const campaign = campaignRowById_(campaignId);
  if (!campaign) throw new Error('Operacao nao encontrada.');
  const company = getCompany_(userId);
  if (!company) return null;
  if (digits_(company.cnpj) !== digits_(campaign.CNPJ)) {
    throw new Error('O CNPJ do perfil fiscal nao corresponde ao CNPJ desta operacao.');
  }
  return company;
}

function campaignCompanyUpsert_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['CAMPAIGN_USER', 'AGENCY_ADMIN']);
  const campaign = campaignRowById_(campaignId);
  if (!campaign) throw new Error('Operacao nao encontrada.');
  const profile = payload.profile || {};
  if (digits_(profile.cnpj) !== digits_(campaign.CNPJ)) {
    throw new Error('O CNPJ do perfil fiscal deve ser o mesmo CNPJ da operacao.');
  }
  return upsertCompany_(userId, {
    profile: profile,
    nextNumber: payload.nextNumber
  });
}

function productionBatchRow_(campaignId, productionBatchId) {
  return findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === String(productionBatchId)
      && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function productionObjects_(campaignId, productionBatchId) {
  return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PRODUCTION_BATCH_ID) === String(productionBatchId);
  });
}

function productionDceImport_(clientUserId, productionBatchId) {
  const expectedName = productionDceImportName_(productionBatchId);
  return rowsForUser_('IMPORTS', clientUserId).find(function(row) {
    return String(row.FILE_NAME) === expectedName;
  }) || null;
}

function productionDceRemittances_(clientUserId, productionBatchId) {
  const importRow = productionDceImport_(clientUserId, productionBatchId);
  if (!importRow) return [];
  return rowsForUser_('REMITTANCES', clientUserId).filter(function(row) {
    return String(row.IMPORT_ID) === String(importRow.ID);
  });
}

function productionDceFiscalBatchId_(clientUserId, remittances) {
  if (!remittances.length) return '';
  const remittanceIds = {};
  remittances.forEach(function(row) { remittanceIds[String(row.ID)] = true; });
  const batchIds = {};
  rowsForUser_('DCE', clientUserId).forEach(function(row) {
    if (remittanceIds[String(row.REMITTANCE_ID)]) batchIds[String(row.BATCH_ID)] = true;
  });
  const ids = Object.keys(batchIds);
  if (ids.length > 1) throw new Error('O lote de producao esta associado a mais de um lote fiscal.');
  return ids[0] || '';
}

function postalCityCode_(postalObject, recipient) {
  const postal = safeJsonParse_(postalObject.POSTAL_JSON, {});
  const address = recipient.address || {};
  return digits_(
    address.cityCode
    || postal.CODIGO_IBGE
    || postal.CODIGO_MUNICIPIO
    || postal.IBGE
    || postal.CIDADE_IBGE
    || ''
  );
}

function productionDceSource_(postalObject, defaults) {
  const recipient = safeJsonParse_(postalObject.RECIPIENT_JSON, {});
  const address = Object.assign({}, recipient.address || {});
  address.cityCode = postalCityCode_(postalObject, recipient);
  const description = String(postalObject.CONTENT || defaults.description || '').trim();
  const quantity = Number(defaults.quantity || 1);
  const unitValue = Number(defaults.unitValue);
  const ncm = digits_(defaults.ncm || '');
  return {
    reference: String(postalObject.ID),
    trackingCode: String(postalObject.TRACKING_CODE || ''),
    service: String(postalObject.SERVICE || ''),
    document: {
      recipient: {
        name: String(recipient.name || ''),
        document: digits_(recipient.document || ''),
        address: address
      },
      items: [{
        description: description,
        quantity: quantity,
        unitValue: unitValue,
        ncm: ncm
      }],
      additionalInfo: 'Objeto postal ' + String(postalObject.TRACKING_CODE || '') + ' - ' + String(postalObject.SERVICE || '')
    }
  };
}

function productionDcePreflight_(objects, defaults) {
  const prepared = [];
  const errors = [];
  objects.forEach(function(objectRow) {
    const source = productionDceSource_(objectRow, defaults);
    const normalized = normalizeImportedRemittance_(source);
    if (normalized.errors.length) {
      errors.push(String(objectRow.TRACKING_CODE || objectRow.ID) + ': ' + normalized.errors.join(' | '));
    }
    prepared.push(source);
  });
  return { rows: prepared, errors: errors };
}

function prepareProductionDce_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const batch = productionBatchRow_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  if (String(batch.DOCUMENT_MODE) !== 'DCE_AUTHORIZED') throw new Error('Este lote nao utiliza DC-e com e-CNPJ.');
  if (['AWAITING_DCE_PREPARATION', 'DCE_REVIEW', 'DCE_PREPARED'].indexOf(String(batch.STATUS)) === -1) {
    throw new Error('O lote nao esta disponivel para preparo fiscal.');
  }

  const clientUserId = campaignClientUserId_(campaignId, payload.clientUserId);
  const company = getCompany_(clientUserId);
  const campaign = campaignRowById_(campaignId);
  if (!company) throw new Error('O cliente ainda nao concluiu o Perfil fiscal da operacao.');
  if (digits_(company.cnpj) !== digits_(campaign.CNPJ)) throw new Error('O CNPJ do Perfil fiscal nao corresponde ao CNPJ da operacao.');

  const existingImport = productionDceImport_(clientUserId, productionBatchId);
  if (existingImport) {
    const existingRows = productionDceRemittances_(clientUserId, productionBatchId);
    const invalid = existingRows.filter(function(row) { return String(row.STATUS) === 'INVALID'; }).length;
    if (!invalid) {
      if (String(batch.STATUS) !== 'DCE_PREPARED') {
        updateRow_('PRODUCTION_BATCHES', batch._rowNumber, { STATUS: 'DCE_PREPARED', UPDATED_AT: nowIso_() });
      }
      return { id: productionBatchId, status: 'DCE_PREPARED', total: existingRows.length, clientUserId: clientUserId, reused: true };
    }
    throw new Error('Ja existe um preparo fiscal com pendencias para este lote.');
  }

  const objects = productionObjects_(campaignId, productionBatchId);
  if (!objects.length) throw new Error('O lote nao possui objetos postais.');
  const blocked = objects.find(function(row) { return String(row.STATUS) !== 'READY'; });
  if (blocked) throw new Error('Existem objetos postais com pendencias antes do preparo fiscal.');
  const defaults = payload.itemDefaults || {};
  if (!(Number(defaults.unitValue) >= 0.01)) throw new Error('Informe o valor unitario declarado, maior ou igual a R$ 0,01.');
  const preflight = productionDcePreflight_(objects, defaults);
  if (preflight.errors.length) {
    updateRow_('PRODUCTION_BATCHES', batch._rowNumber, { STATUS: 'DCE_REVIEW', UPDATED_AT: nowIso_() });
    throw new Error('Pre-flight fiscal encontrou pendencias: ' + preflight.errors.slice(0, 8).join(' ; '));
  }

  const started = startImport_(clientUserId, {
    fileName: productionDceImportName_(productionBatchId),
    fileType: 'CSV'
  });
  for (let index = 0; index < preflight.rows.length; index += started.chunkSize) {
    appendImport_(clientUserId, {
      importId: started.id,
      rows: preflight.rows.slice(index, index + started.chunkSize)
    });
  }
  const summary = finishImport_(clientUserId, { importId: started.id });
  if (summary.invalid) throw new Error('O preparo fiscal terminou com pendencias e nao foi liberado para autorizacao.');
  updateRow_('PRODUCTION_BATCHES', batch._rowNumber, {
    STATUS: 'DCE_PREPARED', UPDATED_AT: nowIso_()
  });
  recordOperationEvent_(userId, {
    campaignId: campaignId,
    type: 'DCE_PREPARED',
    quantity: summary.total,
    sourceType: 'PRODUCTION_BATCH',
    sourceId: productionBatchId,
    idempotencyKey: 'production-dce-prepared:' + productionBatchId,
    metadata: { clientUserId: clientUserId }
  });
  return { id: productionBatchId, status: 'DCE_PREPARED', total: summary.total, clientUserId: clientUserId, reused: false };
}

function productionDceStatusCounts_(rows) {
  const counts = { ready: 0, reserved: 0, authorized: 0, rejected: 0, error: 0, invalid: 0 };
  rows.forEach(function(row) {
    const status = String(row.STATUS || '').toUpperCase();
    if (status === 'READY') counts.ready += 1;
    else if (status === 'RESERVED') counts.reserved += 1;
    else if (status === 'AUTHORIZED') counts.authorized += 1;
    else if (status === 'REJECTED') counts.rejected += 1;
    else if (status === 'ERROR') counts.error += 1;
    else if (status === 'INVALID') counts.invalid += 1;
  });
  return counts;
}

function listProductionDceForClient_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['CAMPAIGN_USER', 'AGENCY_ADMIN']);
  return sheetRows_(getSheet_('PRODUCTION_BATCHES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.DOCUMENT_MODE) === 'DCE_AUTHORIZED';
  }).map(function(row) {
    const remittances = productionDceRemittances_(userId, row.ID);
    const counts = productionDceStatusCounts_(remittances);
    const fiscalBatchId = productionDceFiscalBatchId_(userId, remittances);
    return {
      id: String(row.ID),
      status: String(row.STATUS || ''),
      total: Number(row.TOTAL || 0),
      pac: Number(row.PAC || 0),
      sedex: Number(row.SEDEX || 0),
      createdAt: String(row.CREATED_AT || ''),
      fiscalBatchId: fiscalBatchId,
      counts: counts
    };
  }).reverse();
}

function reserveProductionDce_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['CAMPAIGN_USER', 'AGENCY_ADMIN']);
  const production = productionBatchRow_(campaignId, productionBatchId);
  if (!production) throw new Error('Lote de producao nao encontrado.');
  if (String(production.DOCUMENT_MODE) !== 'DCE_AUTHORIZED') throw new Error('Este lote nao utiliza DC-e com e-CNPJ.');
  if (['DCE_PREPARED', 'DCE_PARTIAL'].indexOf(String(production.STATUS)) === -1) {
    throw new Error('O lote ainda nao foi liberado pela agencia para autorizacao.');
  }
  const remittances = productionDceRemittances_(userId, productionBatchId);
  if (!remittances.length) throw new Error('O preparo fiscal deste lote nao pertence ao usuario atual.');
  const existingBatchId = productionDceFiscalBatchId_(userId, remittances);
  if (existingBatchId) {
    const stored = getBatch_(userId, { batchId: existingBatchId });
    if (String(stored.batch.ENVIRONMENT) !== (String(payload.environment) === '1' ? '1' : '2')) {
      throw new Error('O lote fiscal ja foi reservado em outro ambiente.');
    }
    return { productionBatchId: productionBatchId, fiscalBatch: stored.batch, documents: stored.documents, resumed: true };
  }
  const readyIds = remittances.filter(function(row) { return String(row.STATUS) === 'READY'; }).map(function(row) { return String(row.ID); });
  if (!readyIds.length) throw new Error('Nenhuma remessa pronta para reservar.');
  const prepared = prepareBatch_(userId, {
    remittanceIds: readyIds,
    environment: String(payload.environment) === '1' ? '1' : '2'
  });
  return {
    productionBatchId: productionBatchId,
    fiscalBatch: { ID: prepared.id, ENVIRONMENT: prepared.environment, STATUS: 'PREPARED', TOTAL: prepared.documents.length },
    documents: prepared.documents,
    resumed: false
  };
}

function appendClientOperationEvent_(userId, campaignId, productionBatchId, quantity) {
  const key = 'client-dce-authorized:' + String(productionBatchId);
  const existing = findRow_('OPERATION_EVENTS', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.IDEMPOTENCY_KEY) === key;
  });
  if (existing) return;
  const occurredAt = nowIso_();
  appendObjects_('OPERATION_EVENTS', [{
    ID: uuid_(), CAMPAIGN_ID: campaignId, USER_ID: userId,
    TYPE: 'DCE_AUTHORIZED', SOURCE_TYPE: 'PRODUCTION_BATCH', SOURCE_ID: productionBatchId,
    SERVICE: '', QUANTITY: Number(quantity || 0), IDEMPOTENCY_KEY: key,
    METADATA_JSON: { origin: 'CLIENT_PORTAL' }, OCCURRED_AT: occurredAt, CREATED_AT: occurredAt
  }]);
  refreshDailySummary_(campaignId, localDateFromIso_(occurredAt));
}

function saveProductionDceResults_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  const fiscalBatchId = String(payload.fiscalBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['CAMPAIGN_USER', 'AGENCY_ADMIN']);
  const production = productionBatchRow_(campaignId, productionBatchId);
  if (!production) throw new Error('Lote de producao nao encontrado.');
  const remittances = productionDceRemittances_(userId, productionBatchId);
  const expectedBatchId = productionDceFiscalBatchId_(userId, remittances);
  if (!expectedBatchId || expectedBatchId !== fiscalBatchId) throw new Error('Lote fiscal nao pertence a este lote de producao.');
  const result = saveBatchResults_(userId, {
    batchId: fiscalBatchId,
    results: Array.isArray(payload.results) ? payload.results : []
  });

  const remittanceById = {};
  remittances.forEach(function(row) { remittanceById[String(row.ID)] = row; });
  (Array.isArray(payload.results) ? payload.results : []).forEach(function(item) {
    const remittance = remittanceById[String(item.reference || '')];
    if (!remittance) return;
    const postal = findRow_('POSTAL_OBJECTS', function(row) {
      return String(row.ID) === String(remittance.REFERENCE)
        && String(row.CAMPAIGN_ID) === campaignId
        && String(row.PRODUCTION_BATCH_ID) === productionBatchId;
    });
    if (!postal) return;
    updateRow_('POSTAL_OBJECTS', postal._rowNumber, {
      ACCESS_KEY: String(item.accessKey || postal.ACCESS_KEY || ''),
      PROTOCOL: String(item.protocolNumber || postal.PROTOCOL || ''),
      UPDATED_AT: nowIso_()
    });
  });

  let productionStatus = 'DCE_PARTIAL';
  if (result.authorized === result.total && result.total > 0) {
    productionStatus = 'READY_FOR_UNIFIED_LABEL';
    appendClientOperationEvent_(userId, campaignId, productionBatchId, result.authorized);
  }
  updateRow_('PRODUCTION_BATCHES', production._rowNumber, {
    STATUS: productionStatus,
    UPDATED_AT: nowIso_()
  });
  return {
    productionBatchId: productionBatchId,
    fiscalBatchId: fiscalBatchId,
    status: productionStatus,
    total: result.total,
    authorized: result.authorized,
    rejected: result.rejected,
    errors: result.errors
  };
}
