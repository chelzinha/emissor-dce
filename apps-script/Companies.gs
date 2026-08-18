function getCompany_(userId) {
  const row = rowsForUser_('COMPANIES', userId)[0];
  if (!row) return null;
  return {
    id: String(row.ID),
    cnpj: String(row.CNPJ),
    name: String(row.NAME),
    series: Number(row.SERIES || 0),
    nextNumber: Number(row.NEXT_NUMBER || 1),
    profile: safeJsonParse_(row.PROFILE_JSON, {})
  };
}

function upsertCompany_(userId, payload) {
  const profile = validateCompany_(payload.profile || payload);
  const existing = rowsForUser_('COMPANIES', userId)[0];
  const now = nowIso_();
  if (!existing) {
    const id = uuid_();
    appendObjects_('COMPANIES', [{
      ID: id, USER_ID: userId, CNPJ: profile.cnpj, NAME: profile.name,
      SERIES: profile.series, NEXT_NUMBER: Number(payload.nextNumber || 1),
      PROFILE_JSON: profile, CREATED_AT: now, UPDATED_AT: now
    }]);
    return getCompany_(userId);
  }
  const nextNumber = payload.nextNumber == null ? Number(existing.NEXT_NUMBER || 1) : Number(payload.nextNumber);
  if (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 999999999) {
    throw new Error('Próximo número deve estar entre 1 e 999999999.');
  }
  updateRow_('COMPANIES', existing._rowNumber, {
    CNPJ: profile.cnpj, NAME: profile.name, SERIES: profile.series,
    NEXT_NUMBER: nextNumber, PROFILE_JSON: profile, UPDATED_AT: now
  });
  return getCompany_(userId);
}
