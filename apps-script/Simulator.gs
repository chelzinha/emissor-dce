function simulatorDigits_(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function simulatorCep_(value, label) {
  const cep = simulatorDigits_(value);
  if (!/^\d{8}$/.test(cep)) throw new Error((label || 'CEP') + ' deve possuir 8 digitos.');
  return cep;
}

function simulatorService_(value) {
  const service = String(value || '').toUpperCase();
  if (service.indexOf('SEDEX') === 0) return 'SEDEX';
  if (service.indexOf('PAC') === 0) return 'PAC';
  throw new Error('Servico deve ser PAC ou SEDEX.');
}

function activeTariffAssignment_(campaignId) {
  return sheetRows_(getSheet_('POSTAL_TARIFF_ASSIGNMENTS')).find(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.STATUS) === 'ACTIVE';
  }) || null;
}

function tariffVersionById_(versionId) {
  return findRow_('POSTAL_TARIFF_VERSIONS', function(row) { return String(row.ID) === String(versionId); });
}

function publicTariffVersion_(row) {
  if (!row) return null;
  return {
    id: String(row.ID || ''), name: String(row.NAME || ''), sourceLabel: String(row.SOURCE_LABEL || ''),
    validFrom: String(row.VALID_FROM || ''), validTo: String(row.VALID_TO || ''), status: String(row.STATUS || '')
  };
}

function simulatorConfig_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  const assignment = activeTariffAssignment_(campaignId);
  if (!assignment) return { configured: false, reason: 'TABELA_NAO_CONFIGURADA', version: null, defaultOriginCep: '' };
  const version = tariffVersionById_(assignment.VERSION_ID);
  if (!version || String(version.STATUS) !== 'ACTIVE') return { configured: false, reason: 'TABELA_INATIVA', version: publicTariffVersion_(version), defaultOriginCep: '' };
  const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
  const profile = safeJsonParse_(campaign && campaign.PROFILE_JSON, {});
  return {
    configured: true, version: publicTariffVersion_(version),
    defaultOriginCep: simulatorDigits_(profile.originCep || profile.postalOriginCep || '')
  };
}

function tariffContains_(value, startValue, endValue) {
  const start = simulatorDigits_(startValue); const end = simulatorDigits_(endValue);
  if (!start && !end) return true;
  const numeric = Number(value); if (start && numeric < Number(start)) return false; if (end && numeric > Number(end)) return false;
  return true;
}

function simulatorQuote_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  const config = simulatorConfig_(userId, { campaignId: campaignId });
  const request = {
    originCep: simulatorCep_(payload.originCep, 'CEP de origem'),
    destinationCep: simulatorCep_(payload.destinationCep, 'CEP de destino'),
    service: simulatorService_(payload.service),
    weightGrams: Math.round(Number(payload.weightGrams || 0)),
    heightCm: Number(payload.heightCm || 0), widthCm: Number(payload.widthCm || 0), lengthCm: Number(payload.lengthCm || 0)
  };
  if (!(request.weightGrams > 0)) throw new Error('Peso invalido.');
  if ([request.heightCm, request.widthCm, request.lengthCm].some(function(value) { return !Number.isFinite(value) || value < 0; })) throw new Error('Dimensoes invalidas.');
  if (!config.configured) return { configured: false, matched: false, request: request, reason: config.reason, version: config.version };

  const rows = sheetRows_(getSheet_('POSTAL_TARIFF_ROWS')).filter(function(row) {
    if (String(row.VERSION_ID) !== String(config.version.id)) return false;
    if (simulatorService_(row.SERVICE) !== request.service) return false;
    if (!tariffContains_(request.originCep, row.ORIGIN_CEP_START, row.ORIGIN_CEP_END)) return false;
    if (!tariffContains_(request.destinationCep, row.DEST_CEP_START, row.DEST_CEP_END)) return false;
    const min = Number(row.WEIGHT_MIN_G || 0); const max = row.WEIGHT_MAX_G === '' ? Infinity : Number(row.WEIGHT_MAX_G);
    return request.weightGrams >= min && request.weightGrams <= max;
  });
  if (!rows.length) return { configured: true, matched: false, request: request, reason: 'FAIXA_NAO_ENCONTRADA', version: config.version };
  rows.sort(function(a, b) {
    const rangeA = (Number(simulatorDigits_(a.DEST_CEP_END) || 99999999) - Number(simulatorDigits_(a.DEST_CEP_START) || 0)) + (Number(a.WEIGHT_MAX_G || 999999999) - Number(a.WEIGHT_MIN_G || 0));
    const rangeB = (Number(simulatorDigits_(b.DEST_CEP_END) || 99999999) - Number(simulatorDigits_(b.DEST_CEP_START) || 0)) + (Number(b.WEIGHT_MAX_G || 999999999) - Number(b.WEIGHT_MIN_G || 0));
    return rangeA - rangeB;
  });
  const row = rows[0]; const priceCents = Number(row.PRICE_CENTS); const deadline = Number(row.DEADLINE_BUSINESS_DAYS);
  if (!Number.isFinite(priceCents) || priceCents < 0 || !Number.isFinite(deadline) || deadline < 0) throw new Error('Tabela postal possui uma faixa invalida.');
  return {
    configured: true, matched: true, request: request, version: config.version, service: request.service,
    priceCents: priceCents, deadlineBusinessDays: deadline, metadata: safeJsonParse_(row.METADATA_JSON, {})
  };
}

