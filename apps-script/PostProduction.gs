function postProductionBatch_(campaignId, productionBatchId) {
  return findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === String(productionBatchId) && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function postProductionObjects_(campaignId, productionBatchId) {
  return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PRODUCTION_BATCH_ID) === String(productionBatchId);
  });
}

function postProductionVolumes_(campaignId, productionBatchId) {
  return sheetRows_(getSheet_('DELIVERY_VOLUMES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PRODUCTION_BATCH_ID) === String(productionBatchId);
  });
}

function postProductionEvents_(campaignId, productionBatchId) {
  return sheetRows_(getSheet_('OPERATION_EVENTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.SOURCE_TYPE) === 'PRODUCTION_BATCH'
      && String(row.SOURCE_ID) === String(productionBatchId);
  });
}

function postProductionServices_(objects) {
  const found = {};
  objects.forEach(function(row) {
    const service = String(row.SERVICE || '').toUpperCase();
    if (service === 'PAC' || service === 'SEDEX') found[service] = true;
  });
  return ['SEDEX', 'PAC'].filter(function(service) { return found[service]; });
}

function labelTestApprovalServices_(campaignId, productionBatchId) {
  const approved = {};
  postProductionEvents_(campaignId, productionBatchId).forEach(function(row) {
    if (String(row.TYPE) !== 'LABEL_TEST_APPROVED') return;
    const metadata = safeJsonParse_(row.METADATA_JSON, {});
    const service = String(row.SERVICE || metadata.service || '').toUpperCase();
    if (service === 'PAC' || service === 'SEDEX') approved[service] = true;
  });
  return approved;
}

function printedServices_(campaignId, productionBatchId) {
  const printed = {};
  postProductionEvents_(campaignId, productionBatchId).forEach(function(row) {
    if (String(row.TYPE) !== 'LABEL_PRINTED') return;
    const service = String(row.SERVICE || '').toUpperCase();
    if (service === 'PAC' || service === 'SEDEX') printed[service] = Number(row.QUANTITY || 0);
  });
  return printed;
}

function requiredServiceQuantity_(batch, service) {
  return service === 'PAC' ? Number(batch.PAC || 0) : Number(batch.SEDEX || 0);
}

function approveProductionLabelTest_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  const service = String(payload.service || '').toUpperCase();
  const expectedTrackingCode = String(payload.expectedTrackingCode || '').replace(/\s/g, '').toUpperCase();
  const scannedTrackingCode = String(payload.scannedTrackingCode || '').replace(/\s/g, '').toUpperCase();
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico invalido.');
  if (!/^[A-Z]{2}\d{9}BR$/.test(expectedTrackingCode)) throw new Error('SRO da amostra invalido.');
  if (scannedTrackingCode !== expectedTrackingCode) throw new Error('A leitura fisica nao corresponde a etiqueta de teste esperada.');
  const batch = postProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  const objects = postProductionObjects_(campaignId, productionBatchId);
  const belongs = objects.some(function(row) {
    return String(row.SERVICE) === service && String(row.TRACKING_CODE) === expectedTrackingCode;
  });
  if (!belongs) throw new Error('A etiqueta de teste nao pertence a este lote/servico.');
  recordOperationEvent_(userId, {
    campaignId: campaignId,
    type: 'LABEL_TEST_APPROVED',
    quantity: 1,
    service: service,
    sourceType: 'PRODUCTION_BATCH',
    sourceId: productionBatchId,
    idempotencyKey: 'label-test-approved:' + productionBatchId + ':' + service,
    metadata: { trackingCode: expectedTrackingCode, scannedTrackingCode: scannedTrackingCode, scanValidated: true }
  });
  const required = postProductionServices_(objects);
  const approved = labelTestApprovalServices_(campaignId, productionBatchId);
  if (required.every(function(item) { return approved[item]; })) {
    updateRow_('PRODUCTION_BATCHES', batch._rowNumber, { STATUS: 'READY_FOR_PRINT', UPDATED_AT: nowIso_() });
  }
  return { productionBatchId: productionBatchId, service: service, approved: true };
}

