const CLOSED_CAMPAIGN_READ_ACTIONS_ = Object.freeze([
  'campaign.get',
  'addressLists.list', 'addressRows.list',
  'portal.exports.list', 'portal.export.file',
  'portalReturns.list', 'postalObjects.list',
  'production.list', 'volumes.list', 'production.gates', 'production.labelTest.data',
  'production.protocol.data', 'production.documents.test', 'production.documents.volume', 'production.posting.list',
  'productionDce.list', 'productionDce.preflight',
  'postalRates.list', 'postalRates.quote',
  'tracking.summary', 'tracking.events.list', 'tracking.objects.list', 'tracking.geo.summary',
  'operations.list', 'operation.closure.status', 'operation.closure.close', 'operation.closure.reopen',
  'dashboard.daily'
]);

function closedCampaignActionId_(action, payload) {
  const source = payload || {};
  if (source.campaignId) return String(source.campaignId);
  if (String(action || '') === 'campaign.upsert' && source.id) return String(source.id);
  return '';
}

function guardClosedCampaignAction_(action, payload) {
  const campaignId = closedCampaignActionId_(action, payload);
  if (!campaignId) return;
  const campaign = findRow_('CAMPAIGNS', function(row) {
    return String(row.ID) === campaignId;
  });
  if (!campaign || String(campaign.STATUS || '').toUpperCase() !== 'CLOSED') return;
  if (CLOSED_CAMPAIGN_READ_ACTIONS_.indexOf(String(action || '')) !== -1) return;
  throw new Error('Esta operacao esta encerrada e bloqueada para alteracoes. Reabra a operacao antes de modificar dados.');
}

function closureConfirmation_(value, expected) {
  return String(value || '').trim().toUpperCase() === String(expected || '').toUpperCase();
}

function appendClosureAudit_(userId, campaignId, type, metadata) {
  const now = nowIso_();
  const details = metadata || {};
  appendObjects_('OPERATION_EVENTS', [{
    ID: uuid_(),
    CAMPAIGN_ID: campaignId,
    USER_ID: userId,
    TYPE: type,
    SOURCE_TYPE: 'CAMPAIGN',
    SOURCE_ID: campaignId,
    SERVICE: '',
    QUANTITY: Number(details.totalObjects || 0),
    IDEMPOTENCY_KEY: String(type || '').toLowerCase() + ':' + campaignId + ':' + now,
    METADATA_JSON: details,
    OCCURRED_AT: now,
    CREATED_AT: now
  }]);
  return now;
}

function operationClosureClose_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (!closureConfirmation_(payload.confirmation, 'ENCERRAR')) {
    throw new Error('Para encerrar, confirme digitando ENCERRAR.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
    if (!campaign) throw new Error('Operacao nao encontrada.');
    if (String(campaign.STATUS || '').toUpperCase() === 'CLOSED') {
      return operationClosureStatus_(userId, { campaignId: campaignId });
    }
    const diagnosis = operationClosureStatus_(userId, { campaignId: campaignId });
    if (!diagnosis.ready) {
      const labels = (diagnosis.blockers || []).slice(0, 4).map(function(item) { return item.label; }).join('; ');
      throw new Error('A operacao ainda possui pendencias e nao pode ser encerrada.' + (labels ? ' ' + labels + '.' : ''));
    }
    const closedAt = nowIso_();
    updateRow_('CAMPAIGNS', campaign._rowNumber, { STATUS: 'CLOSED', UPDATED_AT: closedAt });
    appendClosureAudit_(userId, campaignId, 'OPERATION_CLOSED', {
      totalObjects: Number(diagnosis.stats && diagnosis.stats.totalObjects || 0),
      delivered: Number(diagnosis.stats && diagnosis.stats.delivered || 0),
      returned: Number(diagnosis.stats && diagnosis.stats.returned || 0),
      closureStatus: diagnosis.status
    });
    return operationClosureStatus_(userId, { campaignId: campaignId });
  } finally {
    lock.releaseLock();
  }
}

function operationClosureReopen_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  if (!closureConfirmation_(payload.confirmation, 'REABRIR')) {
    throw new Error('Para reabrir, confirme digitando REABRIR.');
  }
  const reason = String(payload.reason || '').trim();
  if (reason.length < 10) throw new Error('Informe o motivo da reabertura com pelo menos 10 caracteres.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
    if (!campaign) throw new Error('Operacao nao encontrada.');
    if (String(campaign.STATUS || '').toUpperCase() !== 'CLOSED') {
      return operationClosureStatus_(userId, { campaignId: campaignId });
    }
    const reopenedAt = nowIso_();
    updateRow_('CAMPAIGNS', campaign._rowNumber, { STATUS: 'ACTIVE', UPDATED_AT: reopenedAt });
    appendClosureAudit_(userId, campaignId, 'OPERATION_REOPENED', {
      reason: reason,
      totalObjects: operationClosureCampaignRows_('POSTAL_OBJECTS', campaignId).length
    });
    return operationClosureStatus_(userId, { campaignId: campaignId });
  } finally {
    lock.releaseLock();
  }
}
