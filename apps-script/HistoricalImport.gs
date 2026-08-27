const HISTORICAL_IMPORT_CAMPAIGN_ID = 'd0a9470d-79dd-425f-9bd3-c6230c4693e5';
const HISTORICAL_IMPORT_SHEETS = Object.freeze([
  'ADDRESS_LISTS', 'ADDRESS_ROWS', 'CLEANING_BATCHES', 'PORTAL_EXPORTS',
  'PORTAL_RETURNS', 'POSTAL_OBJECTS', 'PRODUCTION_BATCHES', 'DELIVERY_VOLUMES',
  'TRACKING_EVENTS', 'OPERATION_EVENTS', 'DAILY_SUMMARIES',
  'FINANCE_IMPORTS', 'FINANCE_POSTINGS', 'FINANCE_PAYMENTS', 'FINANCE_ALLOCATIONS'
]);

function historicalRequire_(userId, payload) {
  const campaignId = String(payload && payload.campaignId || '');
  if (campaignId !== HISTORICAL_IMPORT_CAMPAIGN_ID) throw new Error('Campanha histórica inválida.');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  return campaignId;
}

function historicalClearDataRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow > 1 && lastColumn > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  }
}

function historicalDeleteTemporarySheets_() {
  const spreadsheet = getSpreadsheet_();
  ['MIGRATION_TEST', 'IMPORTRANGE_TEST', 'IMPORTAR_HISTORICO'].forEach(function(name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(sheet);
  });
}

function historicalReadArchiveEntry_(payload) {
  const fileId = String(payload && payload.archiveFileId || '').trim();
  const entryName = String(payload && payload.entryName || '').trim();
  if (!fileId || !entryName) throw new Error('Arquivo ou etapa da migração não informado.');
  const blobs = Utilities.unzip(DriveApp.getFileById(fileId).getBlob());
  const target = blobs.filter(function(blob) { return String(blob.getName()) === entryName; })[0];
  if (!target) throw new Error('Etapa da migração não encontrada: ' + entryName);
  const jsonText = entryName.slice(-3).toLowerCase() === '.gz'
    ? Utilities.ungzip(target).getDataAsString('UTF-8')
    : target.getDataAsString('UTF-8');
  return safeJsonParse_(jsonText, null);
}

function historicalReset_(userId, payload) {
  historicalRequire_(userId, payload);
  HISTORICAL_IMPORT_SHEETS.forEach(historicalClearDataRows_);
  historicalDeleteTemporarySheets_();
  const properties = getScriptProperties_().getProperties();
  Object.keys(properties).forEach(function(key) {
    if (key.indexOf('HISTORICAL_IMPORT_') === 0) getScriptProperties_().deleteProperty(key);
  });
  return { ok: true, clearedSheets: HISTORICAL_IMPORT_SHEETS.length };
}

function historicalExistingIds_(sheetName) {
  const result = {};
  sheetRows_(getSheet_(sheetName)).forEach(function(row) {
    const id = String(row.ID || '');
    if (id) result[id] = true;
  });
  return result;
}

function historicalAppendMissing_(sheetName, records) {
  const rows = Array.isArray(records) ? records : [];
  if (!rows.length) return { received: 0, inserted: 0, duplicates: 0 };
  const existing = historicalExistingIds_(sheetName);
  const missing = rows.filter(function(row) {
    const id = String(row && row.ID || '');
    if (!id || existing[id]) return false;
    existing[id] = true;
    return true;
  });
  appendObjects_(sheetName, missing);
  return { received: rows.length, inserted: missing.length, duplicates: rows.length - missing.length };
}

function historicalCampaign_(userId, payload) {
  const campaignId = historicalRequire_(userId, payload);
  const source = historicalReadArchiveEntry_(payload);
  const meta = source && source.campaignMeta || {};
  const profile = source && source.campaign || {};
  const row = findRow_('CAMPAIGNS', function(item) { return String(item.ID) === campaignId; });
  if (!row) throw new Error('Campanha não encontrada.');
  updateRow_('CAMPAIGNS', row._rowNumber, {
    NAME: meta.NAME,
    CNPJ: meta.CNPJ,
    CANDIDATE_NAME: meta.CANDIDATE_NAME,
    OFFICE: meta.OFFICE,
    STATUS: 'ACTIVE',
    PROFILE_JSON: profile,
    UPDATED_AT: meta.UPDATED_AT || nowIso_()
  });
  return { ok: true, campaignId: campaignId };
}