function confirmProductionPrint_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  const service = String(payload.service || '').toUpperCase();
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico invalido.');
  const batch = postProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  const expected = requiredServiceQuantity_(batch, service);
  if (!expected) throw new Error('O lote nao possui objetos deste servico.');
  const quantity = Number(payload.quantity || 0);
  if (quantity !== expected) throw new Error('A confirmacao deve corresponder a impressao integral do servico: ' + expected + ' etiquetas.');
  const approved = labelTestApprovalServices_(campaignId, productionBatchId);
  if (!approved[service]) throw new Error('A etiqueta de teste deste servico ainda nao foi aprovada fisicamente.');
  const event = recordOperationEvent_(userId, {
    campaignId: campaignId,
    type: 'LABEL_PRINTED',
    quantity: quantity,
    service: service,
    sourceType: 'PRODUCTION_BATCH',
    sourceId: productionBatchId,
    idempotencyKey: 'label-printed:' + productionBatchId + ':' + service,
    metadata: { confirmedPhysicalPrint: true }
  });
  const now = nowIso_();
  postProductionVolumes_(campaignId, productionBatchId).forEach(function(volume) {
    if (String(volume.SERVICE) !== service) return;
    updateRow_('DELIVERY_VOLUMES', volume._rowNumber, {
      STATUS: 'PRINTED', PRINTED_AT: now, PRINTED_BY: userId, UPDATED_AT: now
    });
  });
  const objects = postProductionObjects_(campaignId, productionBatchId);
  const required = postProductionServices_(objects);
  const printed = printedServices_(campaignId, productionBatchId);
  const allPrinted = required.every(function(item) { return Number(printed[item] || 0) === requiredServiceQuantity_(batch, item); });
  updateRow_('PRODUCTION_BATCHES', batch._rowNumber, {
    STATUS: allPrinted ? 'PRINTED' : 'PRINTING', UPDATED_AT: now
  });
  return { event: publicOperationEvent_(event), status: allPrinted ? 'PRINTED' : 'PRINTING' };
}

