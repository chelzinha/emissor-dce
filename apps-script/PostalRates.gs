function postalRateDigits_(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function postalRateMoney_(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = String(value == null ? '' : value).trim().replace(/[^0-9,.-]/g, '');
  if (!text) return NaN;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\.(?=.*\.)/g, '');
  }
  return Number(text);
}

function postalRateNumber_(value) {
  const number = Number(String(value == null ? '' : value).trim().replace(',', '.'));
  return Number.isFinite(number) ? number : NaN;
}

function postalRateDate_(value, label, optional) {
  const text = String(value || '').trim();
  if (!text && optional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(label + ' deve estar no formato AAAA-MM-DD.');
  return text;
}

function normalizePostalRateRow_(source) {
  const row = source || {};
  const service = String(row.SERVICO || row.SERVICE || row.servico || row.service || '').trim().toUpperCase();
  const zipStart = postalRateDigits_(row.CEP_INICIAL || row.ZIP_START || row.cepInicial || row.zipStart);
  const zipEnd = postalRateDigits_(row.CEP_FINAL || row.ZIP_END || row.cepFinal || row.zipEnd || zipStart);
  const weightFrom = postalRateNumber_(row.PESO_INICIAL_G || row.WEIGHT_FROM_G || row.pesoInicialG || row.weightFromG || 1);
  const weightTo = postalRateNumber_(row.PESO_FINAL_G || row.WEIGHT_TO_G || row.pesoFinalG || row.weightToG);
  const price = postalRateMoney_(row.PRECO || row.PRICE || row.preco || row.price);
  const deadlineDays = postalRateNumber_(row.PRAZO_DIAS || row.DEADLINE_DAYS || row.prazoDias || row.deadlineDays);
  const region = String(row.REGIAO || row.REGION || row.regiao || row.region || '').trim().slice(0, 120);
  const issues = [];
  if (['PAC', 'SEDEX'].indexOf(service) === -1) issues.push('SERVICO deve ser PAC ou SEDEX.');
  if (!/^\d{8}$/.test(zipStart) || !/^\d{8}$/.test(zipEnd)) issues.push('CEP_INICIAL e CEP_FINAL devem ter 8 digitos.');
  if (/^\d{8}$/.test(zipStart) && /^\d{8}$/.test(zipEnd) && Number(zipStart) > Number(zipEnd)) issues.push('CEP_INICIAL nao pode ser maior que CEP_FINAL.');
  if (!(weightFrom >= 0) || !(weightTo > 0) || weightFrom > weightTo) issues.push('Faixa de peso invalida.');
  if (!(price >= 0)) issues.push('PRECO invalido.');
  if (!Number.isInteger(deadlineDays) || deadlineDays < 0 || deadlineDays > 365) issues.push('PRAZO_DIAS invalido.');
  return {
    issues: issues,
    row: {
      service: service,
      zipStart: zipStart,
      zipEnd: zipEnd,
      weightFrom: weightFrom,
      weightTo: weightTo,
      price: Math.round(price * 100) / 100,
      deadlineDays: deadlineDays,
      region: region
    }
  };
}

function postalRateSpecificity_(row) {
  return (Number(row.ZIP_END) - Number(row.ZIP_START)) * 1000000000 + (Number(row.WEIGHT_TO_G) - Number(row.WEIGHT_FROM_G));
}

function findPostalRateMatch_(rows, service, destinationZip, weightG) {
  const zipNumber = Number(postalRateDigits_(destinationZip));
  const weight = Number(weightG);
  const matches = (rows || []).filter(function(row) {
    return String(row.SERVICE).toUpperCase() === String(service).toUpperCase()
      && zipNumber >= Number(row.ZIP_START)
      && zipNumber <= Number(row.ZIP_END)
      && weight >= Number(row.WEIGHT_FROM_G)
      && weight <= Number(row.WEIGHT_TO_G);
  });
  matches.sort(function(a, b) { return postalRateSpecificity_(a) - postalRateSpecificity_(b); });
  return matches[0] || null;
}

function startPostalRateTable_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const name = String(payload.name || 'Tabela a vista').trim().slice(0, 160);
  const originZip = postalRateDigits_(payload.originZip);
  if (!name) throw new Error('Informe o nome da tabela.');
  if (!/^\d{8}$/.test(originZip)) throw new Error('CEP de origem deve ter 8 digitos.');
  const validFrom = postalRateDate_(payload.validFrom, 'Vigencia inicial', false);
  const validTo = postalRateDate_(payload.validTo, 'Vigencia final', true);
  if (validTo && validTo < validFrom) throw new Error('Vigencia final nao pode ser anterior a inicial.');
  const id = uuid_();
  const now = nowIso_();
  appendObjects_('POSTAL_RATE_TABLES', [{
    ID: id, CAMPAIGN_ID: campaignId, NAME: name, STATUS: 'UPLOADING', ORIGIN_ZIP: originZip,
    VALID_FROM: validFrom, VALID_TO: validTo, TOTAL_ROWS: 0, CREATED_BY: userId, CREATED_AT: now, UPDATED_AT: now
  }]);
  return { id: id, chunkSize: DCE_CONFIG.MAX_RATE_CHUNK };
}

