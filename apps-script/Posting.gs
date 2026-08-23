function postingEventForList_(campaignId, batchId, list) {
  const key = 'posting-list:' + batchId + ':' + String(list.listId) + ':' + String(list.service) + ':' + String(list.serviceCode || '');
  return findRow_('OPERATION_EVENTS', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.IDEMPOTENCY_KEY) === key;
  });
}

function postingPublicList_(campaignId, batchId, list) {
  const event = postingEventForList_(campaignId, batchId, list);
  return {
    productionBatchId: String(batchId), listId: String(list.listId || ''), service: String(list.service || ''),
    serviceCode: String(list.serviceCode || ''), total: Number(list.total || 0), posted: Boolean(event),
    postedAt: event ? String(event.OCCURRED_AT || '') : '',
    postedBy: event ? String(event.USER_ID || '') : ''
  };
}

function listProductionPosting_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const onlyBatchId = String(payload.productionBatchId || '');
  const batches = sheetRows_(getSheet_('PRODUCTION_BATCHES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && (!onlyBatchId || String(row.ID) === onlyBatchId);
  });
  const rows = [];
  batches.forEach(function(batch) {
    if (!productionOpsLastEvent_(campaignId, batch.ID, 'LABEL_HANDOFF')) return;
    let protocol;
    try { protocol = productionProtocolData_(userId, { campaignId: campaignId, productionBatchId: batch.ID }); }
    catch (error) { return; }
    protocol.lists.forEach(function(list) { rows.push(postingPublicList_(campaignId, batch.ID, list)); });
  });
  rows.sort(function(a, b) {
    if (a.posted !== b.posted) return a.posted ? 1 : -1;
    return String(a.listId).localeCompare(String(b.listId));
  });
  return rows;
}

function confirmProductionPosting_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const batchId = String(payload.productionBatchId || '');
  const listId = String(payload.listId || '').trim();
  const service = String(payload.service || '').trim().toUpperCase();
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (!listId) throw new Error('Informe a lista postal confirmada como postada.');
  const protocol = productionProtocolData_(userId, { campaignId: campaignId, productionBatchId: batchId });
  if (!protocol.ready) throw new Error('Os dados do protocolo ainda possuem pendencias.');
  const matches = protocol.lists.filter(function(list) {
    return String(list.listId) === listId && (!service || String(list.service) === service);
  });
  if (matches.length !== 1) throw new Error(matches.length ? 'A lista informada e ambigua. Informe tambem o servico.' : 'Lista postal nao pertence a este lote.');
  const list = matches[0];
  const key = 'posting-list:' + batchId + ':' + listId + ':' + String(list.service) + ':' + String(list.serviceCode || '');
  const existing = postingEventForList_(campaignId, batchId, list);
  if (existing) return { duplicate: true, list: postingPublicList_(campaignId, batchId, list) };
  const occurredAt = String(payload.postedAt || nowIso_());
  recordOperationEvent_(userId, {
    campaignId: campaignId, type: 'POSTING_COMPLETED', service: String(list.service), quantity: Number(list.total || 0),
    sourceType: 'POSTAL_LIST', sourceId: listId, idempotencyKey: key, occurredAt: occurredAt,
    metadata: { productionBatchId: batchId, listId: listId, serviceCode: String(list.serviceCode || ''), receiptReference: String(payload.receiptReference || '').slice(0, 160) }
  });
  const tracking = {};
  list.objects.forEach(function(item) { tracking[productionOpsTracking_(item.trackingCode)] = true; });
  productionOpsObjects_(campaignId, batchId).forEach(function(object) {
    if (tracking[productionOpsTracking_(object.TRACKING_CODE)]) updateRow_('POSTAL_OBJECTS', object._rowNumber, { STATUS: 'POSTED', UPDATED_AT: nowIso_() });
  });
  return { duplicate: false, list: postingPublicList_(campaignId, batchId, list) };
}
