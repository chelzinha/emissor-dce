function productionOpsBatch_(campaignId, batchId) {
  return findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === String(batchId) && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function productionOpsObjects_(campaignId, batchId) {
  return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.PRODUCTION_BATCH_ID) === String(batchId);
  });
}

function productionOpsEvents_(campaignId, batchId, type) {
  return sheetRows_(getSheet_('OPERATION_EVENTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.SOURCE_TYPE) === 'PRODUCTION_BATCH'
      && String(row.SOURCE_ID) === String(batchId)
      && (!type || String(row.TYPE) === String(type));
  });
}

function productionOpsEventSum_(campaignId, batchId, type) {
  return productionOpsEvents_(campaignId, batchId, type).reduce(function(sum, row) {
    return sum + Number(row.QUANTITY || 0);
  }, 0);
}

function productionOpsLastEvent_(campaignId, batchId, type) {
  const rows = productionOpsEvents_(campaignId, batchId, type);
  rows.sort(function(a, b) { return String(b.OCCURRED_AT || '').localeCompare(String(a.OCCURRED_AT || '')); });
  return rows[0] || null;
}

function productionOpsTracking_(value) {
  return String(value || '').replace(/\s/g, '').toUpperCase();
}

function productionOpsRequireBatch_(campaignId, batchId, userId) {
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const batch = productionOpsBatch_(campaignId, batchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  const objects = productionOpsObjects_(campaignId, batchId);
  if (!objects.length) throw new Error('Nenhum objeto associado ao lote de producao.');
  if (objects.length !== Number(batch.TOTAL || 0)) throw new Error('Quantidade de objetos do lote diverge do total registrado.');
  return { batch: batch, objects: objects };
}

function productionOpsRequireLabelsReady_(batch) {
  if (String(batch.STATUS) !== 'READY_FOR_UNIFIED_LABEL') {
    throw new Error('O lote ainda nao esta liberado para gerar a etiqueta final.');
  }
}

function productionOpsMatrixHash_(trackingCodes) {
  const sorted = trackingCodes.map(productionOpsTracking_).filter(Boolean).sort();
  return sha256Hex_(sorted.join('|'));
}

function productionOpsObjectTrackingCodes_(objects) {
  return objects.map(function(row) { return productionOpsTracking_(row.TRACKING_CODE); }).filter(Boolean).sort();
}

function confirmProductionMatrix_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const context = productionOpsRequireBatch_(campaignId, batchId, userId);
  productionOpsRequireLabelsReady_(context.batch);

  const blocked = context.objects.filter(function(row) {
    const errors = safeJsonParse_(row.ERRORS_JSON, []);
    return errors.length || ['MISSING', 'DIVERGENT'].indexOf(String(row.MATRIX_STATUS || '')) !== -1;
  });
  if (blocked.length) throw new Error('O lote possui objetos sem Data Matrix valido.');

  const expected = productionOpsObjectTrackingCodes_(context.objects);
  const verified = (Array.isArray(payload.verifiedTrackingCodes) ? payload.verifiedTrackingCodes : [])
    .map(productionOpsTracking_).filter(Boolean).sort();
  const uniqueVerified = verified.filter(function(value, index, array) { return index === 0 || value !== array[index - 1]; });
  if (uniqueVerified.length !== expected.length) {
    throw new Error('A verificacao do Data Matrix precisa cobrir 100% dos objetos do lote.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== uniqueVerified[index]) throw new Error('Os SROs verificados nao correspondem exatamente ao lote de producao.');
  }

  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'MATRIX_100_VERIFIED', quantity: expected.length,
    sourceType: 'PRODUCTION_BATCH', sourceId: batchId,
    idempotencyKey: 'matrix-100:' + batchId,
    metadata: { trackingHash: productionOpsMatrixHash_(expected), verifiedBy: 'ZXING_LOCAL' }
  });
  return productionGates_(userId, { campaignId: campaignId, productionBatchId: batchId });
}

function productionLabelTestObject_(objects) {
  const ordered = objects.slice().sort(function(a, b) {
    return productionOpsTracking_(a.TRACKING_CODE).localeCompare(productionOpsTracking_(b.TRACKING_CODE));
  });
  return ordered[0] || null;
}