function historicalAddresses_(userId, payload) {
  historicalRequire_(userId, payload);
  const source = historicalReadArchiveEntry_(payload) || {};
  return {
    addressList: historicalAppendMissing_('ADDRESS_LISTS', source.addressList ? [source.addressList] : []),
    cleaningBatch: historicalAppendMissing_('CLEANING_BATCHES', source.cleaningBatch ? [source.cleaningBatch] : []),
    rows: historicalAppendMissing_('ADDRESS_ROWS', source.rows || [])
  };
}

function historicalLot_(userId, payload) {
  historicalRequire_(userId, payload);
  const source = historicalReadArchiveEntry_(payload) || {};
  const lot = source.lot || {};
  return {
    portalExport: historicalAppendMissing_('PORTAL_EXPORTS', lot.export ? [lot.export] : []),
    portalReturn: historicalAppendMissing_('PORTAL_RETURNS', lot.return ? [lot.return] : []),
    productionBatch: historicalAppendMissing_('PRODUCTION_BATCHES', lot.batch ? [lot.batch] : []),
    volumes: historicalAppendMissing_('DELIVERY_VOLUMES', lot.volumes || []),
    objects: historicalAppendMissing_('POSTAL_OBJECTS', lot.objects || [])
  };
}

function historicalTracking_(userId, payload) {
  historicalRequire_(userId, payload);
  const source = historicalReadArchiveEntry_(payload) || {};
  return historicalAppendMissing_('TRACKING_EVENTS', source.rows || []);
}

function historicalEvents_(userId, payload) {
  historicalRequire_(userId, payload);
  const source = historicalReadArchiveEntry_(payload) || {};
  const events = historicalAppendMissing_('OPERATION_EVENTS', source.events || []);
  const summaries = historicalAppendMissing_('DAILY_SUMMARIES', source.dailySummaries || []);
  return { events: events, dailySummaries: summaries };
}

function historicalFinance_(userId, payload) {
  historicalRequire_(userId, payload);
  const source = historicalReadArchiveEntry_(payload) || {};
  return {
    imports: historicalAppendMissing_('FINANCE_IMPORTS', source.imports || []),
    postings: historicalAppendMissing_('FINANCE_POSTINGS', source.postings || []),
    payments: historicalAppendMissing_('FINANCE_PAYMENTS', source.payments || []),
    allocations: historicalAppendMissing_('FINANCE_ALLOCATIONS', source.allocations || [])
  };
}

function historicalSheetCount_(sheetName) {
  return sheetRows_(getSheet_(sheetName)).filter(function(row) {
    return String(row.CAMPAIGN_ID || '') === HISTORICAL_IMPORT_CAMPAIGN_ID;
  }).length;
}

function historicalFinalize_(userId, payload) {
  historicalRequire_(userId, payload);
  const expected = payload.expected || {};
  const actual = {
    addresses: historicalSheetCount_('ADDRESS_ROWS'),
    portalExports: historicalSheetCount_('PORTAL_EXPORTS'),
    portalReturns: historicalSheetCount_('PORTAL_RETURNS'),
    objects: historicalSheetCount_('POSTAL_OBJECTS'),
    batches: historicalSheetCount_('PRODUCTION_BATCHES'),
    volumes: historicalSheetCount_('DELIVERY_VOLUMES'),
    tracking: historicalSheetCount_('TRACKING_EVENTS'),
    events: historicalSheetCount_('OPERATION_EVENTS'),
    dailySummaries: historicalSheetCount_('DAILY_SUMMARIES'),
    financePostings: historicalSheetCount_('FINANCE_POSTINGS')
  };
  Object.keys(expected).forEach(function(key) {
    if (Number(expected[key]) !== Number(actual[key])) {
      throw new Error('Contagem histórica divergente em ' + key + ': esperado ' + expected[key] + ', encontrado ' + actual[key] + '.');
    }
  });
  return { ok: true, actual: actual };
}
