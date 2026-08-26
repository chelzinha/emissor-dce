export async function installOperationsBackend(page, { state, tracking, header, row }) {
  const csvContent = [header, row].join('\n');
  state.addressLists ||= [];
  state.addressRows ||= [];
  state.portalExports ||= [];
  state.returns ||= [];
  state.operations ||= [];

  const normalizeCode = (value) => String(value || '').replace(/\s/g, '').toUpperCase();
  const activeBatch = () => state.batches.find((item) => String(item.id || item.ID) === 'prod-active');
  const volume = () => {
    const current = state.volumes[0] || {};
    return {
      id: current.id || 'vol-1',
      productionBatchId: current.productionBatchId || 'prod-active',
      number: Number(current.number || 1),
      totalVolumes: Number(current.totalVolumes || current.total || 1),
      quantity: Number(current.quantity || 1),
      service: current.service || 'SEDEX',
      trackingCodes: current.trackingCodes || [tracking],
    };
  };
  const sender = () => {
    const source = state.campaign.profile?.sender || {};
    const address = source.address && typeof source.address === 'object'
      ? source.address
      : {
          street: source.address || 'AVENIDA TESTE',
          number: source.number || '100',
          complement: source.complement || 'SALA 1',
          district: source.district || 'CENTRO',
          city: source.city || 'FORTALEZA',
          uf: source.state || source.uf || 'CE',
          zip: source.zip || '60000000',
        };
    return {
      name: source.name || 'COMITÊ ELEITORAL TESTE',
      document: source.document || '12345678000195',
      address: {
        street: address.street || address.address || 'AVENIDA TESTE',
        number: address.number || '100',
        complement: address.complement || 'SALA 1',
        district: address.district || 'CENTRO',
        city: address.city || 'FORTALEZA',
        uf: address.uf || address.state || 'CE',
        zip: address.zip || '60000000',
      },
    };
  };
  const gates = () => ({
    status: 'READY_FOR_UNIFIED_LABEL',
    documentMode: 'SIMPLIFIED_DECLARATION',
    labelSetup: Boolean(state.labelSetup),
    matrixVerified: Boolean(state.matrixVerified),
    dce: true,
    labelTest: Boolean(state.labelApproved),
    labelTestApproved: Boolean(state.labelApproved),
    testTrackingCode: tracking,
    printing: { printed: Number(state.printed || 0), total: 1, complete: Number(state.printed || 0) >= 1 },
    printed: Number(state.printed || 0),
    total: 1,
    printRemaining: Math.max(0, 1 - Number(state.printed || 0)),
    printComplete: Number(state.printed || 0) >= 1,
    handoff: Boolean(state.handedOff),
    handedOff: Boolean(state.handedOff),
    receivedBy: state.receivedBy || '',
  });
  const object = () => ({
    trackingCode: tracking,
    service: 'SEDEX',
    recipient: {
      name: 'ELEITOR TESTE',
      address: 'RUA TESTE',
      number: '100',
      complement: '',
      district: 'CENTRO',
      city: 'FORTALEZA',
      state: 'CE',
      zip: '60000000',
      document: '12345678901',
    },
    sender: sender(),
    content: 'PANFLETOS E ADESIVOS DA CAMPANHA',
    quantity: 1,
  });

  async function action(name, params = {}) {
    switch (name) {
      case 'health': return { status: 'ok' };
      case 'auth.session': return { authenticated: true, user: { name: 'Teste', role: 'ADMIN' } };
      case 'campaigns.list': return [state.campaign];
      case 'campaign.list': return [state.campaign];
      case 'campaign.get': return state.campaign;
      case 'campaign.upsert': {
        state.campaign = { ...state.campaign, ...params, profile: params.profile || state.campaign.profile };
        return state.campaign;
      }
      case 'operation.settings.get': return state.campaign;
      case 'addressLists.list': return state.addressLists;
      case 'base.list': return state.addressLists;
      case 'addressList.start': {
        state.pendingAddressList = {
          id: 'base-1',
          fileName: params.fileName || 'SEDEX_250_26.08.csv',
          rows: [],
        };
        return { id: 'base-1', chunkSize: 200 };
      }
      case 'addressList.append': {
        state.pendingAddressList ||= { id: params.addressListId || 'base-1', fileName: 'SEDEX_250_26.08.csv', rows: [] };
        state.pendingAddressList.rows.push(...(params.rows || []));
        return { appended: (params.rows || []).length };
      }
      case 'addressList.finish': {
        const pending = state.pendingAddressList || { id: 'base-1', fileName: 'SEDEX_250_26.08.csv', rows: [{ OBJETO: tracking }] };
        state.addressRows = pending.rows.map((entry, index) => ({
          id: `row-${index + 1}`,
          rowNumber: index + 1,
          status: 'RAW',
          original: entry,
          cleaned: { ...entry, trackingCode: entry.OBJETO || entry.OBJETO_POSTAL || tracking },
        }));
        const total = state.addressRows.length || 1;
        state.addressLists = [{
          id: pending.id,
          fileName: pending.fileName,
          status: 'RECEIVED',
          total,
          ready: 0,
          review: 0,
        }];
        delete state.pendingAddressList;
        return state.addressLists[0];
      }
      case 'addressList.abort': return { aborted: true };
      case 'addressRows.list': {
        const status = String(params.status || '').toUpperCase();
        const limit = Number(params.limit || 500);
        return state.addressRows.filter((entry) => entry.status === status).slice(0, limit);
      }
      case 'addressRow.update': return { status: 'READY', issues: [] };
      case 'cleaning.process': {
        const requested = new Set((params.rowIds || []).map(String));
        const candidates = state.addressRows.filter((entry) => entry.status === 'RAW' && (!requested.size || requested.has(String(entry.id))));
        candidates.forEach((entry) => { entry.status = 'READY'; });
        const list = state.addressLists.find((entry) => String(entry.id) === String(params.addressListId || 'base-1'));
        if (list) {
          list.ready = state.addressRows.filter((entry) => entry.status === 'READY').length;
          list.review = 0;
          list.status = list.ready >= list.total ? 'READY' : 'RECEIVED';
        }
        return { summary: { processed: candidates.length, ready: candidates.length, review: 0, rejected: 0 } };
      }
      case 'portal.export': {
        const total = Math.max(1, state.addressRows.filter((entry) => entry.status === 'READY').length || state.addressRows.length);
        const record = {
          ID: 'export-1', id: 'export-1',
          ADDRESS_LIST_ID: params.addressListId || 'base-1', addressListId: params.addressListId || 'base-1',
          FILE_NAME: 'portal-sedex-250.csv', fileName: 'portal-sedex-250.csv',
          SERVICE: params.service || 'SEDEX', service: params.service || 'SEDEX',
          TOTAL_ROWS: total, total,
          SHA256: 'e2e-sha256',
          csv: csvContent,
        };
        state.portalExports = [record];
        return record;
      }
      case 'portal.export.file': return { content: csvContent, fileName: 'portal-sedex-250.csv' };
      case 'portal.exports.list': return state.portalExports;
      case 'portal.export.list': return state.portalExports;
      case 'portalReturns.list': return state.returns;
      case 'portal.return.list': return state.returns;
      case 'postalObjects.list': return [];
      case 'portalReturn.start': {
        state.pendingReturn = { id: 'return-1', rows: [], csvFileName: params.csvFileName || 'retorno.csv' };
        return { id: 'return-1', chunkSize: 200 };
      }
      case 'portalReturn.append': {
        state.pendingReturn ||= { id: params.portalReturnId || 'return-1', rows: [], csvFileName: 'retorno.csv' };
        state.pendingReturn.rows.push(...(params.rows || []));
        return { appended: (params.rows || []).length };
      }
      case 'portalReturn.finish': {
        const total = Math.max(1, state.pendingReturn?.rows?.length || 1);
        const saved = {
          ID: 'return-1', id: 'return-1',
          STATUS: 'READY', status: 'READY',
          TOTAL_ROWS: total, total,
          PAC_ROWS: 0, pac: 0,
          SEDEX_ROWS: total, sedex: total,
          INVALID_ROWS: 0, invalid: 0,
          CSV_FILE_NAME: state.pendingReturn?.csvFileName || 'retorno.csv',
          portalExportId: params.portalExportId || 'export-1',
        };
        state.returns = [saved];
        delete state.pendingReturn;
        return saved;
      }
      case 'label.setup.get': return state.labelSetup;
      case 'label.setup.save': {
        state.labelSetup = { ...params, campaignId: state.campaign.id, fontScale: Number(params.fontScale || 1) };
        return state.labelSetup;
      }
      case 'production.list': return state.batches;
      case 'production.prepare': {
        if (!activeBatch()) {
          state.batches.unshift({
            ID: 'prod-active', id: 'prod-active',
            CAMPAIGN_ID: state.campaign.id, campaignId: state.campaign.id,
            PORTAL_RETURN_ID: params.portalReturnId || 'return-1', portalReturnId: params.portalReturnId || 'return-1',
            STATUS: 'READY_FOR_UNIFIED_LABEL', status: 'READY_FOR_UNIFIED_LABEL',
            SERVICE: 'SEDEX', service: 'SEDEX',
            TOTAL: 1, total: 1, quantity: 1,
            PAC: 0, SEDEX: 1,
            DOCUMENT_MODE: params.documentMode || 'SIMPLIFIED_DECLARATION', documentMode: params.documentMode || 'SIMPLIFIED_DECLARATION',
          });
        }
        return activeBatch();
      }
      case 'production.gates': return gates();
      case 'production.matrix.verify':
      case 'production.matrix.confirm': {
        state.matrixVerified = true;
        return gates();
      }
      case 'production.labelTest.data': return { trackingCode: tracking };
      case 'production.labelTest.approve': {
        if (normalizeCode(params.readTrackingCode) !== normalizeCode(tracking)) throw new Error('SRO divergente');
        state.labelApproved = true;
        return gates();
      }
      case 'volumes.list': return [volume()];
      case 'production.volumes': return [volume()];
      case 'production.print.confirm': {
        state.printed = Math.min(1, Number(state.printed || 0) + Number(params.quantity || 0));
        return gates();
      }
      case 'production.handoff.confirm':
      case 'production.handoff': {
        state.handedOff = true;
        state.receivedBy = params.receivedBy || 'OPERACAO TESTE';
        return gates();
      }
      case 'production.documents.test': return {
        status: 'READY_FOR_UNIFIED_LABEL',
        operation: { id: state.campaign.id, name: state.campaign.name, cnpj: state.campaign.cnpj, candidateName: state.campaign.candidateName },
        portalReturnId: 'return-1',
        documentMode: 'SIMPLIFIED_DECLARATION',
        volume: null,
        gates: gates(),
        senderIssues: [],
        objects: [object()],
      };
      case 'production.documents.volume': return {
        status: 'READY_FOR_UNIFIED_LABEL',
        operation: { id: state.campaign.id, name: state.campaign.name, cnpj: state.campaign.cnpj, candidateName: state.campaign.candidateName },
        portalReturnId: 'return-1',
        documentMode: 'SIMPLIFIED_DECLARATION',
        volume: volume(),
        gates: gates(),
        senderIssues: [],
        objects: [object()],
      };
      case 'operation.record': {
        state.operations.push({ ...params, id: `op-${state.operations.length + 1}`, occurredAt: new Date().toISOString() });
        return state.operations[state.operations.length - 1];
      }
      case 'operations.list': return state.operations;
      case 'tracking.summary': return {
        total: 1,
        delivered: 0,
        inTransit: 1,
        exceptions: 0,
        summary: { total: 1, delivered: 0, inTransit: 1, exceptions: 0 },
        objects: [],
      };
      case 'tracking.refresh': return { updated: 1 };
      case 'tracking.closure': return { ready: true, pending: 0 };
      case 'operation.closure.get': return { status: 'OPEN', ready: true, pending: 0 };
      case 'operation.closure.finish': return { status: 'CLOSED' };
      case 'report.operation': return { summary: { total: 1, printed: state.printed, handedOff: state.handedOff }, rows: [] };
      default:
        state.unknownActions.push(name);
        return {};
    }
  }

  await page.route('**/api/operations-data', async (route) => {
    const request = route.request();
    let body = {};
    try { body = request.postDataJSON() || {}; } catch {}
    try {
      const result = await action(body.action, body.payload || body.params || {});
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true, data: result }),
      });
    } catch (error) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: false, error: error.message || String(error) }),
      });
    }
  });

  return { state };
}
