function setupProject() {
  const properties = getScriptProperties_();
  let spreadsheetId = properties.getProperty(DCE_CONFIG.PROPERTY_SPREADSHEET_ID);
  let folderId = properties.getProperty(DCE_CONFIG.PROPERTY_ROOT_FOLDER_ID);

  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create(`${DCE_CONFIG.APP_NAME} - Base de dados`);
    spreadsheetId = spreadsheet.getId();
    properties.setProperty(DCE_CONFIG.PROPERTY_SPREADSHEET_ID, spreadsheetId);
  }
  if (!folderId) {
    const folder = DriveApp.createFolder(`${DCE_CONFIG.APP_NAME} - Arquivos`);
    folderId = folder.getId();
    properties.setProperty(DCE_CONFIG.PROPERTY_ROOT_FOLDER_ID, folderId);
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const expectedNames = Object.keys(DCE_CONFIG.SHEETS);
  expectedNames.forEach(function(name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    configureSheet_(sheet, DCE_CONFIG.SHEETS[name]);
  });

  spreadsheet.getSheets().forEach(function(sheet) {
    if (expectedNames.indexOf(sheet.getName()) === -1 && spreadsheet.getSheets().length > 1) {
      spreadsheet.deleteSheet(sheet);
    }
  });

  return {
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    rootFolderId: folderId,
    rootFolderUrl: DriveApp.getFolderById(folderId).getUrl()
  };
}

function setApiToken(token) {
  const value = String(token || '').trim();
  if (value.length < 32) throw new Error('Use um segredo com pelo menos 32 caracteres.');
  getScriptProperties_().setProperty(DCE_CONFIG.PROPERTY_API_TOKEN, value);
  return true;
}

function bootstrapOperationsProject() {
  const setup = setupProject();
  const properties = getScriptProperties_();
  let token = String(properties.getProperty(DCE_CONFIG.PROPERTY_API_TOKEN) || '');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    setApiToken(token);
  }

  const webAppUrl = String(ScriptApp.getService().getUrl() || '');
  const folder = DriveApp.getFolderById(setup.rootFolderId);
  const bootstrapName = 'AGF_OPERACOES_BOOTSTRAP.json';
  const previous = folder.getFilesByName(bootstrapName);
  while (previous.hasNext()) previous.next().setTrashed(true);

  const payload = {
    appName: DCE_CONFIG.APP_NAME,
    version: DCE_CONFIG.VERSION,
    webAppUrl: webAppUrl,
    apiToken: token,
    spreadsheetId: setup.spreadsheetId,
    spreadsheetUrl: setup.spreadsheetUrl,
    rootFolderId: setup.rootFolderId,
    rootFolderUrl: setup.rootFolderUrl,
    createdAt: new Date().toISOString()
  };
  const bootstrapFile = folder.createFile(bootstrapName, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
  console.log('Bootstrap criado no Drive: ' + bootstrapFile.getId());
  if (!webAppUrl) console.log('A URL do Web App ainda esta vazia. Implante o projeto como Web App e execute bootstrapOperationsProject() novamente.');
  return {
    ok: true,
    bootstrapFileId: bootstrapFile.getId(),
    bootstrapFileName: bootstrapName,
    webAppUrlConfigured: Boolean(webAppUrl),
    spreadsheetUrl: setup.spreadsheetUrl,
    rootFolderUrl: setup.rootFolderUrl
  };
}

function remapRowsByHeader_(existingHeaders, rows, expectedHeaders) {
  const index = {};
  existingHeaders.forEach(function(header, column) {
    const key = String(header || '').trim();
    if (key && index[key] == null) index[key] = column;
  });
  return rows.map(function(row) {
    return expectedHeaders.map(function(header) {
      const column = index[String(header)];
      return column == null ? '' : row[column];
    });
  });
}

function configureSheet_(sheet, headers) {
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const existingHeaders = lastColumn
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) { return String(value || '').trim(); })
    : [];
  const existingRows = lastRow > 1 && lastColumn
    ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
    : [];
  const hasExistingSchema = existingHeaders.some(function(header) { return Boolean(header); });
  const sameSchema = existingHeaders.length === headers.length && headers.every(function(header, index) {
    return String(existingHeaders[index] || '') === String(header);
  });
  const remappedRows = hasExistingSchema && !sameSchema && existingRows.length
    ? remapRowsByHeader_(existingHeaders, existingRows, headers)
    : null;

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  if (hasExistingSchema && !sameSchema) {
    const clearWidth = Math.max(lastColumn, headers.length);
    const clearHeight = Math.max(1, lastRow);
    sheet.getRange(1, 1, clearHeight, clearWidth).clearContent();
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (remappedRows && remappedRows.length) {
    sheet.getRange(2, 1, remappedRows.length, headers.length).setValues(remappedRows);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#123A63')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}