function confirmProductionHandoff_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  const receiver = String(payload.receiver || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const note = String(payload.note || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (!receiver) throw new Error('Informe quem recebeu os volumes.');
  const batch = postProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  const objects = postProductionObjects_(campaignId, productionBatchId);
  if (objects.length !== Number(batch.TOTAL || 0)) throw new Error('Quantidade de objetos do lote esta divergente.');
  const required = postProductionServices_(objects);
  const approved = labelTestApprovalServices_(campaignId, productionBatchId);
  if (!required.every(function(service) { return approved[service]; })) throw new Error('Existem etiquetas de teste pendentes.');
  const printed = printedServices_(campaignId, productionBatchId);
  if (!required.every(function(service) { return Number(printed[service] || 0) === requiredServiceQuantity_(batch, service); })) {
    throw new Error('A impressao integral do lote ainda nao foi confirmada.');
  }
  const volumes = postProductionVolumes_(campaignId, productionBatchId);
  const volumeTotal = volumes.reduce(function(total, row) { return total + Number(row.QUANTITY || 0); }, 0);
  if (!volumes.length || volumeTotal !== objects.length) throw new Error('Plano de volumes inconsistente com o lote.');
  const seen = {};
  volumes.forEach(function(volume) {
    const codes = safeJsonParse_(volume.TRACKING_CODES_JSON, []);
    if (codes.length !== Number(volume.QUANTITY || 0) || codes.length > DCE_CONFIG.VOLUME_CAPACITY) throw new Error('Volume com quantidade invalida.');
    codes.forEach(function(code) {
      const sro = String(code || '').replace(/\s/g, '').toUpperCase();
      if (seen[sro]) throw new Error('SRO duplicado entre volumes: ' + sro);
      seen[sro] = true;
    });
    if (String(volume.STATUS) !== 'PRINTED' && String(volume.STATUS) !== 'HANDED_OFF') throw new Error('Ha volume sem confirmacao de impressao.');
  });
  const now = String(payload.occurredAt || nowIso_());
  localDateFromIso_(now);
  volumes.forEach(function(volume) {
    updateRow_('DELIVERY_VOLUMES', volume._rowNumber, {
      STATUS: 'HANDED_OFF', DELIVERED_AT: now, RECEIVED_BY: receiver, UPDATED_AT: nowIso_()
    });
  });
  const event = recordOperationEvent_(userId, {
    campaignId: campaignId,
    type: 'LABEL_HANDOFF',
    quantity: objects.length,
    sourceType: 'PRODUCTION_BATCH',
    sourceId: productionBatchId,
    idempotencyKey: 'label-handoff:' + productionBatchId,
    occurredAt: now,
    metadata: { receiver: receiver, volumeCount: volumes.length, services: required, note: note }
  });
  updateRow_('PRODUCTION_BATCHES', batch._rowNumber, { STATUS: 'HANDED_OFF', UPDATED_AT: nowIso_() });
  return { event: publicOperationEvent_(event), status: 'HANDED_OFF', receiver: receiver, volumes: volumes.length };
}

function protocolValue_(raw, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const value = raw[aliases[index]];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizePostalKeys_(source) {
  const normalized = {};
  Object.keys(source || {}).forEach(function(key) {
    const clean = String(key).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    normalized[clean] = source[key];
  });
  return normalized;
}

function postingProtocolData_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId);
  const batch = postProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  const objects = postProductionObjects_(campaignId, productionBatchId);
  const errors = [];
  const rows = objects.map(function(row, index) {
    const postal = normalizePostalKeys_(safeJsonParse_(row.POSTAL_JSON, {}));
    const recipient = safeJsonParse_(row.RECIPIENT_JSON, {});
    const service = String(row.SERVICE || '').toUpperCase();
    const listNumber = protocolValue_(postal, ['LISTA', 'NUMERO_LISTA', 'N_LISTA', 'LISTA_POSTAGEM', 'NUM_LISTA', 'ID_LISTA']);
    let serviceCode = digits_(protocolValue_(postal, ['CODIGO_SERVICO', 'COD_SERVICO', 'SERVICO_CODIGO', 'CODSERVICO']));
    if (!serviceCode && service === 'PAC') serviceCode = '4510';
    if (!serviceCode && service === 'SEDEX') serviceCode = '4014';
    const postingDate = protocolValue_(postal, ['DATA_POSTAGEM', 'DATA', 'DT_POSTAGEM']);
    const postingTime = protocolValue_(postal, ['HORA_POSTAGEM', 'HORA', 'HR_POSTAGEM']);
    const trackingCode = String(row.TRACKING_CODE || '').replace(/\s/g, '').toUpperCase();
    const zip = digits_(recipient.address && recipient.address.zip || postal.CEP || postal.CEP_DESTINATARIO || '');
    const recipientName = String(recipient.name || postal.DESTINATARIO || postal.NOME_DESTINATARIO || postal.NOME || '').trim();
    if (!/^[A-Z]{2}\d{9}BR$/.test(trackingCode)) errors.push('Linha ' + (index + 1) + ': SRO invalido.');
    if (!listNumber) errors.push('Linha ' + (index + 1) + ': numero real da lista ausente.');
    if (!/^\d{8}$/.test(zip)) errors.push('Linha ' + (index + 1) + ': CEP invalido.');
    if (!recipientName) errors.push('Linha ' + (index + 1) + ': destinatario ausente.');
    if (!postingDate || !postingTime) errors.push('Linha ' + (index + 1) + ': data/hora de postagem ausente.');
    return {
      trackingCode: trackingCode, service: service, listNumber: listNumber, serviceCode: serviceCode,
      postingDate: postingDate, postingTime: postingTime, zip: zip, recipient: recipientName
    };
  });
  if (errors.length) throw new Error(errors.slice(0, 8).join(' ') + (errors.length > 8 ? ' Outras pendencias: ' + (errors.length - 8) + '.' : ''));
  const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
  return {
    campaignId: campaignId,
    productionBatchId: productionBatchId,
    senderName: String(campaign && (campaign.CANDIDATE_NAME || campaign.NAME) || ''),
    cnpj: String(campaign && campaign.CNPJ || ''),
    total: rows.length,
    rows: rows
  };
}

function postProductionSnapshot_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId);
  const batch = postProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  const objects = postProductionObjects_(campaignId, productionBatchId);
  const volumes = postProductionVolumes_(campaignId, productionBatchId);
  const approvals = labelTestApprovalServices_(campaignId, productionBatchId);
  const printed = printedServices_(campaignId, productionBatchId);
  return {
    batch: publicRecord_(batch),
    total: objects.length,
    services: postProductionServices_(objects),
    approvedLabelTests: approvals,
    printed: printed,
    volumes: volumes.map(function(row) {
      return {
        id: String(row.ID), service: String(row.SERVICE), number: Number(row.VOLUME_NUMBER || 0),
        totalVolumes: Number(row.TOTAL_VOLUMES || 0), quantity: Number(row.QUANTITY || 0),
        status: String(row.STATUS || ''), printedAt: String(row.PRINTED_AT || ''),
        deliveredAt: String(row.DELIVERED_AT || ''), receivedBy: String(row.RECEIVED_BY || '')
      };
    })
  };
}
