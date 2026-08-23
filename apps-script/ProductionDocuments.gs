function productionDocumentsBatch_(campaignId, batchId) {
  return findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === String(batchId) && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function productionDocumentsVolume_(campaignId, batchId, volumeId) {
  return findRow_('DELIVERY_VOLUMES', function(row) {
    return String(row.ID) === String(volumeId)
      && String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PRODUCTION_BATCH_ID) === String(batchId);
  });
}

function productionDocumentsSender_(campaign, object) {
  const profile = safeJsonParse_(campaign.PROFILE_JSON, {});
  const postal = safeJsonParse_(object && object.POSTAL_JSON, {});
  const sender = profile.sender || profile.issuer || {};
  const address = sender.address || profile.address || {};
  return {
    document: digits_(sender.document || sender.cnpj || profile.cnpj || campaign.CNPJ || postal.REMETENTE_CNPJ || postal.CNPJ_REMETENTE),
    name: String(sender.name || profile.senderName || profile.name || campaign.NAME || campaign.CANDIDATE_NAME || postal.REMETENTE || postal.NOME_REMETENTE || '').trim(),
    address: {
      street: String(address.street || postal.ENDERECO_REMETENTE || postal.LOGRADOURO_REMETENTE || '').trim(),
      number: String(address.number || postal.NUMERO_REMETENTE || '').trim(),
      complement: String(address.complement || postal.COMPLEMENTO_REMETENTE || '').trim(),
      district: String(address.district || postal.BAIRRO_REMETENTE || '').trim(),
      city: String(address.city || postal.CIDADE_REMETENTE || '').trim(),
      uf: String(address.uf || postal.UF_REMETENTE || '').trim().toUpperCase(),
      zip: digits_(address.zip || postal.CEP_REMETENTE)
    }
  };
}

function productionDocumentsSenderIssues_(sender) {
  const issues = [];
  if (!sender.name) issues.push('Nome do remetente nao configurado na operacao.');
  if (!(isValidCpf_(sender.document) || isValidCnpj_(sender.document))) issues.push('CPF/CNPJ do remetente invalido ou ausente.');
  if (!sender.address.street || !sender.address.number || !sender.address.city || !sender.address.uf) issues.push('Endereco do remetente incompleto na operacao.');
  if (!/^\d{8}$/.test(sender.address.zip)) issues.push('CEP do remetente invalido ou ausente.');
  return issues;
}

function productionDocumentsDceMap_(batch) {
  const userId = String(batch.DCE_USER_ID || '');
  const fiscalBatchId = String(batch.DCE_BATCH_ID || '');
  if (!userId || !fiscalBatchId) return { byObject: {}, issuer: null, environment: '' };
  const fiscalBatch = findRow_('BATCHES', function(row) {
    return String(row.ID) === fiscalBatchId && String(row.USER_ID) === userId;
  });
  if (!fiscalBatch) throw new Error('Lote fiscal associado nao foi localizado.');
  const company = rowsForUser_('COMPANIES', userId).find(function(row) {
    return String(row.ID) === String(fiscalBatch.COMPANY_ID);
  });
  if (!company) throw new Error('Perfil fiscal emitente nao localizado.');
  const issuer = safeJsonParse_(company.PROFILE_JSON, {});
  const remittances = rowsForUser_('REMITTANCES', userId);
  const dceRows = rowsForUser_('DCE', userId).filter(function(row) {
    return String(row.BATCH_ID) === fiscalBatchId;
  });
  const byObject = {};
  dceRows.forEach(function(dce) {
    const remittance = remittances.find(function(row) { return String(row.ID) === String(dce.REMITTANCE_ID); });
    if (!remittance) return;
    const objectId = String(remittance.REFERENCE || '');
    if (!objectId) return;
    byObject[objectId] = {
      status: String(dce.STATUS || ''), series: Number(dce.SERIES || 0), number: Number(dce.NUMBER || 0),
      accessKey: String(dce.ACCESS_KEY || ''), protocol: String(dce.PROTOCOL || ''),
      authorizedAt: String(dce.AUTHORIZED_AT || ''), environment: String(fiscalBatch.ENVIRONMENT || '2'),
      issuer: issuer
    };
  });
  return { byObject: byObject, issuer: issuer, environment: String(fiscalBatch.ENVIRONMENT || '2') };
}

