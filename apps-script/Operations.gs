const OPERATION_EVENT_TYPES = Object.freeze([
  'ADDRESS_LIST_RECEIVED',
  'ADDRESS_CLEANING_COMPLETED',
  'PORTAL_CSV_EXPORTED',
  'PORTAL_RETURN_IMPORTED',
  'LABEL_GENERATED',
  'LABEL_PRINTED',
  'LABEL_HANDOFF',
  'DCE_PREPARED',
  'DCE_AUTHORIZED',
  'POSTING_COMPLETED',
  'TRACKING_DELIVERED'
]);

function localDateFromIso_(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (isNaN(date.getTime())) throw new Error('Data do evento invalida.');
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'America/Fortaleza', 'yyyy-MM-dd');
}

function recordOperationEvent_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const type = String(payload.type || '').toUpperCase();
  if (OPERATION_EVENT_TYPES.indexOf(type) === -1) throw new Error('Tipo de evento operacional invalido.');
  const quantity = Number(payload.quantity || 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Quantidade do evento invalida.');
  const service = String(payload.service || '').toUpperCase();
  if (service && ['PAC', 'SEDEX'].indexOf(service) === -1) throw new Error('Servico deve ser PAC ou SEDEX.');
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!idempotencyKey) throw new Error('Informe a chave de idempotencia do evento.');

  const metadata = payload.metadata || {};
  if (type === 'DCE_PREPARED' && String(metadata.status || '') === 'AWAITING_DCE_PREPARATION') {
    return {
      skipped: true,
      type: type,
      quantity: quantity,
      reason: 'DCE_PREPARED so e registrado depois do pre-flight fiscal.'
    };
  }

  const duplicate = findRow_('OPERATION_EVENTS', function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.IDEMPOTENCY_KEY) === idempotencyKey;
  });
  if (duplicate) return publicOperationEvent_(duplicate);

  const occurredAt = String(payload.occurredAt || nowIso_());
  localDateFromIso_(occurredAt);
  const record = {
    ID: uuid_(),
    CAMPAIGN_ID: campaignId,
    USER_ID: userId,
    TYPE: type,
    SOURCE_TYPE: String(payload.sourceType || '').slice(0, 60),
    SOURCE_ID: String(payload.sourceId || '').slice(0, 160),
    SERVICE: service,
    QUANTITY: quantity,
    IDEMPOTENCY_KEY: idempotencyKey.slice(0, 220),
    METADATA_JSON: metadata,
    OCCURRED_AT: occurredAt,
    CREATED_AT: nowIso_()
  };
  appendObjects_('OPERATION_EVENTS', [record]);
  refreshDailySummary_(campaignId, localDateFromIso_(occurredAt));
  return record;
}

function publicOperationEvent_(row) {
  return {
    id: String(row.ID || ''), campaignId: String(row.CAMPAIGN_ID || ''),
    userId: String(row.USER_ID || ''), type: String(row.TYPE || ''),
    sourceType: String(row.SOURCE_TYPE || ''), sourceId: String(row.SOURCE_ID || ''),
    service: String(row.SERVICE || ''), quantity: Number(row.QUANTITY || 0),
    metadata: safeJsonParse_(row.METADATA_JSON, {}), occurredAt: String(row.OCCURRED_AT || ''),
    createdAt: String(row.CREATED_AT || '')
  };
}

function listOperationEvents_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  const date = String(payload.date || '').trim();
  return sheetRows_(getSheet_('OPERATION_EVENTS'))
    .filter(function(row) {
      if (String(row.CAMPAIGN_ID) !== campaignId) return false;
      return !date || localDateFromIso_(String(row.OCCURRED_AT || row.CREATED_AT)) === date;
    })
    .map(publicOperationEvent_)
    .reverse();
}

function emptyDailyMetrics_() {
  return {
    addressReceived: 0,
    addressCleaned: 0,
    portalExported: 0,
    portalReturned: 0,
    labelsPac: 0,
    labelsSedex: 0,
    labelsPrinted: 0,
    labelsHandedOff: 0,
    dcePrepared: 0,
    dceAuthorized: 0,
    posted: 0,
    delivered: 0
  };
}

function addEventToMetrics_(metrics, row) {
  const quantity = Number(row.QUANTITY || 0);
  const type = String(row.TYPE || '');
  const service = String(row.SERVICE || '');
  if (type === 'ADDRESS_LIST_RECEIVED') metrics.addressReceived += quantity;
  if (type === 'ADDRESS_CLEANING_COMPLETED') metrics.addressCleaned += quantity;
  if (type === 'PORTAL_CSV_EXPORTED') metrics.portalExported += quantity;
  if (type === 'PORTAL_RETURN_IMPORTED') metrics.portalReturned += quantity;
  if (type === 'LABEL_GENERATED' && service === 'PAC') metrics.labelsPac += quantity;
  if (type === 'LABEL_GENERATED' && service === 'SEDEX') metrics.labelsSedex += quantity;
  if (type === 'LABEL_PRINTED') metrics.labelsPrinted += quantity;
  if (type === 'LABEL_HANDOFF') metrics.labelsHandedOff += quantity;
  if (type === 'DCE_PREPARED') metrics.dcePrepared += quantity;
  if (type === 'DCE_AUTHORIZED') metrics.dceAuthorized += quantity;
  if (type === 'POSTING_COMPLETED') metrics.posted += quantity;
  if (type === 'TRACKING_DELIVERED') metrics.delivered += quantity;
  return metrics;
}

function refreshDailySummary_(campaignId, date) {
  const metrics = emptyDailyMetrics_();
  sheetRows_(getSheet_('OPERATION_EVENTS')).forEach(function(row) {
    if (String(row.CAMPAIGN_ID) !== String(campaignId)) return;
    if (localDateFromIso_(String(row.OCCURRED_AT || row.CREATED_AT)) !== date) return;
    addEventToMetrics_(metrics, row);
  });
  const existing = findRow_('DAILY_SUMMARIES', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.DATE) === date;
  });
  const now = nowIso_();
  if (existing) {
    updateRow_('DAILY_SUMMARIES', existing._rowNumber, { METRICS_JSON: metrics, UPDATED_AT: now });
    return metrics;
  }
  appendObjects_('DAILY_SUMMARIES', [{
    ID: uuid_(), CAMPAIGN_ID: campaignId, DATE: date, METRICS_JSON: metrics, UPDATED_AT: now
  }]);
  return metrics;
}

function getDailySummary_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  const date = String(payload.date || localDateFromIso_(nowIso_()));
  const existing = findRow_('DAILY_SUMMARIES', function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.DATE) === date;
  });
  const metrics = existing ? safeJsonParse_(existing.METRICS_JSON, emptyDailyMetrics_()) : refreshDailySummary_(campaignId, date);
  return { campaignId: campaignId, date: date, metrics: metrics };
}
