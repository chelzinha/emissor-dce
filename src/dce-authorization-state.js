const TERMINAL_DCE_STATUSES = new Set(['AUTHORIZED', 'REJECTED', 'CANCELLED']);
const CONTINUABLE_BATCH_STATUSES = new Set(['DCE_PREPARED', 'DCE_RESERVED', 'DCE_PARTIAL']);

export function canContinueProductionDce(status) {
  return CONTINUABLE_BATCH_STATUSES.has(String(status || '').toUpperCase());
}

export function pendingAuthorizationDocuments(documents) {
  const rows = Array.isArray(documents) ? documents : [];
  return rows.filter((document) => !TERMINAL_DCE_STATUSES.has(String(document?.status || '').toUpperCase()));
}

export function fiscalBatchId(reservation) {
  return String(reservation?.id || reservation?.batch?.ID || reservation?.batch?.id || '');
}