function appendPostalRateRows_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const tableId = String(payload.rateTableId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const table = findRow_('POSTAL_RATE_TABLES', function(row) {
    return String(row.ID) === tableId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!table) throw new Error('Tabela de tarifas nao encontrada.');
  if (String(table.STATUS) !== 'UPLOADING') throw new Error('Esta tabela nao esta aberta para importacao.');
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length || rows.length > DCE_CONFIG.MAX_RATE_CHUNK) throw new Error('Bloco de tarifas invalido.');
  const now = nowIso_();
  const normalized = rows.map(function(source, index) {
    const result = normalizePostalRateRow_(source);
    if (result.issues.length) throw new Error('Linha ' + (index + 1) + ': ' + result.issues.join(' '));
    const rate = result.row;
    return {
      ID: uuid_(), CAMPAIGN_ID: campaignId, RATE_TABLE_ID: tableId, SERVICE: rate.service,
      ZIP_START: rate.zipStart, ZIP_END: rate.zipEnd, WEIGHT_FROM_G: rate.weightFrom,
      WEIGHT_TO_G: rate.weightTo, PRICE: rate.price, DEADLINE_DAYS: rate.deadlineDays,
      REGION: rate.region, CREATED_AT: now
    };
  });
  appendObjects_('POSTAL_RATE_ROWS', normalized);
  const total = sheetRows_(getSheet_('POSTAL_RATE_ROWS')).filter(function(row) { return String(row.RATE_TABLE_ID) === tableId; }).length;
  updateRow_('POSTAL_RATE_TABLES', table._rowNumber, { TOTAL_ROWS: total, UPDATED_AT: now });
  return { appended: normalized.length, total: total };
}

function finishPostalRateTable_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const tableId = String(payload.rateTableId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const table = findRow_('POSTAL_RATE_TABLES', function(row) {
    return String(row.ID) === tableId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!table) throw new Error('Tabela de tarifas nao encontrada.');
  const rows = sheetRows_(getSheet_('POSTAL_RATE_ROWS')).filter(function(row) {
    return String(row.RATE_TABLE_ID) === tableId && String(row.CAMPAIGN_ID) === campaignId;
  });
  if (!rows.length) throw new Error('Importe pelo menos uma linha de tarifa.');
  if (!rows.some(function(row) { return String(row.SERVICE) === 'PAC'; })) throw new Error('A tabela precisa conter PAC.');
  if (!rows.some(function(row) { return String(row.SERVICE) === 'SEDEX'; })) throw new Error('A tabela precisa conter SEDEX.');
  const now = nowIso_();
  sheetRows_(getSheet_('POSTAL_RATE_TABLES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.STATUS) === 'ACTIVE' && String(row.ID) !== tableId;
  }).forEach(function(row) {
    updateRow_('POSTAL_RATE_TABLES', row._rowNumber, { STATUS: 'ARCHIVED', UPDATED_AT: now });
  });
  updateRow_('POSTAL_RATE_TABLES', table._rowNumber, { STATUS: 'ACTIVE', TOTAL_ROWS: rows.length, UPDATED_AT: now });
  return publicPostalRateTable_(findRow_('POSTAL_RATE_TABLES', function(row) { return String(row.ID) === tableId; }));
}

function publicPostalRateTable_(row) {
  if (!row) return null;
  return {
    id: String(row.ID), campaignId: String(row.CAMPAIGN_ID), name: String(row.NAME || ''),
    status: String(row.STATUS || ''), originZip: String(row.ORIGIN_ZIP || ''),
    validFrom: String(row.VALID_FROM || ''), validTo: String(row.VALID_TO || ''),
    totalRows: Number(row.TOTAL_ROWS || 0), createdAt: String(row.CREATED_AT || ''), updatedAt: String(row.UPDATED_AT || '')
  };
}

function listPostalRateTables_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  return sheetRows_(getSheet_('POSTAL_RATE_TABLES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId;
  }).map(publicPostalRateTable_).reverse();
}