function startTariffVersion_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const name = String(payload.name || '').trim(); if (!name) throw new Error('Informe o nome da tabela.');
  const id = uuid_(); const now = nowIso_();
  appendObjects_('POSTAL_TARIFF_VERSIONS', [{
    ID: id, NAME: name, SOURCE_LABEL: String(payload.sourceLabel || '').slice(0, 180),
    VALID_FROM: String(payload.validFrom || ''), VALID_TO: String(payload.validTo || ''), STATUS: 'UPLOADING',
    CREATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
  }]);
  return { id: id, chunkSize: 500 };
}

function appendTariffRows_(userId, payload) {
  const campaignId = String(payload.campaignId || ''); requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const versionId = String(payload.versionId || ''); const version = tariffVersionById_(versionId);
  if (!version || String(version.STATUS) !== 'UPLOADING') throw new Error('Tabela nao esta aberta para importacao.');
  const rows = Array.isArray(payload.rows) ? payload.rows : []; if (!rows.length || rows.length > 500) throw new Error('Bloco de tarifas invalido.');
  const now = nowIso_();
  const records = rows.map(function(source) {
    const service = simulatorService_(source.service); const priceCents = Number(source.priceCents); const deadline = Number(source.deadlineBusinessDays);
    if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error('Preco invalido na tabela postal.');
    if (!Number.isFinite(deadline) || deadline < 0) throw new Error('Prazo invalido na tabela postal.');
    return {
      ID: uuid_(), VERSION_ID: versionId, SERVICE: service,
      ORIGIN_CEP_START: simulatorDigits_(source.originCepStart), ORIGIN_CEP_END: simulatorDigits_(source.originCepEnd),
      DEST_CEP_START: simulatorDigits_(source.destinationCepStart), DEST_CEP_END: simulatorDigits_(source.destinationCepEnd),
      WEIGHT_MIN_G: Number(source.weightMinGrams || 0), WEIGHT_MAX_G: source.weightMaxGrams == null ? '' : Number(source.weightMaxGrams),
      PRICE_CENTS: priceCents, DEADLINE_BUSINESS_DAYS: deadline, METADATA_JSON: source.metadata || {}, CREATED_AT: now
    };
  });
  appendObjects_('POSTAL_TARIFF_ROWS', records); return { appended: records.length };
}

function activateTariffVersion_(userId, payload) {
  const campaignId = String(payload.campaignId || ''); requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const versionId = String(payload.versionId || ''); const version = tariffVersionById_(versionId);
  if (!version) throw new Error('Tabela postal nao encontrada.');
  const count = sheetRows_(getSheet_('POSTAL_TARIFF_ROWS')).filter(function(row) { return String(row.VERSION_ID) === versionId; }).length;
  if (!count) throw new Error('A tabela postal nao possui faixas.');
  updateRow_('POSTAL_TARIFF_VERSIONS', version._rowNumber, { STATUS: 'ACTIVE', UPDATED_AT: nowIso_() });
  sheetRows_(getSheet_('POSTAL_TARIFF_ASSIGNMENTS')).filter(function(row) { return String(row.CAMPAIGN_ID) === campaignId && String(row.STATUS) === 'ACTIVE'; }).forEach(function(row) {
    updateRow_('POSTAL_TARIFF_ASSIGNMENTS', row._rowNumber, { STATUS: 'INACTIVE', UPDATED_AT: nowIso_() });
  });
  appendObjects_('POSTAL_TARIFF_ASSIGNMENTS', [{ ID: uuid_(), CAMPAIGN_ID: campaignId, VERSION_ID: versionId, STATUS: 'ACTIVE', CREATED_BY: userId, CREATED_AT: nowIso_(), UPDATED_AT: nowIso_() }]);
  return simulatorConfig_(userId, { campaignId: campaignId });
}
