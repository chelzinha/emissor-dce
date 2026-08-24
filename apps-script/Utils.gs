function nowIso_() {
  return new Date().toISOString();
}

function uuid_() {
  return Utilities.getUuid();
}

function numericCode_() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return String(parseInt(hex, 16) % 1000000).padStart(6, '0');
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeJsonParse_(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch (error) {
    return fallback;
  }
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(`Aba ${name} não encontrada. Execute setupProject().`);
  return sheet;
}

function headerMap_(sheet) {
  const width = sheet.getLastColumn();
  if (!width) return {};
  return sheet.getRange(1, 1, 1, width).getValues()[0].reduce(function(map, header, index) {
    map[String(header)] = index;
    return map;
  }, {});
}

function sheetRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues().map(function(row, index) {
    const record = { _rowNumber: index + 2 };
    headers.forEach(function(header, column) { record[String(header)] = row[column]; });
    return record;
  });
}

function appendObjects_(sheetName, records) {
  if (!records.length) return;
  const sheet = getSheet_(sheetName);
  const headers = DCE_CONFIG.SHEETS[sheetName];
  const values = records.map(function(record) {
    return headers.map(function(header) {
      const value = record[header];
      if (value == null) return '';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return text.charAt(0) === '=' ? `'${text}` : text;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function updateRow_(sheetName, rowNumber, changes) {
  const sheet = getSheet_(sheetName);
  const map = headerMap_(sheet);
  const width = sheet.getLastColumn();
  const row = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  Object.keys(changes).forEach(function(key) {
    if (map[key] == null) return;
    const raw = changes[key];
    const value = typeof raw === 'object' ? JSON.stringify(raw) : raw;
    row[map[key]] = value == null ? '' : value;
  });
  sheet.getRange(rowNumber, 1, 1, width).setValues([row]);
}

function findRow_(sheetName, predicate) {
  return sheetRows_(getSheet_(sheetName)).find(predicate) || null;
}

function rowsForUser_(sheetName, userId) {
  return sheetRows_(getSheet_(sheetName)).filter(function(row) {
    return String(row.USER_ID) === String(userId);
  });
}

function ensureUser_(user) {
  const userId = String(user.id || '').trim();
  const email = String(user.email || '').trim().toLowerCase();
  if (!userId) throw new Error('Usuário não identificado.');
  const row = findRow_('USERS', function(item) { return String(item.ID) === userId; });
  const now = nowIso_();
  if (!row) {
    appendObjects_('USERS', [{ ID: userId, EMAIL: email, STATUS: 'ACTIVE', CREATED_AT: now, UPDATED_AT: now }]);
  } else {
    if (String(row.STATUS) !== 'ACTIVE') throw new Error('Usuário bloqueado.');
    updateRow_('USERS', row._rowNumber, { EMAIL: email, UPDATED_AT: now });
  }
  return { id: userId, email: email };
}

function sanitizeFileName_(value) {
  return String(value || 'arquivo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'arquivo';
}

function getOrCreateFolder_(parent, name) {
  const safeName = sanitizeFileName_(name);
  const iterator = parent.getFoldersByName(safeName);
  return iterator.hasNext() ? iterator.next() : parent.createFolder(safeName);
}

function writeXmlFile_(userId, cnpj, fileName, content) {
  const userFolder = getOrCreateFolder_(getRootFolder_(), userId);
  const companyFolder = getOrCreateFolder_(userFolder, cnpj);
  const yearFolder = getOrCreateFolder_(companyFolder, String(new Date().getUTCFullYear()));
  return yearFolder.createFile(sanitizeFileName_(fileName), String(content), MimeType.XML).getId();
}

function readOwnedXmlFile_(userId, fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('Arquivo não informado.');
  const allowed = rowsForUser_('DCE', userId).some(function(row) {
    return [row.SIGNED_XML_FILE_ID, row.PROCESSED_XML_FILE_ID].some(function(value) {
      return String(value || '') === id;
    });
  });
  if (!allowed) throw new Error('Arquivo não pertence ao usuário autenticado.');
  const file = DriveApp.getFileById(id);
  return { id: id, name: file.getName(), content: file.getBlob().getDataAsString('UTF-8') };
}

function publicRecord_(row) {
  const copy = {};
  Object.keys(row || {}).forEach(function(key) {
    if (key !== '_rowNumber') copy[key] = row[key];
  });
  return copy;
}

function log_(userId, action, level, message, details) {
  appendObjects_('LOGS', [{
    ID: uuid_(), USER_ID: userId, ACTION: action, LEVEL: level,
    MESSAGE: String(message || '').slice(0, 1000),
    DETAILS_JSON: details || {}, CREATED_AT: nowIso_()
  }]);
}
