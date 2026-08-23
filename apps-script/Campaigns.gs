function campaignMembership_(campaignId, userId) {
  return findRow_('CAMPAIGN_USERS', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.USER_ID) === String(userId)
      && String(row.STATUS) === 'ACTIVE';
  });
}

function requireCampaignAccess_(campaignId, userId, allowedRoles) {
  const membership = campaignMembership_(campaignId, userId);
  if (!membership) throw new Error('Voce nao possui acesso a esta campanha.');
  if (Array.isArray(allowedRoles) && allowedRoles.length && allowedRoles.indexOf(String(membership.ROLE)) === -1) {
    throw new Error('Seu perfil nao permite esta operacao.');
  }
  return membership;
}

function upsertCampaign_(userId, payload) {
  const profile = payload.profile || {};
  const campaignId = String(payload.id || '').trim();
  const name = String(profile.name || payload.name || '').trim();
  const cnpj = digits_(profile.cnpj || payload.cnpj);
  const candidateName = String(profile.candidateName || payload.candidateName || '').trim();
  const office = String(profile.office || payload.office || '').trim();
  if (!name) throw new Error('Informe o nome da campanha.');
  if (cnpj && !isValidCnpj_(cnpj)) throw new Error('CNPJ da campanha invalido.');
  const now = nowIso_();

  if (campaignId) {
    requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
    const row = findRow_('CAMPAIGNS', function(item) { return String(item.ID) === campaignId; });
    if (!row) throw new Error('Campanha nao encontrada.');
    updateRow_('CAMPAIGNS', row._rowNumber, {
      NAME: name,
      CNPJ: cnpj,
      CANDIDATE_NAME: candidateName,
      OFFICE: office,
      STATUS: String(payload.status || row.STATUS || 'ACTIVE'),
      PROFILE_JSON: profile,
      UPDATED_AT: now
    });
    return publicCampaign_(findRow_('CAMPAIGNS', function(item) { return String(item.ID) === campaignId; }), userId);
  }

  const id = uuid_();
  appendObjects_('CAMPAIGNS', [{
    ID: id,
    NAME: name,
    CNPJ: cnpj,
    CANDIDATE_NAME: candidateName,
    OFFICE: office,
    STATUS: 'ACTIVE',
    PROFILE_JSON: profile,
    CREATED_BY: userId,
    CREATED_AT: now,
    UPDATED_AT: now
  }]);
  appendObjects_('CAMPAIGN_USERS', [{
    ID: uuid_(), CAMPAIGN_ID: id, USER_ID: userId, ROLE: 'AGENCY_ADMIN', STATUS: 'ACTIVE',
    CREATED_AT: now, UPDATED_AT: now
  }]);
  return publicCampaign_(findRow_('CAMPAIGNS', function(item) { return String(item.ID) === id; }), userId);
}

function publicCampaign_(row, userId) {
  if (!row) return null;
  const membership = campaignMembership_(row.ID, userId);
  return {
    id: String(row.ID),
    name: String(row.NAME || ''),
    cnpj: String(row.CNPJ || ''),
    candidateName: String(row.CANDIDATE_NAME || ''),
    office: String(row.OFFICE || ''),
    status: String(row.STATUS || ''),
    profile: safeJsonParse_(row.PROFILE_JSON, {}),
    role: membership ? String(membership.ROLE || '') : '',
    createdAt: String(row.CREATED_AT || ''),
    updatedAt: String(row.UPDATED_AT || '')
  };
}

function listCampaigns_(userId) {
  const memberships = rowsForUser_('CAMPAIGN_USERS', userId).filter(function(row) {
    return String(row.STATUS) === 'ACTIVE';
  });
  const allowed = {};
  memberships.forEach(function(row) { allowed[String(row.CAMPAIGN_ID)] = true; });
  return sheetRows_(getSheet_('CAMPAIGNS'))
    .filter(function(row) { return allowed[String(row.ID)]; })
    .map(function(row) { return publicCampaign_(row, userId); })
    .reverse();
}

function getCampaign_(userId, payload) {
  const campaignId = String(payload.campaignId || payload.id || '');
  requireCampaignAccess_(campaignId, userId);
  const row = findRow_('CAMPAIGNS', function(item) { return String(item.ID) === campaignId; });
  if (!row) throw new Error('Campanha nao encontrada.');
  return publicCampaign_(row, userId);
}

function addCampaignUser_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const targetUserId = String(payload.userId || '').trim();
  const role = String(payload.role || 'CAMPAIGN_USER').toUpperCase();
  if (!targetUserId) throw new Error('Usuario nao informado.');
  if (['AGENCY_ADMIN', 'CAMPAIGN_USER'].indexOf(role) === -1) throw new Error('Perfil de acesso invalido.');
  const now = nowIso_();
  const existing = findRow_('CAMPAIGN_USERS', function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.USER_ID) === targetUserId;
  });
  if (existing) {
    updateRow_('CAMPAIGN_USERS', existing._rowNumber, { ROLE: role, STATUS: 'ACTIVE', UPDATED_AT: now });
    return publicRecord_(findRow_('CAMPAIGN_USERS', function(row) { return String(row.ID) === String(existing.ID); }));
  }
  const record = {
    ID: uuid_(), CAMPAIGN_ID: campaignId, USER_ID: targetUserId, ROLE: role,
    STATUS: 'ACTIVE', CREATED_AT: now, UPDATED_AT: now
  };
  appendObjects_('CAMPAIGN_USERS', [record]);
  return record;
}