function productionDocumentsPublicObject_(object, batch, campaign, dceMap) {
  const recipient = safeJsonParse_(object.RECIPIENT_JSON, {});
  const postal = safeJsonParse_(object.POSTAL_JSON, {});
  const matrix = safeJsonParse_(object.MATRIX_JSON, {});
  const sender = productionDocumentsSender_(campaign, object);
  const dce = dceMap.byObject[String(object.ID)] || null;
  if (String(batch.DOCUMENT_MODE) === 'DCE_AUTHORIZED') {
    if (!dce || dce.status !== 'AUTHORIZED' || !/^\d{44}$/.test(dce.accessKey) || !dce.protocol) {
      throw new Error('O objeto ' + object.TRACKING_CODE + ' ainda nao possui DC-e autorizada completa.');
    }
  }
  return {
    id: String(object.ID), trackingCode: String(object.TRACKING_CODE || ''), service: String(object.SERVICE || ''),
    content: String(object.CONTENT || ''), reference: String(object.REFERENCE || ''), postal: postal,
    recipient: recipient, sender: sender, senderIssues: productionDocumentsSenderIssues_(sender),
    matrix: { status: String(object.MATRIX_STATUS || ''), stripe: String(matrix.stripe || matrix.tarja || ''), page: Number(matrix.page || 0), fileName: String(matrix.fileName || '') },
    dce: dce
  };
}

function productionDocumentsContext_(userId, payload, testOnly) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const batch = productionDocumentsBatch_(campaignId, batchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  if (String(batch.STATUS) !== 'READY_FOR_UNIFIED_LABEL') throw new Error('O lote ainda nao esta liberado para gerar a etiqueta final.');
  const gates = productionGates_(userId, { campaignId: campaignId, productionBatchId: batchId });
  if (!gates.matrixVerified) throw new Error('Confirme 100% dos Data Matrix antes de gerar etiquetas.');
  if (!testOnly && !gates.labelTestApproved) throw new Error('A etiqueta teste precisa ser aprovada antes de gerar os PDFs dos volumes.');
  const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
  if (!campaign) throw new Error('Operacao nao encontrada.');
  const allObjects = productionOpsObjects_(campaignId, batchId);
  const dceMap = productionDocumentsDceMap_(batch);
  let volume = null;
  let objects = [];
  if (testOnly) {
    const testTrackingCode = String(gates.testTrackingCode || '');
    const object = allObjects.find(function(row) { return String(row.TRACKING_CODE) === testTrackingCode; });
    if (!object) throw new Error('Objeto da etiqueta teste nao localizado.');
    objects = [object];
  } else {
    const volumeId = String(payload.volumeId || '');
    volume = productionDocumentsVolume_(campaignId, batchId, volumeId);
    if (!volume) throw new Error('Volume fisico nao encontrado.');
    const codes = safeJsonParse_(volume.TRACKING_CODES_JSON, []).map(String);
    const allowed = {};
    codes.forEach(function(code) { allowed[productionOpsTracking_(code)] = true; });
    objects = allObjects.filter(function(row) { return allowed[productionOpsTracking_(row.TRACKING_CODE)]; });
    if (objects.length !== Number(volume.QUANTITY || 0)) throw new Error('A quantidade de objetos do volume diverge do planejamento fisico.');
    if (objects.length > DCE_CONFIG.VOLUME_CAPACITY) throw new Error('Volume acima do limite de ' + DCE_CONFIG.VOLUME_CAPACITY + ' etiquetas.');
  }
  const publicObjects = objects.map(function(object) { return productionDocumentsPublicObject_(object, batch, campaign, dceMap); });
  const senderIssues = [];
  publicObjects.forEach(function(object) {
    object.senderIssues.forEach(function(issue) { if (senderIssues.indexOf(issue) === -1) senderIssues.push(issue); });
  });
  return {
    productionBatchId: batchId, portalReturnId: String(batch.PORTAL_RETURN_ID || ''),
    documentMode: String(batch.DOCUMENT_MODE || ''), status: String(batch.STATUS || ''),
    operation: { id: String(campaign.ID), name: String(campaign.NAME || ''), cnpj: String(campaign.CNPJ || ''), candidateName: String(campaign.CANDIDATE_NAME || '') },
    volume: volume ? { id: String(volume.ID), service: String(volume.SERVICE), number: Number(volume.VOLUME_NUMBER || 0), totalVolumes: Number(volume.TOTAL_VOLUMES || 0), quantity: Number(volume.QUANTITY || 0) } : null,
    gates: gates, senderIssues: senderIssues, objects: publicObjects
  };
}

function productionDocumentsTest_(userId, payload) {
  return productionDocumentsContext_(userId, payload, true);
}

function productionDocumentsVolumeData_(userId, payload) {
  return productionDocumentsContext_(userId, payload, false);
}
