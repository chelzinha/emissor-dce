const DCE_CONFIG = Object.freeze({
  APP_NAME: 'Emissor DC-e',
  VERSION: '0.1.0',
  MAX_IMPORT_CHUNK: 200,
  MAX_RESULT_CHUNK: 20,
  PROPERTY_SPREADSHEET_ID: 'DCE_SPREADSHEET_ID',
  PROPERTY_ROOT_FOLDER_ID: 'DCE_ROOT_FOLDER_ID',
  PROPERTY_API_TOKEN: 'DCE_API_TOKEN',
  SHEETS: Object.freeze({
    USERS: ['ID', 'EMAIL', 'STATUS', 'CREATED_AT', 'UPDATED_AT'],
    COMPANIES: ['ID', 'USER_ID', 'CNPJ', 'NAME', 'SERIES', 'NEXT_NUMBER', 'PROFILE_JSON', 'CREATED_AT', 'UPDATED_AT'],
    IMPORTS: ['ID', 'USER_ID', 'FILE_NAME', 'FILE_TYPE', 'STATUS', 'TOTAL_ROWS', 'VALID_ROWS', 'ERROR_ROWS', 'CREATED_AT', 'UPDATED_AT'],
    REMITTANCES: ['ID', 'USER_ID', 'IMPORT_ID', 'TRACKING_CODE', 'SERVICE', 'REFERENCE', 'STATUS', 'DOCUMENT_JSON', 'ERRORS_JSON', 'CREATED_AT', 'UPDATED_AT'],
    BATCHES: ['ID', 'USER_ID', 'COMPANY_ID', 'ENVIRONMENT', 'STATUS', 'TOTAL', 'AUTHORIZED', 'REJECTED', 'ERRORS', 'CREATED_AT', 'UPDATED_AT'],
    DCE: ['ID', 'USER_ID', 'BATCH_ID', 'REMITTANCE_ID', 'CNPJ', 'SERIES', 'NUMBER', 'NUMERIC_CODE', 'ACCESS_KEY', 'STATUS', 'CSTAT', 'REASON', 'PROTOCOL', 'AUTHORIZED_AT', 'SIGNED_XML_FILE_ID', 'PROCESSED_XML_FILE_ID', 'DACE_FILE_ID', 'CREATED_AT', 'UPDATED_AT'],
    EVENTS: ['ID', 'USER_ID', 'DCE_ID', 'TYPE', 'STATUS', 'PROTOCOL', 'DETAILS_JSON', 'CREATED_AT'],
    LOGS: ['ID', 'USER_ID', 'ACTION', 'LEVEL', 'MESSAGE', 'DETAILS_JSON', 'CREATED_AT']
  })
});

function getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function getSpreadsheet_() {
  const id = getScriptProperties_().getProperty(DCE_CONFIG.PROPERTY_SPREADSHEET_ID);
  if (!id) throw new Error('Execute setupProject() antes de publicar o Web App.');
  return SpreadsheetApp.openById(id);
}

function getRootFolder_() {
  const id = getScriptProperties_().getProperty(DCE_CONFIG.PROPERTY_ROOT_FOLDER_ID);
  if (!id) throw new Error('Pasta raiz não configurada. Execute setupProject().');
  return DriveApp.getFolderById(id);
}
