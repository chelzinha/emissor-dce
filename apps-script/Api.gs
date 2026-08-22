function doGet() {
  return jsonOutput_({ ok: true, data: { name: DCE_CONFIG.APP_NAME, version: DCE_CONFIG.VERSION } });
}

function doPost(event) {
  try {
    const request = safeJsonParse_(event && event.postData && event.postData.contents, null);
    if (!request) throw new Error('Requisicao JSON invalida.');
    verifyApiToken_(request.token);
    const user = ensureUser_(request.user || {});
    const action = String(request.action || '');
    const handlers = {
      'system.health': function() { return systemHealth_(user); },
      'company.get': function() { return getCompany_(user.id); },
      'company.upsert': function() { return upsertCompany_(user.id, request.payload || {}); },
      'import.start': function() { return startImport_(user.id, request.payload || {}); },
      'import.append': function() { return appendImport_(user.id, request.payload || {}); },
      'import.finish': function() { return finishImport_(user.id, request.payload || {}); },
      'imports.list': function() { return listImports_(user.id); },
      'remittances.list': function() { return listRemittances_(user.id, request.payload || {}); },
      'remittances.update': function() { return updateRemittances_(user.id, request.payload || {}); },
      'batch.prepare': function() { return prepareBatch_(user.id, request.payload || {}); },
      'batch.get': function() { return getBatch_(user.id, request.payload || {}); },
      'batches.list': function() { return listBatches_(user.id); },
      'batch.saveResults': function() { return saveBatchResults_(user.id, request.payload || {}); },
      'dce.list': function() { return listDce_(user.id, request.payload || {}); },
      'dce.recordEvent': function() { return recordDceEvent_(user.id, request.payload || {}); },
      'campaign.upsert': function() { return upsertCampaign_(user.id, request.payload || {}); },
      'campaign.get': function() { return getCampaign_(user.id, request.payload || {}); },
      'campaigns.list': function() { return listCampaigns_(user.id); },
      'campaign.user.add': function() { return addCampaignUserStrict_(user.id, request.payload || {}); },
      'addressList.start': function() { return startAddressList_(user.id, request.payload || {}); },
      'addressList.append': function() { return appendAddressRows_(user.id, request.payload || {}); },
      'addressList.finish': function() { return finishAddressList_(user.id, request.payload || {}); },
      'addressLists.list': function() { return listAddressLists_(user.id, request.payload || {}); },
      'addressRows.list': function() { return listAddressRows_(user.id, request.payload || {}); },
      'addressRow.update': function() { return updateCleanAddressRowStrict_(user.id, request.payload || {}); },
      'cleaning.process': function() { return processCleaningBatchStrict_(user.id, request.payload || {}); },
      'portal.export': function() { return exportPortalPostalStrict_(user.id, request.payload || {}); },
      'portal.exports.list': function() { return listPortalExports_(user.id, request.payload || {}); },
      'portal.export.file': function() { return readPortalExportFile_(user.id, request.payload || {}); },
      'portalReturn.start': function() { return startPortalReturn_(user.id, request.payload || {}); },
      'portalReturn.append': function() { return appendPortalReturnObjects_(user.id, request.payload || {}); },
      'portalReturn.finish': function() { return finishPortalReturnStrict_(user.id, request.payload || {}); },
      'portalReturns.list': function() { return listPortalReturns_(user.id, request.payload || {}); },
      'postalObjects.list': function() { return listPostalObjectsStrict_(user.id, request.payload || {}); },
      'production.prepare': function() { return prepareProductionBatchStrict_(user.id, request.payload || {}); },
      'production.list': function() { return listProductionBatches_(user.id, request.payload || {}); },
      'volumes.list': function() { return listDeliveryVolumes_(user.id, request.payload || {}); },
      'volumes.handoff': function() { return handoffDeliveryVolumes_(user.id, request.payload || {}); },
      'operation.record': function() { return recordOperationEvent_(user.id, request.payload || {}); },
      'operations.list': function() { return listOperationEvents_(user.id, request.payload || {}); },
      'dashboard.daily': function() { return getDailySummary_(user.id, request.payload || {}); },
      'offlineSync.inspect': function() { return offlineSyncInspect_(user.id, request.payload || {}); },
      'offlineSync.start': function() { return offlineSyncStart_(user.id, request.payload || {}); },
      'offlineSync.append': function() { return offlineSyncAppend_(user.id, request.payload || {}); },
      'offlineSync.finish': function() { return offlineSyncFinish_(user.id, request.payload || {}); },
      'offlineSync.list': function() { return listOfflineSyncs_(user.id, request.payload || {}); },
      'client.dashboard': function() { return clientDashboard_(user.id, request.payload || {}); },
      'simulator.config': function() { return simulatorConfig_(user.id, request.payload || {}); },
      'simulator.quote': function() { return simulatorQuote_(user.id, request.payload || {}); },
      'simulator.version.start': function() { return startTariffVersion_(user.id, request.payload || {}); },
      'simulator.version.append': function() { return appendTariffRows_(user.id, request.payload || {}); },
      'simulator.version.activate': function() { return activateTariffVersion_(user.id, request.payload || {}); },
      'issuer.get': function() { return getIssuerProfile_(user.id, request.payload || {}); },
      'issuer.upsert': function() { return upsertIssuerProfile_(user.id, request.payload || {}); },
      'dcePrep.context': function() { return getDcePreparationContext_(user.id, request.payload || {}); },
      'dcePrep.objects': function() { return listDcePreparationObjects_(user.id, request.payload || {}); },
      'client.dce.prepareStart': function() { return startClientDcePreparation_(user.id, request.payload || {}); },
      'client.dce.prepareAppend': function() { return appendClientDceDocuments_(user.id, request.payload || {}); },
      'client.dce.prepareFinish': function() { return finishClientDcePreparation_(user.id, request.payload || {}); },
      'client.dce.pending': function() { return listClientDcePending_(user.id, request.payload || {}); },
      'client.dce.get': function() { return getClientDcePackage_(user.id, request.payload || {}); },
      'client.dce.saveResults': function() { return saveClientDceResults_(user.id, request.payload || {}); },
      'client.dce.file': function() { return readClientDceXmlFile_(user.id, request.payload || {}); },
      'production.dceLabelData': function() { return getDceLabelProductionData_(user.id, request.payload || {}); },
      'production.labelTest.approve': function() { return approveProductionLabelTest_(user.id, request.payload || {}); },
      'production.generation.confirm': function() { return confirmProductionGeneration_(user.id, request.payload || {}); },
      'production.print.confirm': function() { return confirmProductionPrint_(user.id, request.payload || {}); },
      'production.handoff.confirm': function() { return confirmProductionHandoff_(user.id, request.payload || {}); },
      'production.protocol.data': function() { return postingProtocolData_(user.id, request.payload || {}); },
      'production.postProduction.snapshot': function() { return postProductionSnapshot_(user.id, request.payload || {}); },
      'file.get': function() { return readOwnedXmlFile_(user.id, request.payload && request.payload.fileId); }
    };
    if (!handlers[action]) throw new Error('Acao nao suportada.');
    const data = handlers[action]();
    log_(user.id, action, 'INFO', 'Operacao concluida', {});
    return jsonOutput_({ ok: true, data: data });
  } catch (error) {
    const message = String(error && error.message || error || 'Erro inesperado').slice(0, 800);
    return jsonOutput_({ ok: false, error: message });
  }
}

function verifyApiToken_(provided) {
  const expected = getScriptProperties_().getProperty(DCE_CONFIG.PROPERTY_API_TOKEN);
  if (!expected) throw new Error('Token da API nao configurado. Execute setApiToken().');
  if (String(provided || '') !== expected) throw new Error('Acesso nao autorizado.');
}

function systemHealth_(user) {
  return {
    name: DCE_CONFIG.APP_NAME,
    version: DCE_CONFIG.VERSION,
    user: user,
    spreadsheetId: getSpreadsheet_().getId(),
    time: nowIso_()
  };
}
