function publicDceLabelRow_(item, postalObject) {
  const document = safeJsonParse_(item.DOCUMENT_JSON, {});
  const items = Array.isArray(document.items) ? document.items.map(function(source) {
    const quantity = Number(source.quantity || 0);
    const unitValue = Number(source.unitValue || 0);
    return {
      description: String(source.description || ''), ncm: digits_(source.ncm || ''),
      quantity: quantity, unitValue: unitValue,
      totalValue: Number((quantity * unitValue).toFixed(2)),
      additionalInfo: String(source.additionalInfo || '')
    };
  }) : [];
  return {
    id: String(item.ID || ''), postalObjectId: String(item.POSTAL_OBJECT_ID || ''),
    trackingCode: String(item.TRACKING_CODE || ''), service: String(item.SERVICE || ''), status: String(item.STATUS || ''),
    matrixStatus: String(postalObject.MATRIX_STATUS || ''),
    accessKey: digits_(item.ACCESS_KEY || ''), protocol: String(item.PROTOCOL || ''), qrCode: String(item.QR_CODE || ''),
    cStat: String(item.CSTAT || ''), authorizedAt: String(item.AUTHORIZED_AT || ''),
    identification: document.identification || {}, issuer: document.issuer || {}, recipient: document.recipient || {},
    items: items, content: items.length ? String(items[0].description || '') : String(postalObject.CONTENT || ''),
    reference: String(postalObject.REFERENCE || document.additionalInfo || ''),
    additionalInfo: String(document.additionalInfo || '')
  };
}

function validateDceLabelRow_(row) {
  const errors = [];
  const tracking = String(row.trackingCode || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{9}BR$/.test(tracking)) errors.push('SRO_INVALIDO');
  if (['PAC', 'SEDEX'].indexOf(String(row.service || '')) === -1) errors.push('SERVICO_INVALIDO');
  if (String(row.status || '') !== 'AUTHORIZED') errors.push('DCE_NAO_AUTORIZADA');
  if (['AUTO_VERIFIED', 'VERIFIED'].indexOf(String(row.matrixStatus || '')) === -1) errors.push('MATRIX_NAO_VERIFICADO');
  if (!/^\d{44}$/.test(digits_(row.accessKey || ''))) errors.push('CHAVE_DCE_INVALIDA');
  if (!String(row.protocol || '').trim()) errors.push('PROTOCOLO_DCE_AUSENTE');
  const qr = String(row.qrCode || '').trim();
  if (!/^https:\/\//i.test(qr)) errors.push('QRCODE_DCE_AUSENTE');
  if (qr && row.accessKey && qr.indexOf(String(row.accessKey)) === -1) errors.push('QRCODE_DCE_DIVERGENTE');
  if (!row.issuer || !isValidCnpj_(row.issuer.cnpj)) errors.push('EMITENTE_DCE_INVALIDO');
  if (!row.recipient || !String(row.recipient.name || '').trim()) errors.push('DESTINATARIO_DCE_AUSENTE');
  if (!Array.isArray(row.items) || !row.items.length) errors.push('ITENS_DCE_AUSENTES');
  return errors;
}

function getDceLabelProductionData_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const batch = dceProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  if (String(batch.DOCUMENT_MODE || '') !== 'DCE_AUTHORIZED') throw new Error('Este lote nao utiliza DC-e.');
  if (['READY_FOR_LABEL_TEST', 'DCE_AUTHORIZED'].indexOf(String(batch.STATUS || '')) === -1) {
    throw new Error('A autorizacao da DC-e ainda nao foi concluida para 100% do lote.');
  }
  const pkg = findRow_('DCE_AUTH_PACKAGES', function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.PRODUCTION_BATCH_ID) === productionBatchId;
  });
  if (!pkg) throw new Error('Pacote de autorizacao DC-e nao encontrado.');
  if (String(pkg.STATUS || '') !== 'AUTHORIZED') throw new Error('Pacote DC-e ainda nao esta integralmente autorizado.');
  const items = clientDceItems_(campaignId, pkg.ID).sort(function(a, b) { return Number(a.SEQUENCE || 0) - Number(b.SEQUENCE || 0); });
  const expected = Number(pkg.TOTAL || batch.TOTAL || 0);
  if (!items.length || items.length !== expected) throw new Error('Quantidade de DC-es autorizadas diverge do lote de producao.');
  const postalObjects = dceProductionObjects_(campaignId, productionBatchId);
  const byId = {};
  postalObjects.forEach(function(row) { byId[String(row.ID)] = row; });
  const allRows = items.map(function(item) {
    const postalObject = byId[String(item.POSTAL_OBJECT_ID)];
    if (!postalObject) throw new Error('Objeto postal da DC-e nao encontrado: ' + item.TRACKING_CODE);
    if (String(postalObject.TRACKING_CODE) !== String(item.TRACKING_CODE)) throw new Error('SRO divergente entre DC-e e objeto postal.');
    if (String(postalObject.SERVICE) !== String(item.SERVICE)) throw new Error('Servico divergente entre DC-e e objeto postal.');
    const row = publicDceLabelRow_(item, postalObject);
    const errors = validateDceLabelRow_(row);
    if (errors.length) throw new Error('DC-e ' + row.trackingCode + ' nao pode gerar etiqueta: ' + errors.join(', ') + '.');
    return row;
  });
  const offset = Math.max(0, Number(payload.offset || 0));
  const limit = Math.max(1, Math.min(250, Number(payload.limit || 250)));
  const rows = allRows.slice(offset, offset + limit);
  return {
    campaignId: campaignId,
    batch: {
      id: String(batch.ID), status: String(batch.STATUS || ''), documentMode: String(batch.DOCUMENT_MODE || ''),
      total: Number(batch.TOTAL || allRows.length), pac: Number(batch.PAC || 0), sedex: Number(batch.SEDEX || 0),
      portalReturnId: String(batch.PORTAL_RETURN_ID || '')
    },
    package: {
      id: String(pkg.ID), status: String(pkg.STATUS || ''), environment: String(pkg.ENVIRONMENT || '2'),
      total: Number(pkg.TOTAL || allRows.length), authorized: Number(pkg.AUTHORIZED || 0),
      series: Number(pkg.SERIES || 0), firstNumber: Number(pkg.FIRST_NUMBER || 0), lastNumber: Number(pkg.LAST_NUMBER || 0)
    },
    total: allRows.length, offset: offset, limit: limit, rows: rows
  };
}
