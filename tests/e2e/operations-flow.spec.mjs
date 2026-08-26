import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';

const APP_URL = 'http://localhost:4173/eleicoes.html';
const MM = 72 / 25.4;
const TRACKING = 'OY855189152BR';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4i8AAAAASUVORK5CYII=',
  'base64',
);

function makeBaseCsv(total = 250) {
  const header = 'NOME;CPF;CEP;ENDEREÇO;NUMERO;COMPLEMENTO;BAIRRO;CIDADE;UF';
  const rows = Array.from({ length: total }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0');
    return `DESTINATARIO ${suffix};52998224725;60000001;RUA TESTE;${index + 1};;CENTRO;FORTALEZA;CE`;
  });
  return [header, ...rows].join('\r\n');
}

function makeReturnCsv() {
  return [
    'OBJETO;SERVICO;DESTINATARIO;CPF_CNPJ;ENDERECO;NUM;BAIRRO;CIDADE;UF;CEP;CONTEUDO;CODIGO_PP',
    `${TRACKING};SEDEX;CLIENTE TESTE;52998224725;RUA DOIS;20;CENTRO;FORTALEZA;CE;60000001;PANFLETOS;4817042`,
  ].join('\r\n');
}

async function makePortalPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([100 * MM, 150 * MM]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText(TRACKING, { x: 16 * MM, y: 92 * MM, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText('SEDEX', { x: 18 * MM, y: 132 * MM, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText('IMP', { x: 86 * MM, y: 51 * MM, size: 7, font, color: rgb(0, 0, 0) });

  const x = 36.5 * MM;
  const yTop = 4.2 * MM;
  const w = 24.5 * MM;
  const h = 14 * MM;
  const y = 150 * MM - yTop - h;
  page.drawRectangle({ x, y, width: w, height: h, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 14; col += 1) {
      if ((row * 3 + col * 5) % 7 < 3) {
        page.drawRectangle({
          x: x + col * (w / 14),
          y: y + row * (h / 8),
          width: w / 14,
          height: h / 8,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
  return Buffer.from(await pdf.save());
}

function publicAddressList(row) {
  return {
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    total: row.rows.length,
    ready: row.rows.filter((item) => item.status === 'READY').length,
    review: row.rows.filter((item) => item.status === 'REVIEW').length,
    rejected: 0,
  };
}

function makeBackend() {
  const campaign = {
    id: 'camp-1',
    name: 'ELEIÇÃO 2026 ANDRÉ FERNANDES',
    candidateName: 'ANDRÉ FERNANDES',
    cnpj: '68403698000120',
    office: 'DEPUTADO FEDERAL',
    status: 'ACTIVE',
    profile: {
      sender: {
        name: 'ELEICAO 2026 ANDRE FERNANDES',
        document: '68403698000120',
        address: {
          street: 'RUA JOAO CORDEIRO', number: '1644', complement: 'AP 1703',
          district: 'ALDEOTA', city: 'FORTALEZA', uf: 'CE', zip: '60110190',
        },
      },
      internalDeliveries: [],
    },
  };

  const state = {
    campaign,
    addressLists: [],
    portalExports: [],
    portalReturns: [],
    pendingReturnRows: [],
    productions: [],
    volumes: [],
    operations: [],
    matrixVerified: false,
    labelApproved: false,
    printed: 0,
    handedOff: false,
    unknownActions: [],
  };

  function portalCsv(rows, service, content) {
    const headers = [
      'NOME', 'EMPRESA', 'CPF', 'CEP', 'ENDEREÇO', 'NUMERO', 'COMPLEMENTO', 'BAIRRO', 'CIDADE', 'UF',
      'AOS_CUIDADOS', 'NOTA_FISCAL', 'SERVICO', 'SERV_ADICIONAIS', 'VALOR_DECLARADO', 'OBSERVAÇÕES',
      'CONTEUDO', 'DDD', 'TELEFONE', 'EMAIL', 'IDENTIFICADOR_CLIENTE (chave do cliente)', 'PESO', 'ALTURA',
      'LARGURA', 'COMPRIMENTO', 'ENTREGA_VIZINHO', 'RFID', 'CHAVE_NOTA_FISCAL',
    ];
    const lines = rows.map((row) => {
      const source = row.original || {};
      return [
        source.NOME || '', '', source.CPF || '', source.CEP || '', source['ENDEREÇO'] || source.ENDERECO || '',
        source.NUMERO || '', source.COMPLEMENTO || '', source.BAIRRO || '', source.CIDADE || '', source.UF || '',
        '', '', service, '', '', '', content, '', '', '', '', '0,300', '2', '11', '16', '', '', '',
      ].map((value) => String(value).replaceAll(';', ',')).join(';');
    });
    return `\uFEFF${headers.join(';')}\r\n${lines.join('\r\n')}`;
  }

  function gates() {
    return {
      status: 'READY_FOR_UNIFIED_LABEL',
      documentMode: 'SIMPLIFIED_DECLARATION',
      total: 1,
      printed: state.printed,
      printRemaining: Math.max(0, 1 - state.printed),
      printComplete: state.printed >= 1,
      matrixVerified: state.matrixVerified,
      labelTestApproved: state.labelApproved,
      testTrackingCode: TRACKING,
      handedOff: state.handedOff,
      receivedBy: state.handedOff ? 'OPERACAO TESTE' : '',
    };
  }

  async function action(name, payload = {}) {
    switch (name) {
      case 'campaigns.list': return [state.campaign];
      case 'campaign.get': return state.campaign;
      case 'campaign.upsert': {
        state.campaign = {
          ...state.campaign,
          ...payload,
          profile: payload.profile || state.campaign.profile,
        };
        return state.campaign;
      }
      case 'addressLists.list': return state.addressLists.map(publicAddressList).reverse();
      case 'addressList.start': {
        const row = { id: `base-${state.addressLists.length + 1}`, fileName: payload.fileName, status: 'UPLOADING', rows: [] };
        state.addressLists.push(row);
        return { id: row.id, chunkSize: 200 };
      }
      case 'addressList.append': {
        const list = state.addressLists.find((row) => row.id === payload.addressListId);
        const start = list.rows.length;
        payload.rows.forEach((original, index) => list.rows.push({
          id: `${list.id}-row-${start + index + 1}`,
          rowNumber: start + index + 1,
          status: 'RAW',
          original,
          cleaned: original,
          issues: [],
          portalExportId: '',
        }));
        return { appended: payload.rows.length };
      }
      case 'addressList.finish': {
        const list = state.addressLists.find((row) => row.id === payload.addressListId);
        list.status = 'RECEIVED';
        return publicAddressList(list);
      }
      case 'addressList.abort': return { aborted: true };
      case 'addressRows.list': {
        const list = state.addressLists.find((row) => row.id === payload.addressListId);
        return (list?.rows || [])
          .filter((row) => !payload.status || row.status === payload.status)
          .slice(0, Number(payload.limit || 200));
      }
      case 'cleaning.process': {
        const list = state.addressLists.find((row) => row.id === payload.addressListId);
        const ids = new Set((payload.rowIds || []).map(String));
        let processed = 0;
        for (const row of list?.rows || []) {
          if (!ids.has(String(row.id))) continue;
          row.status = 'READY';
          row.cleaned = {
            ...row.original,
            SERVICO: payload.defaults?.service || row.original.SERVICO || '',
            CONTEUDO: payload.defaults?.content || row.original.CONTEUDO || '',
          };
          processed += 1;
        }
        if (list) list.status = 'CLEANING';
        return { id: `clean-${Date.now()}`, summary: { processed, ready: processed, review: 0, rejected: 0 } };
      }
      case 'portal.export': {
        const list = state.addressLists.find((row) => row.id === payload.addressListId);
        const rows = (list?.rows || []).filter((row) => row.status === 'READY' && !row.portalExportId);
        const id = `export-${state.portalExports.length + 1}`;
        const csv = portalCsv(rows, payload.service, payload.content);
        const record = {
          ID: id,
          ADDRESS_LIST_ID: payload.addressListId,
          SERVICE: payload.service,
          STATUS: 'EXPORTED',
          TOTAL_ROWS: rows.length,
          FILE_NAME: `portal_postal_${payload.service}_${rows.length}.csv`,
          FILE_ID: `file-${id}`,
          SHA256: 'abc123',
          csv,
        };
        rows.forEach((row) => { row.portalExportId = id; });
        if (list) list.status = 'EXPORTED';
        state.portalExports.unshift(record);
        state.operations.push({ type: 'PORTAL_CSV_EXPORTED', quantity: rows.length, service: payload.service, occurredAt: new Date().toISOString() });
        return { id, service: payload.service, total: rows.length, fileName: record.FILE_NAME, fileId: record.FILE_ID, sha256: record.SHA256, csv };
      }
      case 'portal.exports.list': return state.portalExports;
      case 'portal.export.file': {
        const record = state.portalExports.find((row) => String(row.ID) === String(payload.exportId));
        return { fileName: record.FILE_NAME, content: record.csv };
      }
      case 'portalReturns.list': return state.portalReturns;
      case 'portalReturn.start': {
        state.pendingReturnRows = [];
        state.portalReturns = [{
          ID: 'return-1', STATUS: 'UPLOADING', CSV_FILE_NAME: payload.csvFileName,
          CSV_SHA256: payload.csvSha256, TOTAL_ROWS: 0, PAC_ROWS: 0, SEDEX_ROWS: 0, INVALID_ROWS: 0,
        }];
        return { id: 'return-1', chunkSize: 200 };
      }
      case 'portalReturn.append': {
        state.pendingReturnRows.push(...payload.rows);
        return { appended: payload.rows.length };
      }
      case 'portalReturn.finish': {
        const pac = state.pendingReturnRows.filter((row) => row.service === 'PAC').length;
        const sedex = state.pendingReturnRows.filter((row) => row.service === 'SEDEX').length;
        const matrix = {
          matched: state.pendingReturnRows.length,
          autoVerified: 0,
          verified: 0,
          textOnly: state.pendingReturnRows.length,
          manualReview: 0,
          missing: 0,
          divergent: 0,
        };
        const record = {
          ID: 'return-1', STATUS: 'READY', CSV_FILE_NAME: 'retorno_sedex.csv', CSV_SHA256: 'returnsha',
          TOTAL_ROWS: state.pendingReturnRows.length, PAC_ROWS: pac, SEDEX_ROWS: sedex, INVALID_ROWS: 0,
          MATRIX_SUMMARY_JSON: matrix,
        };
        state.portalReturns = [record];
        state.operations.push({ type: 'PORTAL_RETURN_IMPORTED', quantity: record.TOTAL_ROWS, occurredAt: new Date().toISOString() });
        return { id: record.ID, status: record.STATUS, total: record.TOTAL_ROWS, pac, sedex, invalid: 0, matrix };
      }
      case 'postalObjects.list': return [];
      case 'production.prepare': {
        state.portalReturns = state.portalReturns.map((row) => ({ ...row, STATUS: 'IN_PRODUCTION' }));
        state.productions = [
          {
            ID: 'prod-active', PORTAL_RETURN_ID: 'return-1', DOCUMENT_MODE: payload.documentMode,
            STATUS: 'READY_FOR_UNIFIED_LABEL', TOTAL: 1, PAC: 0, SEDEX: 1,
            MATRIX_SUMMARY_JSON: { matched: 1, textOnly: 1, missing: 0, divergent: 0 },
          },
          {
            ID: 'prod-finished', PORTAL_RETURN_ID: 'return-old', DOCUMENT_MODE: 'SIMPLIFIED_DECLARATION',
            STATUS: 'FINISHED', TOTAL: 548, PAC: 548, SEDEX: 0,
          },
        ];
        state.volumes = [{
          id: 'vol-1', productionBatchId: 'prod-active', number: 1, totalVolumes: 1,
          service: 'SEDEX', quantity: 1, trackingCodes: [TRACKING], status: 'PLANNED',
        }];
        return { id: 'prod-active', total: 1, volumes: state.volumes };
      }
      case 'production.list': return state.productions;
      case 'production.gates': return gates();
      case 'volumes.list': {
        if (!payload.productionBatchId) return state.volumes;
        return state.volumes.filter((row) => row.productionBatchId === payload.productionBatchId);
      }
      case 'operation.record': {
        state.operations.push({ ...payload, occurredAt: new Date().toISOString() });
        if (payload.type === 'MATRIX_100_VERIFIED') state.matrixVerified = true;
        return { recorded: true };
      }
      case 'operations.list': return state.operations;
      case 'production.documents.test': return {
        productionBatchId: 'prod-active',
        portalReturnId: 'return-1',
        documentMode: 'SIMPLIFIED_DECLARATION',
        trackingCode: TRACKING,
        object: {
          trackingCode: TRACKING,
          service: 'SEDEX',
          recipient: {
            name: 'CLIENTE TESTE', document: '52998224725', documentType: 'CPF',
            address: { street: 'RUA DOIS', number: '20', complement: '', district: 'CENTRO', city: 'FORTALEZA', uf: 'CE', zip: '60000001' },
          },
          content: 'PANFLETOS E ADESIVOS DA CAMPANHA', reference: '4817042', accessKey: '', protocol: '', postal: { CODIGO_PP: '4817042' }, matrix: { stripe: 'IMP' },
        },
        campaign: state.campaign,
      };
      case 'production.documents.volume': return {
        productionBatchId: 'prod-active', portalReturnId: 'return-1', documentMode: 'SIMPLIFIED_DECLARATION',
        volume: state.volumes[0], objects: [(await action('production.documents.test')).object], campaign: state.campaign,
      };
      case 'production.labelTest.data': return { trackingCode: TRACKING };
      case 'production.labelTest.approve': {
        if (String(payload.readTrackingCode).replaceAll(' ', '').toUpperCase() !== TRACKING) throw new Error('SRO divergente.');
        state.labelApproved = true;
        state.operations.push({ type: 'LABEL_TEST_APPROVED', quantity: 1, occurredAt: new Date().toISOString() });
        return { approved: true };
      }
      case 'production.print.confirm': {
        state.printed = Math.min(1, state.printed + Number(payload.quantity || 0));
        state.operations.push({ type: 'LABEL_PRINTED', quantity: Number(payload.quantity || 0), service: 'SEDEX', occurredAt: new Date().toISOString() });
        return { printed: state.printed };
      }
      case 'production.handoff.confirm': {
        state.handedOff = true;
        state.operations.push({ type: 'LABEL_HANDOFF', quantity: 1, service: 'SEDEX', occurredAt: new Date().toISOString() });
        return { handedOff: true };
      }
      case 'tracking.summary': return {
        updatedAt: '',
        pac: { posted: 0, awaitingUpdate: 0, inTransit: 0, outForDelivery: 0, delivered: 0, exception: 0, returning: 0, returned: 0 },
        sedex: { posted: 0, awaitingUpdate: 0, inTransit: 0, outForDelivery: 0, delivered: 0, exception: 0, returning: 0, returned: 0 },
        total: { posted: 0, awaitingUpdate: 0, inTransit: 0, outForDelivery: 0, delivered: 0, exception: 0, returning: 0, returned: 0 },
      };
      case 'tracking.events.list': return [];
      default:
        state.unknownActions.push(name);
        throw new Error(`Mock sem ação: ${name}`);
    }
  }

  return { state, action };
}

async function installBackend(page, backend) {
  await page.route('**/.netlify/identity/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.route('**/api/operations-data', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    try {
      const data = await backend.action(body.action, body.payload || {});
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
    } catch (error) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: error.message }) });
    }
  });
}

async function clickStage(page, number) {
  const button = page.locator(`[data-operation-stage="${number}"]`).first();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('#elections-app')).toHaveAttribute('data-operation-stage', String(number));
}

async function inspectPdfDownload(download, expectedPages = 1) {
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const bytes = await fs.readFile(filePath);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(expectedPages);
  for (const page of pdf.getPages()) {
    expect(Math.abs(page.getWidth() - (100 * MM))).toBeLessThan(0.5);
    expect(Math.abs(page.getHeight() - (150 * MM))).toBeLessThan(0.5);
  }
}

test('usuário percorre o fluxo completo e gera etiquetas 10x15 sem voltar de etapa', async ({ page }) => {
  test.setTimeout(240_000);
  const backend = makeBackend();
  await installBackend(page, backend);
  await page.goto(APP_URL);
  await expect(page.getByText('Passo a passo da operação')).toBeVisible();

  await clickStage(page, 1);
  await page.locator('#base-file').setInputFiles({
    name: 'SEDEX_250_26.08.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(makeBaseCsv(250), 'utf8'),
  });
  await page.locator('#upload-base').click();
  await expect(page.getByText('SEDEX_250_26.08.csv')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#portal-export-list')).toBeVisible();
  await expect(page.locator('#portal-export-service')).toHaveValue('SEDEX');

  const [portalDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#portal-export-run').click(),
  ]);
  expect(await portalDownload.suggestedFilename()).toMatch(/portal_postal_SEDEX_250\.csv/i);
  await expect(page.getByText('Arquivos prontos para o Portal Postal.')).toBeVisible();

  await clickStage(page, 2);
  await expect(page.getByText('portal_postal_SEDEX_250.csv')).toBeVisible();

  const sourcePdf = await makePortalPdf();
  await clickStage(page, 3);
  await page.locator('#portal-return-csv').setInputFiles({
    name: 'retorno_sedex.csv', mimeType: 'text/csv', buffer: Buffer.from(makeReturnCsv(), 'utf8'),
  });
  await page.locator('#portal-return-pdfs').setInputFiles({
    name: 'etiquetas_sedex.pdf', mimeType: 'application/pdf', buffer: sourcePdf,
  });

  await clickStage(page, 4);
  await page.locator('#configure-portal-label').click();
  const overlay = page.locator('[data-region-overlay]');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  const box = await overlay.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width * 0.365, box.y + box.height * 0.042);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.61, box.y + box.height * 0.182);
  await page.mouse.up();
  await page.locator('[data-postage-mark]').setInputFiles({
    name: 'chancela.png', mimeType: 'image/png', buffer: PNG_1X1,
  });
  await page.locator('[data-font-scale]').fill('0.80');
  await page.locator('[data-save-setup]').click();
  await expect(page.locator('#portal-label-setup-status')).toContainText('Configuração pronta');

  await clickStage(page, 5);
  await page.locator('#analyze-portal-return').click();
  await expect(page.getByText('1 objetos encontrados')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('PRONTO PARA REGISTRO')).toBeVisible();
  await page.locator('#save-portal-return').click();
  await expect(page.getByText(/Retorno registrado:/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_200);

  await clickStage(page, 6);
  await expect(page.getByRole('button', { name: 'Gerar Declaração Simplificada' })).toBeVisible();
  await page.getByRole('button', { name: 'Gerar Declaração Simplificada' }).click();
  await expect(page.locator('[data-volumes="prod-active"]')).toBeVisible({ timeout: 30_000 });

  const activeCard = page.locator('[data-volumes="prod-active"]').locator('xpath=ancestor::article[contains(@class,"card")]');
  const finishedCard = page.locator('[data-volumes="prod-finished"]').locator('xpath=ancestor::article[contains(@class,"card")]');
  await expect(activeCard.locator('.production-ops-gates')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await expect(finishedCard.locator('.production-ops-gates')).toHaveCount(0);
  await expect(finishedCard.locator('.production-documents')).toHaveCount(0);

  await expect(activeCard.locator('[data-generate-test]')).toBeVisible({ timeout: 30_000 });
  const [testLabelDownload] = await Promise.all([
    page.waitForEvent('download'),
    activeCard.locator('[data-generate-test]').click(),
  ]);
  await inspectPdfDownload(testLabelDownload, 1);

  await expect(activeCard.locator('[data-op="test"]')).toBeVisible({ timeout: 30_000 });
  await activeCard.locator('[data-op="test"]').click();
  await expect(page.locator('[data-label-test-dialog]')).toBeVisible();
  await page.locator('[data-label-test-input]').fill(TRACKING);
  await page.locator('[data-label-test-confirm]').click();
  await expect(page.locator('[data-label-test-dialog]')).toHaveCount(0);
  await expect(page.locator('#elections-app')).toHaveAttribute('data-operation-stage', '7');
  await expect(page.locator('[data-volumes="prod-active"]')).toBeVisible();

  await clickStage(page, 8);
  await expect(activeCard.locator('[data-generate-volume="vol-1"]')).toBeVisible({ timeout: 30_000 });
  const [volumeDownload] = await Promise.all([
    page.waitForEvent('download'),
    activeCard.locator('[data-generate-volume="vol-1"]').click(),
  ]);
  await inspectPdfDownload(volumeDownload, 1);

  page.once('dialog', (dialog) => dialog.accept('1'));
  await activeCard.locator('[data-op="print"]').click();
  await expect(activeCard.getByText('1/1')).toBeVisible({ timeout: 30_000 });

  await clickStage(page, 9);
  await expect(page.getByRole('heading', { name: 'Entrega à operação' })).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-delivery-batch][value="prod-active"]').check();
  await page.locator('#link-internal-delivery').click();
  await expect(page.getByText('Entrega vinculada')).toBeVisible();
  await page.locator('#internal-delivery-received').fill('OPERACAO TESTE');
  await page.locator('[data-confirm-internal-delivery]').click();
  await expect(page.getByText(/Entrega à operação confirmada/)).toBeVisible();

  await clickStage(page, 10);
  await expect(page.getByRole('heading', { name: 'Rastreamento e fechamento' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.notice.warn')).toHaveCount(0);

  await clickStage(page, 11);
  await expect(page.getByRole('heading', { name: 'Fechamento operacional' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.notice.warn')).toHaveCount(0);
  expect(backend.state.unknownActions).toEqual([]);
});