function productionLabelTestData_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const context = productionOpsRequireBatch_(campaignId, batchId, userId);
  productionOpsRequireLabelsReady_(context.batch);
  if (!productionOpsLastEvent_(campaignId, batchId, 'MATRIX_100_VERIFIED')) {
    throw new Error('Confirme a leitura de 100% dos Data Matrix antes da etiqueta teste.');
  }
  const row = productionLabelTestObject_(context.objects);
  return {
    productionBatchId: batchId,
    trackingCode: String(row.TRACKING_CODE || ''),
    service: String(row.SERVICE || ''),
    documentMode: String(context.batch.DOCUMENT_MODE || ''),
    matrixStatus: String(row.MATRIX_STATUS || ''),
    accessKey: String(row.ACCESS_KEY || ''),
    protocol: String(row.PROTOCOL || '')
  };
}

function approveProductionLabelTest_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const test = productionLabelTestData_(userId, payload);
  const readTracking = productionOpsTracking_(payload.readTrackingCode);
  if (!readTracking) throw new Error('Informe o SRO lido fisicamente na etiqueta teste.');
  if (readTracking !== productionOpsTracking_(test.trackingCode)) {
    throw new Error('O SRO lido fisicamente nao corresponde ao SRO esperado da etiqueta teste.');
  }
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'LABEL_TEST_APPROVED', quantity: 1,
    sourceType: 'PRODUCTION_BATCH', sourceId: batchId,
    idempotencyKey: 'label-test:' + batchId,
    metadata: { expectedTrackingCode: test.trackingCode, readTrackingCode: readTracking }
  });
  return productionGates_(userId, { campaignId: campaignId, productionBatchId: batchId });
}

function confirmProductionPrint_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const context = productionOpsRequireBatch_(campaignId, batchId, userId);
  productionOpsRequireLabelsReady_(context.batch);
  if (!productionOpsLastEvent_(campaignId, batchId, 'LABEL_TEST_APPROVED')) {
    throw new Error('A etiqueta teste precisa ser aprovada antes de registrar a impressao do lote.');
  }
  const alreadyPrinted = productionOpsEventSum_(campaignId, batchId, 'LABEL_PRINTED');
  const remaining = Math.max(0, Number(context.batch.TOTAL || 0) - alreadyPrinted);
  const quantity = Number(payload.quantity || 0);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Informe uma quantidade inteira maior que zero.');
  if (quantity > remaining) throw new Error('A quantidade informada excede o saldo de etiquetas ainda nao confirmadas como impressas.');
  const confirmationId = String(payload.confirmationId || '').trim();
  if (!confirmationId) throw new Error('Confirmacao de impressao sem identificador de idempotencia.');
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'LABEL_PRINTED', quantity: quantity,
    sourceType: 'PRODUCTION_BATCH', sourceId: batchId,
    idempotencyKey: 'production-print:' + batchId + ':' + confirmationId.slice(0, 100),
    metadata: { partial: quantity < remaining }
  });
  return productionGates_(userId, { campaignId: campaignId, productionBatchId: batchId });
}

function confirmProductionHandoff_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const context = productionOpsRequireBatch_(campaignId, batchId, userId);
  productionOpsRequireLabelsReady_(context.batch);
  if (!productionOpsLastEvent_(campaignId, batchId, 'LABEL_TEST_APPROVED')) {
    throw new Error('A etiqueta teste precisa estar aprovada antes da entrega interna.');
  }
  const total = Number(context.batch.TOTAL || 0);
  const printed = productionOpsEventSum_(campaignId, batchId, 'LABEL_PRINTED');
  if (printed < total) throw new Error('A entrega interna so pode ser confirmada depois da impressao integral do lote.');
  const receivedBy = String(payload.receivedBy || '').trim();
  if (!receivedBy) throw new Error('Informe quem recebeu os volumes de etiquetas.');
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'LABEL_HANDOFF', quantity: total,
    sourceType: 'PRODUCTION_BATCH', sourceId: batchId,
    idempotencyKey: 'production-handoff:' + batchId,
    metadata: { receivedBy: receivedBy.slice(0, 160), deliveredBy: String(payload.deliveredBy || '').slice(0, 160) }
  });
  sheetRows_(getSheet_('DELIVERY_VOLUMES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.PRODUCTION_BATCH_ID) === batchId;
  }).forEach(function(row) {
    updateRow_('DELIVERY_VOLUMES', row._rowNumber, { STATUS: 'DELIVERED', DELIVERED_AT: nowIso_(), RECEIVED_BY: receivedBy.slice(0, 160) });
  });
  return productionGates_(userId, { campaignId: campaignId, productionBatchId: batchId });
}