function activePostalRateTable_(campaignId, quoteDate) {
  const date = String(quoteDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Fortaleza', 'yyyy-MM-dd'));
  return sheetRows_(getSheet_('POSTAL_RATE_TABLES')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.STATUS) === 'ACTIVE'
      && (!row.VALID_FROM || String(row.VALID_FROM) <= date)
      && (!row.VALID_TO || String(row.VALID_TO) >= date);
  }).sort(function(a, b) { return String(b.UPDATED_AT || '').localeCompare(String(a.UPDATED_AT || '')); })[0] || null;
}

function quotePostalRateService_(rows, service, destinationZip, weightG, quantity) {
  const match = findPostalRateMatch_(rows, service, destinationZip, weightG);
  if (!match) return { service: service, available: false, reason: 'Nenhuma faixa configurada para este CEP e peso.' };
  const unitPrice = Math.round(Number(match.PRICE) * 100) / 100;
  const totalPrice = Math.round(unitPrice * quantity * 100) / 100;
  return {
    service: service, available: true, unitPrice: unitPrice, totalPrice: totalPrice,
    deadlineDays: Number(match.DEADLINE_DAYS || 0), region: String(match.REGION || ''),
    zipRange: String(match.ZIP_START) + '-' + String(match.ZIP_END),
    weightRange: { from: Number(match.WEIGHT_FROM_G), to: Number(match.WEIGHT_TO_G) }
  };
}

function quotePostalRates_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  requireCampaignAccess_(campaignId, userId);
  const destinationZip = postalRateDigits_(payload.destinationZip || payload.zip);
  const weightG = Number(payload.weightG || payload.weight || 0);
  const quantity = Math.max(1, Math.min(1000000, Number(payload.quantity || 1)));
  if (!/^\d{8}$/.test(destinationZip)) throw new Error('CEP de destino deve ter 8 digitos.');
  if (!(weightG > 0 && weightG <= 100000)) throw new Error('Peso deve ser maior que zero e informado em gramas.');
  if (!Number.isInteger(quantity)) throw new Error('Quantidade deve ser um numero inteiro.');
  const table = activePostalRateTable_(campaignId, payload.quoteDate);
  if (!table) return { available: false, reason: 'Nenhuma tabela a vista vigente esta configurada para esta operacao.', quotes: [] };
  const rows = sheetRows_(getSheet_('POSTAL_RATE_ROWS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.RATE_TABLE_ID) === String(table.ID);
  });
  const services = payload.service && ['PAC', 'SEDEX'].indexOf(String(payload.service).toUpperCase()) !== -1
    ? [String(payload.service).toUpperCase()] : ['PAC', 'SEDEX'];
  return {
    available: true,
    table: publicPostalRateTable_(table),
    destinationZip: destinationZip,
    weightG: weightG,
    quantity: quantity,
    quotes: services.map(function(service) { return quotePostalRateService_(rows, service, destinationZip, weightG, quantity); })
  };
}
