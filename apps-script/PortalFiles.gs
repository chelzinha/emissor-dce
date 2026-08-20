function getPortalExportRecord_(campaignId, exportId) {
  return findRow_('PORTAL_EXPORTS', function(row) {
    return String(row.ID) === String(exportId)
      && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function readPortalExportFile_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const exportId = String(payload.exportId || '');
  requireCampaignAccess_(campaignId, userId);
  const record = getPortalExportRecord_(campaignId, exportId);
  if (!record) throw new Error('Exportacao do Portal Postal nao encontrada.');
  const fileId = String(record.FILE_ID || '');
  if (!fileId) throw new Error('Arquivo da exportacao nao encontrado.');
  const file = DriveApp.getFileById(fileId);
  return {
    id: String(record.ID),
    service: String(record.SERVICE || ''),
    total: Number(record.TOTAL_ROWS || 0),
    fileName: String(record.FILE_NAME || file.getName()),
    sha256: String(record.SHA256 || ''),
    content: file.getBlob().getDataAsString('UTF-8')
  };
}
