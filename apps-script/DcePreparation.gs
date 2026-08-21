function dceProductionBatch_(campaignId, productionBatchId) {
  return findRow_('PRODUCTION_BATCHES', function(row) {
    return String(row.ID) === String(productionBatchId) && String(row.CAMPAIGN_ID) === String(campaignId);
  });
}

function dceProductionObjects_(campaignId, productionBatchId) {
  return sheetRows_(getSheet_('POSTAL_OBJECTS')).filter(function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId)
      && String(row.PRODUCTION_BATCH_ID) === String(productionBatchId);
  });
}

function postalSourceIdentifier_(postal, reference) {
  const raw = postal || {};
  const candidates = [
    reference,
    raw.IDENTIFICADOR_CLIENTE_CHAVE_DO_CLIENTE,
    raw.IDENTIFICADOR_CLIENTE,
    raw.CUSTOMER_ID,
    raw.CODIGO_CLIENTE
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const value = String(candidates[index] || '').trim();
    if (value) return value;
  }
  return '';
}

function fiscalSourceAddress_(campaignId, postalObject) {
  const postal = safeJsonParse_(postalObject.POSTAL_JSON, {});
  const sourceId = postalSourceIdentifier_(postal, postalObject.REFERENCE);
  if (!sourceId) return null;
  const direct = findRow_('ADDRESS_ROWS', function(row) {
    return String(row.CAMPAIGN_ID) === String(campaignId) && String(row.ID) === sourceId;
  });
  if (direct) return safeJsonParse_(direct.CLEANED_JSON, {});
  return null;
}

function publicDcePreparationObject_(campaignId, row) {
  const recipient = safeJsonParse_(row.RECIPIENT_JSON, {});
  const address = recipient.address || {};
  const source = fiscalSourceAddress_(campaignId, row) || {};
  const cityCode = digits_(address.cityCode || source.cityCode || source.codigoIbge || source.COD_IBGE || '');
  const recipientDocument = digits_(recipient.document || source.cpf || source.CPF || source.cnpj || source.CNPJ || '');
  return {
    id: String(row.ID || ''), trackingCode: String(row.TRACKING_CODE || ''), service: String(row.SERVICE || ''),
    status: String(row.STATUS || ''), matrixStatus: String(row.MATRIX_STATUS || ''), content: String(row.CONTENT || ''),
    reference: String(row.REFERENCE || ''),
    recipient: {
      name: String(recipient.name || source.name || source.NOME || ''),
      document: recipientDocument,
      address: {
        street: String(address.street || source.street || source.ENDERECO || ''),
        number: String(address.number || source.number || source.NUMERO || ''),
        complement: String(address.complement || source.complement || source.COMPLEMENTO || ''),
        district: String(address.district || source.district || source.BAIRRO || ''),
        city: String(address.city || source.city || source.CIDADE || ''),
        uf: String(address.uf || source.uf || source.UF || '').toUpperCase(),
        zip: digits_(address.zip || source.zip || source.CEP || ''),
        cityCode: cityCode,
        countryCode: '1058', country: 'BRASIL',
        phone: digits_(address.phone || source.phone || source.TELEFONE || ''),
        email: String(address.email || source.email || source.EMAIL || '')
      }
    }
  };
}

function getDcePreparationContext_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const batch = dceProductionBatch_(campaignId, productionBatchId);
  if (!batch) throw new Error('Lote de producao nao encontrado.');
  if (String(batch.DOCUMENT_MODE) !== 'DCE_AUTHORIZED') throw new Error('Este lote nao utiliza DC-e.');
  const objects = dceProductionObjects_(campaignId, productionBatchId);
  const pkg = findRow_('DCE_AUTH_PACKAGES', function(row) {
    return String(row.CAMPAIGN_ID) === campaignId && String(row.PRODUCTION_BATCH_ID) === productionBatchId;
  });
  return {
    campaignId: campaignId,
    batch: {
      id: String(batch.ID), status: String(batch.STATUS || ''), total: Number(batch.TOTAL || objects.length),
      pac: Number(batch.PAC || 0), sedex: Number(batch.SEDEX || 0), documentMode: String(batch.DOCUMENT_MODE || '')
    },
    issuerProfile: publicIssuerProfile_(issuerProfileForCampaign_(campaignId)),
    package: pkg ? publicClientDcePackage_(pkg) : null,
    objectCount: objects.length,
    matrixVerified: objects.filter(function(row) { return ['AUTO_VERIFIED', 'VERIFIED'].indexOf(String(row.MATRIX_STATUS)) !== -1; }).length
  };
}

function listDcePreparationObjects_(userId, payload) {
  const campaignId = String(payload.campaignId || '');
  const productionBatchId = String(payload.productionBatchId || '');
  requireCampaignAccess_(campaignId, userId, ['AGENCY_ADMIN']);
  const batch = dceProductionBatch_(campaignId, productionBatchId);
  if (!batch || String(batch.DOCUMENT_MODE) !== 'DCE_AUTHORIZED') throw new Error('Lote DC-e nao encontrado.');
  const rows = dceProductionObjects_(campaignId, productionBatchId);
  const offset = Math.max(0, Number(payload.offset || 0));
  const limit = Math.max(1, Math.min(250, Number(payload.limit || 250)));
  return {
    total: rows.length, offset: offset, limit: limit,
    rows: rows.slice(offset, offset + limit).map(function(row) { return publicDcePreparationObject_(campaignId, row); })
  };
}
