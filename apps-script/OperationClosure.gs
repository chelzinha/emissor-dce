function operationClosureDecision_(stats) {
  const input = stats || {};
  const blockers = [];
  function add(code, label, quantity) {
    const value = Number(quantity || 0);
    if (value > 0) blockers.push({ code: code, label: label, quantity: value });
  }

  const totalObjects = Number(input.totalObjects || 0);
  const returned = Number(input.returned || 0);
  if (totalObjects < 1) blockers.push({ code: 'NO_POSTAL_OBJECTS', label: 'Nenhum objeto postal concluido na operacao', quantity: 0 });
  add('PORTAL_RETURN_PENDING', 'Retornos do Portal ainda em envio ou revisao', input.portalReturnPending);
  add('NOT_ASSIGNED_TO_PRODUCTION', 'Objetos ainda nao vinculados a um lote de producao', input.unassignedObjects);
  add('LABEL_GENERATION_PENDING', 'Etiquetas finais ainda nao geradas', input.generationPending);
  add('PRINT_PENDING', 'Etiquetas ainda sem confirmacao de impressao', input.printPending);
  add('HANDOFF_PENDING', 'Objetos ainda sem entrega interna confirmada', input.handoffPending);
  add('POSTING_PENDING', 'Objetos ainda sem baixa de postagem', input.notPosted);
  add('TRACKING_PENDING', 'Objetos postados ainda sem estado postal terminal', input.unresolvedTracking);

  const ready = totalObjects > 0 && blockers.length === 0;
  return {
    ready: ready,
    status: ready ? (returned > 0 ? 'READY_WITH_RETURNS' : 'READY') : 'NOT_READY',
    blockers: blockers
  };
}

function operationClosureCampaignRows_(sheetName, campaignId) {
  return sheetRows_(getSheet_(sheetName)).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function operationClosureEvents_(campaignId) {
  return operationClosureCampaignRows_('OPERATION_EVENTS', campaignId);
}

function operationClosureEventSum_(events, batchId, type) {
  return events.filter(function(row) {
    return String(row.SOURCE_TYPE) === 'PRODUCTION_BATCH'
      && String(row.SOURCE_ID) === String(batchId)
      && String(row.TYPE) === String(type);
  }).reduce(function(sum, row) { return sum + Number(row.QUANTITY || 0); }, 0);
}

function operationClosureStatus_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
  if (!campaign) throw new Error('Operacao nao encontrada.');

  const objects = operationClosureCampaignRows_('POSTAL_OBJECTS', campaignId);
  const batches = operationClosureCampaignRows_('PRODUCTION_BATCHES', campaignId);
  const portalReturns = operationClosureCampaignRows_('PORTAL_RETURNS', campaignId);
  const events = operationClosureEvents_(campaignId);
  const tracking = trackingSummary_(userId, { campaignId: campaignId });
  const bucket = tracking.total || {};

  let generationPending = 0;
  let printPending = 0;
  let handoffPending = 0;
  batches.forEach(function(batch) {
    const total = Number(batch.TOTAL || 0);
    const generated = Math.min(total, operationClosureEventSum_(events, batch.ID, 'LABEL_GENERATED'));
    const printed = Math.min(total, operationClosureEventSum_(events, batch.ID, 'LABEL_PRINTED'));
    const handedOff = Math.min(total, operationClosureEventSum_(events, batch.ID, 'LABEL_HANDOFF'));
    generationPending += Math.max(0, total - generated);
    printPending += Math.max(0, total - printed);
    handoffPending += Math.max(0, total - handedOff);
  });

  const unassignedObjects = objects.filter(function(row) { return !String(row.PRODUCTION_BATCH_ID || '').trim(); }).length;
  const notPosted = objects.filter(function(row) {
    const status = String(row.STATUS || '');
    return status !== 'POSTED' && status.indexOf('TRACKING_') !== 0;
  }).length;
  const portalReturnPending = portalReturns.filter(function(row) {
    return ['UPLOADING', 'REVIEW'].indexOf(String(row.STATUS || '').toUpperCase()) !== -1;
  }).length;
  const unresolvedTracking = Number(bucket.awaitingUpdate || 0)
    + Number(bucket.inTransit || 0)
    + Number(bucket.outForDelivery || 0)
    + Number(bucket.exception || 0)
    + Number(bucket.returning || 0)
    + Number(bucket.unknown || 0);

  const stats = {
    totalObjects: objects.length,
    productionBatches: batches.length,
    portalReturnPending: portalReturnPending,
    unassignedObjects: unassignedObjects,
    generationPending: generationPending,
    printPending: printPending,
    handoffPending: handoffPending,
    notPosted: notPosted,
    posted: Number(bucket.posted || 0),
    delivered: Number(bucket.delivered || 0),
    returned: Number(bucket.returned || 0),
    unresolvedTracking: unresolvedTracking,
    tracking: {
      awaitingUpdate: Number(bucket.awaitingUpdate || 0),
      inTransit: Number(bucket.inTransit || 0),
      outForDelivery: Number(bucket.outForDelivery || 0),
      exception: Number(bucket.exception || 0),
      returning: Number(bucket.returning || 0),
      returned: Number(bucket.returned || 0),
      unknown: Number(bucket.unknown || 0),
      delivered: Number(bucket.delivered || 0)
    }
  };
  const decision = operationClosureDecision_(stats);
  return {
    campaignId: campaignId,
    campaignStatus: String(campaign.STATUS || 'ACTIVE'),
    ready: decision.ready,
    status: String(campaign.STATUS || '') === 'CLOSED' ? 'CLOSED' : decision.status,
    blockers: decision.blockers,
    stats: stats,
    checkedAt: nowIso_(),
    note: 'Diagnostico somente leitura. O status da operacao nao e alterado automaticamente.'
  };
}
