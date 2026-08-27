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
    const payload = request.payload || {};
    guardClosedCampaignAction_(action, payload);
    const handlers = {
      'system.health': function() { return systemHealth_(user); },
      'company.get': function() { return getCompany_(user.id); },
      'company.upsert': function() { return upsertCompany_(user.id, payload); },
      'import.start': function() { return startImport_(user.id, payload); },
      'import.append': function() { return appendImport_(user.id, payload); },
      'import.finish': function() { return finishImport_(user.id, payload); },
      'imports.list': function() { return listImports_(user.id); },
      'remittances.list': function() { return listRemittances_(user.id, payload); },
      'remittances.update': function() { return updateRemittances_(user.id, payload); },
      'batch.prepare': function() { return prepareBatch_(user.id, payload); },
      'batch.get': function() { return getBatch_(user.id, payload); },
      'batches.list': function() { return listBatches_(user.id); },
      'batch.saveResults': function() { return saveBatchResults_(user.id, payload); },
      'dce.list': function() { return listDce_(user.id, payload); },
      'dce.recordEvent': function() { return recordDceEvent_(user.id, payload); },
      'campaign.upsert': function() { return upsertCampaign_(user.id, payload); },
      'campaign.get': function() { return getCampaign_(user.id, payload); },
      'campaigns.list': function() { return listCampaigns_(user.id); },
      'campaign.user.add': function() { return addCampaignUser_(user.id, payload); },
      'addressList.start': function() { return startAddressList_(user.id, payload); },
      'addressList.append': function() { return appendAddressRows_(user.id, payload); },
      'addressList.finish': function() { return finishAddressList_(user.id, payload); },
      'addressLists.list': function() { return listAddressLists_(user.id, payload); },
      'addressRows.list': function() { return listAddressRows_(user.id, payload); },
      'addressRow.update': function() { return updateCleanAddressRow_(user.id, payload); },
      'cleaning.process': function() { return processCleaningBatch_(user.id, payload); },
      'portal.export': function() { return exportPortalPostalSafe_(user.id, payload); },
      'portal.exports.list': function() { return listPortalExports_(user.id, payload); },
      'portal.export.file': function() { return readPortalExportFile_(user.id, payload); },
      'portalReturn.start': function() { return startPortalReturn_(user.id, payload); },
      'portalReturn.append': function() { return appendPortalReturnObjects_(user.id, payload); },
      'portalReturn.finish': function() { return finishPortalReturn_(user.id, payload); },
      'portalReturns.list': function() { return listPortalReturns_(user.id, payload); },
      'postalObjects.list': function() { return listPostalObjects_(user.id, payload); },
      'production.prepare': function() { return prepareProductionBatchSafe_(user.id, payload); },
      'production.list': function() { return listProductionBatches_(user.id, payload); },
      'volumes.list': function() { return listDeliveryVolumes_(user.id, payload); },
      'production.gates': function() { return productionGates_(user.id, payload); },
      'production.matrix.confirm': function() { return confirmProductionMatrix_(user.id, payload); },
      'production.labelTest.data': function() { return productionLabelTestData_(user.id, payload); },
      'production.labelTest.approve': function() { return approveProductionLabelTest_(user.id, payload); },
      'production.print.confirm': function() { return confirmProductionPrint_(user.id, payload); },
      'production.handoff.confirm': function() { return confirmProductionHandoff_(user.id, payload); },
      'production.protocol.data': function() { return productionProtocolData_(user.id, payload); },
      'production.documents.test': function() { return productionDocumentsTest_(user.id, payload); },
      'production.documents.volume': function() { return productionDocumentsVolumeData_(user.id, payload); },
      'production.posting.list': function() { return listProductionPosting_(user.id, payload); },
      'production.posting.confirm': function() { return confirmProductionPostingSafe_(user.id, payload); },
      'productionDce.list': function() { return listProductionDce_(user.id, payload); },
      'productionDce.preflight': function() { return preflightProductionDce_(user.id, payload); },
      'productionDce.reserve': function() { return reserveProductionDce_(user.id, payload); },
      'productionDce.syncResults': function() { return syncProductionDceResults_(user.id, payload); },
      'postalRates.start': function() { return startPostalRateTable_(user.id, payload); },
      'postalRates.append': function() { return appendPostalRateRows_(user.id, payload); },
      'postalRates.finish': function() { return finishPostalRateTable_(user.id, payload); },
      'postalRates.list': function() { return listPostalRateTables_(user.id, payload); },
      'postalRates.quote': function() { return quotePostalRates_(user.id, payload); },
      'tracking.updates.append': function() { return trackingAppendUpdatesSafe_(user.id, payload); },
      'tracking.summary': function() { return trackingSummary_(user.id, payload); },
      'tracking.events.list': function() { return trackingEventsList_(user.id, payload); },
      'tracking.objects.list': function() { return trackingObjectsList_(user.id, payload); },
      'tracking.geo.summary': function() { return trackingGeoSummary_(user.id, payload); },
      'finance.import.start': function() { return financeImportStart_(user.id, payload); },
      'finance.import.append': function() { return financeImportAppend_(user.id, payload); },
      'finance.import.finish': function() { return financeImportFinish_(user.id, payload); },
      'finance.imports.list': function() { return financeImportsList_(user.id, payload); },
      'finance.summary': function() { return financeSummary_(user.id, payload); },
      'finance.charges.list': function() { return financeChargesList_(user.id, payload); },
      'finance.payment.record': function() { return financePaymentRecord_(user.id, payload); },
      'finance.payments.list': function() { return financePaymentsList_(user.id, payload); },
      'operation.record': function() { return recordOperationEvent_(user.id, payload); },
      'operations.list': function() { return listOperationEvents_(user.id, payload); },
      'operation.closure.status': function() { return operationClosureStatus_(user.id, payload); },
      'operation.closure.close': function() { return operationClosureClose_(user.id, payload); },
      'operation.closure.reopen': function() { return operationClosureReopen_(user.id, payload); },
      'dashboard.daily': function() { return getDailySummary_(user.id, payload); },
      'historical.reset': function() { return historicalReset_(user.id, payload); },
      'historical.campaign': function() { return historicalCampaign_(user.id, payload); },
      'historical.addresses': function() { return historicalAddresses_(user.id, payload); },
      'historical.lot': function() { return historicalLot_(user.id, payload); },
      'historical.tracking': function() { return historicalTracking_(user.id, payload); },
      'historical.events': function() { return historicalEvents_(user.id, payload); },
      'historical.finance': function() { return historicalFinance_(user.id, payload); },
      'historical.finalize': function() { return historicalFinalize_(user.id, payload); },
      'file.get': function() { return readOwnedXmlFile_(user.id, payload && payload.fileId); }
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