function productionPostalListId_(postal) {
  const row = postal || {};
  return String(row.LISTA || row.NUMERO_LISTA || row.LISTA_POSTAGEM || row.NUMERO_DA_LISTA || row.CODIGO_LISTA || row.PLP || row.CODIGO_PLP || '').trim();
}

function productionPostalServiceCode_(postal) {
  const row = postal || {};
  return String(row.CODIGO_SERVICO || row.COD_SERVICO || row.SERVICO_CODIGO || row.CODIGO || '').trim();
}

function productionProtocolData_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const context = productionOpsRequireBatch_(campaignId, batchId, userId);
  if (!productionOpsLastEvent_(campaignId, batchId, 'LABEL_HANDOFF')) {
    throw new Error('Confirme primeiro a entrega interna dos volumes de etiquetas.');
  }
  const campaign = getCampaign_(userId, { campaignId: campaignId });
  const errors = [];
  const grouped = {};
  context.objects.forEach(function(object, index) {
    const postal = safeJsonParse_(object.POSTAL_JSON, {});
    const recipient = safeJsonParse_(object.RECIPIENT_JSON, {});
    const address = recipient.address || {};
    const trackingCode = productionOpsTracking_(object.TRACKING_CODE);
    const zip = digits_(address.zip || postal.CEP);
    const name = String(recipient.name || postal.DESTINATARIO || postal.NOME || '').trim();
    const service = String(object.SERVICE || '').toUpperCase();
    const listId = productionPostalListId_(postal);
    const serviceCode = productionPostalServiceCode_(postal);
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) errors.push('Objeto ' + (index + 1) + ': SRO invalido.');
    if (!/^\d{8}$/.test(zip)) errors.push(trackingCode + ': CEP invalido para o protocolo.');
    if (!name) errors.push(trackingCode + ': destinatario sem nome.');
    if (['PAC', 'SEDEX'].indexOf(service) === -1) errors.push(trackingCode + ': servico invalido.');
    if (!listId) errors.push(trackingCode + ': numero da lista postal ausente no retorno do Portal.');
    const key = (listId || 'SEM_LISTA') + '|' + service + '|' + serviceCode;
    if (!grouped[key]) grouped[key] = { listId: listId, service: service, serviceCode: serviceCode, objects: [] };
    grouped[key].objects.push({ trackingCode: trackingCode, zip: zip, recipientName: name });
  });
  const lists = Object.keys(grouped).map(function(key) {
    const group = grouped[key];
    return {
      listId: group.listId, service: group.service, serviceCode: group.serviceCode,
      total: group.objects.length, objects: group.objects
    };
  }).sort(function(a, b) {
    return String(a.listId).localeCompare(String(b.listId)) || String(a.service).localeCompare(String(b.service));
  });
  return {
    ready: errors.length === 0,
    productionBatchId: batchId,
    operation: { id: campaign.id, name: campaign.name, cnpj: campaign.cnpj, candidateName: campaign.candidateName, office: campaign.office },
    total: context.objects.length,
    lists: lists,
    errors: errors
  };
}

function productionGates_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const context = productionOpsRequireBatch_(campaignId, batchId, userId);
  const matrixEvent = productionOpsLastEvent_(campaignId, batchId, 'MATRIX_100_VERIFIED');
  const testEvent = productionOpsLastEvent_(campaignId, batchId, 'LABEL_TEST_APPROVED');
  const handoffEvent = productionOpsLastEvent_(campaignId, batchId, 'LABEL_HANDOFF');
  const printed = Math.min(Number(context.batch.TOTAL || 0), productionOpsEventSum_(campaignId, batchId, 'LABEL_PRINTED'));
  const testObject = productionLabelTestObject_(context.objects);
  return {
    productionBatchId: batchId,
    documentMode: String(context.batch.DOCUMENT_MODE || ''),
    status: String(context.batch.STATUS || ''),
    total: Number(context.batch.TOTAL || 0),
    matrixVerified: Boolean(matrixEvent),
    labelTestApproved: Boolean(testEvent),
    testTrackingCode: testObject ? String(testObject.TRACKING_CODE || '') : '',
    printed: printed,
    printRemaining: Math.max(0, Number(context.batch.TOTAL || 0) - printed),
    printComplete: printed >= Number(context.batch.TOTAL || 0),
    handedOff: Boolean(handoffEvent),
    receivedBy: handoffEvent ? String(safeJsonParse_(handoffEvent.METADATA_JSON, {}).receivedBy || '') : ''
  };
}
