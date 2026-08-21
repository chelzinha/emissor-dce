function issuerProfileForCampaign_(campaignId) {
  return findRow_('DCE_ISSUER_PROFILES', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function normalizeIssuerProfileDraft_(source, campaignCnpj) {
  const value = source || {};
  const address = value.address || {};
  return {
    cnpj: digits_(value.cnpj || campaignCnpj),
    name: String(value.name || '').trim(),
    series: Number(value.series == null ? 0 : value.series),
    nextNumber: Number(value.nextNumber == null ? 1 : value.nextNumber),
    phone: String(value.phone || '').trim(),
    email: String(value.email || '').trim(),
    nonIcmsContributor: value.nonIcmsContributor === true,
    operationWithoutInvoice: value.operationWithoutInvoice === true,
    address: {
      street: String(address.street || '').trim(),
      number: String(address.number || '').trim(),
      complement: String(address.complement || '').trim(),
      district: String(address.district || '').trim(),
      city: String(address.city || '').trim(),
      uf: String(address.uf || '').trim().toUpperCase(),
      zip: digits_(address.zip),
      cityCode: digits_(address.cityCode),
      countryCode: digits_(address.countryCode || '1058'),
      country: String(address.country || 'BRASIL').trim(),
      phone: digits_(address.phone || value.phone),
      email: String(address.email || value.email || '').trim()
    }
  };
}

function issuerProfileDraftErrors_(profile, campaignCnpj, requireDeclarations) {
  const errors = [];
  if (!isValidCnpj_(profile.cnpj)) errors.push('CNPJ do emitente invalido.');
  if (campaignCnpj && digits_(profile.cnpj) !== digits_(campaignCnpj)) errors.push('O CNPJ do emitente deve ser o mesmo CNPJ da operacao.');
  if (String(profile.name || '').length < 2) errors.push('Razao social do emitente obrigatoria.');
  if (!String(profile.address && profile.address.street || '').trim()) errors.push('Logradouro do emitente obrigatorio.');
  if (!String(profile.address && profile.address.number || '').trim()) errors.push('Numero do emitente obrigatorio.');
  if (!String(profile.address && profile.address.district || '').trim()) errors.push('Bairro do emitente obrigatorio.');
  if (!String(profile.address && profile.address.city || '').trim()) errors.push('Municipio do emitente obrigatorio.');
  if (!/^[A-Z]{2}$/.test(String(profile.address && profile.address.uf || ''))) errors.push('UF do emitente invalida.');
  if (!/^\d{8}$/.test(digits_(profile.address && profile.address.zip))) errors.push('CEP do emitente invalido.');
  if (!/^\d{7}$/.test(digits_(profile.address && profile.address.cityCode))) errors.push('Codigo IBGE do emitente obrigatorio.');
  if (!Number.isInteger(Number(profile.series)) || Number(profile.series) < 0 || Number(profile.series) > 999) errors.push('Serie DC-e deve estar entre 0 e 999.');
  if (!Number.isInteger(Number(profile.nextNumber)) || Number(profile.nextNumber) < 1 || Number(profile.nextNumber) > 999999999) errors.push('Proximo numero DC-e invalido.');
  if (requireDeclarations && profile.nonIcmsContributor !== true) errors.push('Confirme a declaracao de nao contribuinte do ICMS.');
  if (requireDeclarations && profile.operationWithoutInvoice !== true) errors.push('Confirme a declaracao de operacao sem nota fiscal.');
  return errors;
}

function publicIssuerProfile_(row) {
  if (!row) return null;
  const profile = safeJsonParse_(row.PROFILE_JSON, {});
  profile.id = String(row.ID || '');
  profile.campaignId = String(row.CAMPAIGN_ID || '');
  profile.cnpj = String(row.CNPJ || profile.cnpj || '');
  profile.name = String(row.NAME || profile.name || '');
  profile.series = Number(row.SERIES || profile.series || 0);
  profile.nextNumber = Number(row.NEXT_NUMBER || profile.nextNumber || 1);
  profile.status = String(row.STATUS || 'DRAFT');
  profile.confirmedBy = String(row.CONFIRMED_BY || '');
  profile.confirmedAt = String(row.CONFIRMED_AT || '');
  profile.updatedAt = String(row.UPDATED_AT || '');
  return profile;
}

function getIssuerProfile_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireClientCampaignAccess_(campaignId, userId);
  return publicIssuerProfile_(issuerProfileForCampaign_(campaignId));
}

function upsertIssuerProfile_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const membership = requireClientCampaignAccess_(campaignId, userId);
  const role = String(membership.ROLE || '');
  const isClient = ['CAMPAIGN_USER', 'CLIENT_USER'].indexOf(role) !== -1;
  const campaign = findRow_('CAMPAIGNS', function(row) { return String(row.ID) === campaignId; });
  if (!campaign) throw new Error('Operacao nao encontrada.');
  const campaignCnpj = digits_(campaign.CNPJ);
  if (!isValidCnpj_(campaignCnpj)) throw new Error('Cadastre primeiro um CNPJ valido para a operacao.');

  const existing = issuerProfileForCampaign_(campaignId);
  const current = existing ? safeJsonParse_(existing.PROFILE_JSON, {}) : {};
  const incoming = payload.profile || {};
  const merged = Object.assign({}, current, incoming, {
    address: Object.assign({}, current.address || {}, incoming.address || {})
  });
  merged.cnpj = campaignCnpj;
  if (!isClient) {
    // A agencia pode preparar o cadastro, mas qualquer alteracao exige nova confirmacao do cliente.
    merged.nonIcmsContributor = false;
    merged.operationWithoutInvoice = false;
  }
  const normalized = normalizeIssuerProfileDraft_(merged, campaignCnpj);
  if (existing && Number(normalized.series) === Number(existing.SERIES || 0) && Number(normalized.nextNumber) < Number(existing.NEXT_NUMBER || 1)) {
    throw new Error('O proximo numero DC-e nao pode retroceder dentro da mesma serie.');
  }
  const confirm = isClient && payload.confirmDeclarations === true;
  const errors = issuerProfileDraftErrors_(normalized, campaignCnpj, confirm);
  if (errors.length) throw new Error(errors.join(' '));

  const now = nowIso_();
  const status = confirm ? 'ACTIVE' : 'DRAFT';
  const confirmedBy = confirm ? userId : '';
  const confirmedAt = confirm ? now : '';
  if (existing) {
    updateRow_('DCE_ISSUER_PROFILES', existing._rowNumber, {
      CNPJ: normalized.cnpj, NAME: normalized.name, SERIES: normalized.series, NEXT_NUMBER: normalized.nextNumber,
      STATUS: status, PROFILE_JSON: normalized, CONFIRMED_BY: confirmedBy, CONFIRMED_AT: confirmedAt,
      UPDATED_BY: userId, UPDATED_AT: now
    });
  } else {
    appendObjects_('DCE_ISSUER_PROFILES', [{
      ID: uuid_(), CAMPAIGN_ID: campaignId, CNPJ: normalized.cnpj, NAME: normalized.name,
      SERIES: normalized.series, NEXT_NUMBER: normalized.nextNumber, STATUS: status, PROFILE_JSON: normalized,
      CONFIRMED_BY: confirmedBy, CONFIRMED_AT: confirmedAt, UPDATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
    }]);
  }
  return publicIssuerProfile_(issuerProfileForCampaign_(campaignId));
}
