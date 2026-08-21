function deliveryVolumesForBatch_(campaignId, productionBatchId) {
  return sheetRows_(getSheet_('DELIVERY_VOLUMES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PRODUCTION_BATCH_ID) === String(productionBatchId);
  });
}

function printedLabelsForBatchService_(campaignId, productionBatchId, service) {
  return sheetRows_(getSheet_('OPERATION_EVENTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.SOURCE_ID) === String(productionBatchId)
      && String(row.TYPE) === 'LABEL_PRINTED'
      && String(row.SERVICE) === String(service);
  }).reduce(function(sum, row) { return sum + Number(row.QUANTITY || 0); }, 0);
}

function handoffDeliveryVolumes_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (!productionBatchId) throw new Error('Lote de producao nao informado.');

  const batch = findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === productionBatchId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!batch) throw new Error('Lote de producao nao encontrado.');

  const volumes = deliveryVolumesForBatch_(campaignId, productionBatchId);
  if (!volumes.length) throw new Error('Nenhum volume fisico encontrado para este lote.');
  const requestedIds = Array.isArray(payload.volumeIds) ? payload.volumeIds.map(String) : [];
  const expectedIds = volumes.map(function(row) { return String(row.ID); });
  const selected = requestedIds.length ? volumes.filter(function(row) { return requestedIds.indexOf(String(row.ID)) !== -1; }) : volumes;
  if (selected.length !== volumes.length || selected.length !== expectedIds.length) {
    throw new Error('A entrega deve contemplar todos os volumes fisicos deste lote.');
  }

  const receiver = String(payload.receivedBy || '').trim();
  if (receiver.length < 2) throw new Error('Informe quem recebeu os volumes.');
  const note = String(payload.note || '').trim().slice(0, 800);
  const occurredAt = String(payload.occurredAt || nowIso_());
  localDateFromIso_(occurredAt);

  const totals = { PAC: 0, SEDEX: 0 };
  selected.forEach(function(row) {
    const service = String(row.SERVICE || '').toUpperCase();
    const quantity = Number(row.QUANTITY || 0);
    const trackingCodes = safeJsonParse_(row.TRACKING_CODES_JSON, []);
    if (['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Volume com servico invalido.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > DCE_CONFIG.VOLUME_CAPACITY) throw new Error('Volume com quantidade invalida.');
    if (!Array.isArray(trackingCodes) || trackingCodes.length !== quantity) throw new Error('Volume com relacao de SRO divergente.');
    totals[service] += quantity;
  });

  ['SEDEX', 'PAC'].forEach(function(service) {
    if (!totals[service]) return;
    const printed = printedLabelsForBatchService_(campaignId, productionBatchId, service);
    if (printed < totals[service]) {
      throw new Error('A entrega a operacao esta bloqueada: a impressao fisica de ' + service + ' ainda nao foi registrada integralmente.');
    }
  });

  const now = nowIso_();
  selected.forEach(function(row) {
    updateRow_('DELIVERY_VOLUMES', row._rowNumber, {
      STATUS: 'HANDED_OFF',
      DELIVERED_AT: occurredAt,
      RECEIVED_BY: receiver.slice(0, 160),
      UPDATED_AT: now
    });
  });

  ['SEDEX', 'PAC'].forEach(function(service) {
    if (!totals[service]) return;
    recordOperationEvent_(userId, {
      campaignId: campaignId,
      type: 'LABEL_HANDOFF',
      service: service,
      quantity: totals[service],
      sourceType: 'PRODUCTION_BATCH',
      sourceId: productionBatchId,
      idempotencyKey: 'labels-handoff:' + productionBatchId + ':' + service,
      occurredAt: occurredAt,
      metadata: {
        productionBatchId: productionBatchId,
        receivedBy: receiver.slice(0, 160),
        volumeIds: selected.filter(function(row) { return String(row.SERVICE) === service; }).map(function(row) { return String(row.ID); }),
        volumeCount: selected.filter(function(row) { return String(row.SERVICE) === service; }).length,
        note: note
      }
    });
  });

  return {
    productionBatchId: productionBatchId,
    status: 'HANDED_OFF',
    receivedBy: receiver.slice(0, 160),
    deliveredAt: occurredAt,
    totalVolumes: selected.length,
    totalLabels: totals.PAC + totals.SEDEX,
    pac: totals.PAC,
    sedex: totals.SEDEX
  };
}
