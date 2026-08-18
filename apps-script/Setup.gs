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

function configureSheet_(sheet, headers) {
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#123A63')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}
