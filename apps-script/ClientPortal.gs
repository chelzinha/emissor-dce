function requireClientCampaignAccess_(campaignId, userId) {
  const membership = requireCampaignAccess_(campaignId, userId);
  const role = String(membership.ROLE || '');
  if (['AGENCY_ADMIN', 'CAMPAIGN_USER', 'CLIENT_USER'].indexOf(role) === -1) {
    throw new Error('Seu perfil nao possui acesso ao portal do cliente.');
  }
  return membership;
}

function clientEventLabel_(type) {
  const labels = {
    ADDRESS_LIST_RECEIVED: 'Cadastros recebidos',
    ADDRESS_CLEANING_COMPLETED: 'Enderecos preparados',
    PORTAL_CSV_EXPORTED: 'Arquivo enviado ao Portal Postal',
    PORTAL_RETURN_IMPORTED: 'Etiquetas retornadas do Portal',
    LABEL_GENERATED: 'Etiquetas geradas',
    LABEL_TEST_APPROVED: 'Etiqueta de teste aprovada',
    LABEL_PRINTED: 'Etiquetas impressas',
    LABEL_HANDOFF: 'Etiquetas entregues a operacao',
    DCE_PREPARED: 'DC-e preparada',
    DCE_AUTHORIZED: 'DC-e autorizada',
    POSTING_COMPLETED: 'Postagem concluida',
    TRACKING_DELIVERED: 'Objetos entregues',
    OFFLINE_SYNC_COMPLETED: 'Contingencia sincronizada'
  };
  return labels[String(type || '').toUpperCase()] || String(type || 'Atualizacao da operacao');
}

function addClientMetric_(metrics, row) {
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
}

function clientDashboard_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  const metrics = {
    addressReceived: 0, addressCleaned: 0, portalExported: 0, portalReturned: 0,
    labelsPac: 0, labelsSedex: 0, labelsPrinted: 0, labelsHandedOff: 0,
    dcePrepared: 0, dceAuthorized: 0, posted: 0, delivered: 0
  };
  const events = sheetRows_(getSheet_('OPERATION_EVENTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  });
  events.forEach(function(row) { addClientMetric_(metrics, row); });
  metrics.labelsGenerated = metrics.labelsPac + metrics.labelsSedex;
  metrics.withoutDeliveryRecord = Math.max(0, metrics.posted - metrics.delivered);

  const timeline = events.slice().sort(function(a, b) {
    return String(b.OCCURRED_AT || b.CREATED_AT || '').localeCompare(String(a.OCCURRED_AT || a.CREATED_AT || ''));
  }).slice(0, 12).map(function(row) {
    return {
      type: String(row.TYPE || ''), label: clientEventLabel_(row.TYPE),
      service: String(row.SERVICE || ''), quantity: Number(row.QUANTITY || 0),
      occurredAt: String(row.OCCURRED_AT || row.CREATED_AT || '')
    };
  });

  const productions = sheetRows_(getSheet_('PRODUCTION_BATCHES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  });
  const productionStatus = { total: productions.length, active: 0, completed: 0, blocked: 0 };
  productions.forEach(function(row) {
    const status = String(row.STATUS || '').toUpperCase();
    if (['FINISHED', 'POSTED', 'DELIVERED', 'DCE_AUTHORIZED'].indexOf(status) !== -1) productionStatus.completed += 1;
    else if (['BLOCKED', 'REVIEW', 'ERROR', 'REJECTED'].indexOf(status) !== -1) productionStatus.blocked += 1;
    else productionStatus.active += 1;
  });

  return { campaignId: campaignId, metrics: metrics, productionStatus: productionStatus, timeline: timeline };
}
