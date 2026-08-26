import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const APP_URL = 'http://127.0.0.1:4173/eleicoes.html';
const TRACKING = 'AA123456789BR';
const CSV_HEADER = 'DESTINATARIO;CEP;ENDERECO;NUMERO;COMPLEMENTO;BAIRRO;CIDADE;UF;OBJETO';
const CSV_ROW = `ELEITOR TESTE;60000000;RUA TESTE;100;;CENTRO;FORTALEZA;CE;${TRACKING}`;

function baseState() {
  return {
    campaign: {
      id: 'campaign-1',
      name: 'Operação eleitoral teste',
      cnpj: '12345678000195',
      candidateName: 'CANDIDATO TESTE',
      profile: {
        sender: {
          name: 'COMITÊ ELEITORAL TESTE',
          document: '12345678000195',
          address: 'AVENIDA TESTE',
          number: '100',
          complement: 'SALA 1',
          district: 'CENTRO',
          city: 'FORTALEZA',
          state: 'CE',
          zip: '60000000',
        },
      },
    },
    campaigns: [],
    bases: [],
    portalExports: [],
    returns: [],
    batches: [
      {
        id: 'prod-finished', campaignId: 'campaign-1', status: 'FINISHED', service: 'PAC', quantity: 1,
        documentMode: 'SIMPLIFIED', sourcePortalReturnId: 'return-old', matrixVerified: true,
      },
    ],
    volumes: [{ id: 'vol-1', productionBatchId: 'prod-active', number: 1, total: 1, quantity: 1, service: 'SEDEX' }],
    labelSetup: null,
    matrixVerified: false,
    labelApproved: false,
    printed: 0,
    handedOff: false,
    unknownActions: [],
  };
}

function response(body) {
  return { ok: true, json: async () => ({ ok: true, ...body }) };
}

function installBackend(page) {
  const state = baseState();
  return page.addInitScript(({ state, tracking, header, row }) => {
    const originalFetch = window.fetch.bind(window);
    const reply = (payload) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, ...payload }),
      text: async () => JSON.stringify({ ok: true, ...payload }),
    });
    const gates = () => ({
      labelSetup: Boolean(state.labelSetup),
      matrixVerified: state.matrixVerified,
      dce: true,
      labelTest: state.labelApproved,
      printing: { printed: state.printed, total: 1, complete: state.printed >= 1 },
      handoff: state.handedOff,
    });
    const activeBatch = () => state.batches.find((item) => item.id === 'prod-active');

    async function action(name, params = {}) {
      switch (name) {
        case 'health': return { status: 'ok' };
        case 'auth.session': return { authenticated: true, user: { name: 'Teste', role: 'ADMIN' } };
        case 'campaign.list': return { campaigns: [state.campaign] };
        case 'campaign.get': return { campaign: state.campaign };
        case 'operation.settings.get': return { campaign: state.campaign };
        case 'base.list': return { bases: state.bases };
        case 'base.receive': {
          state.bases = [{
            id: 'base-1', campaignId: state.campaign.id, filename: params.filename || 'SEDEX_250_26.08.csv',
            status: 'RECEIVED', quantity: 250, receivedAt: new Date().toISOString(),
          }];
          return { base: state.bases[0] };
        }
        case 'base.prepare': {
          state.bases[0].status = 'READY';
          state.bases[0].service = 'SEDEX';
          return { base: state.bases[0] };
        }
        case 'base.export': {
          const content = [header, row].join('\n');
          const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`;
          state.portalExports = [{
            id: 'export-1', campaignId: state.campaign.id, baseId: 'base-1', filename: 'portal-sedex-250.csv',
            service: 'SEDEX', quantity: 250, dataUrl, createdAt: new Date().toISOString(),
          }];
          return { files: state.portalExports };
        }
        case 'portal.export.list': return { exports: state.portalExports };
        case 'portal.return.list': return { returns: state.returns };
        case 'portal.return.create': {
          state.returns = [{
            id: 'return-1', campaignId: state.campaign.id, service: 'SEDEX', quantity: 1,
            status: 'READY', matrixVerified: true, createdAt: new Date().toISOString(),
          }];
          return { portalReturn: state.returns[0] };
        }
        case 'label.setup.get': return { setup: state.labelSetup };
        case 'label.setup.save': {
          state.labelSetup = { ...params, campaignId: state.campaign.id, fontScale: Number(params.fontScale || 1) };
          return { setup: state.labelSetup };
        }
        case 'production.list': return { batches: state.batches };
        case 'production.prepare': {
          if (!activeBatch()) state.batches.unshift({
            id: 'prod-active', campaignId: state.campaign.id, sourcePortalReturnId: 'return-1',
            status: 'READY_FOR_UNIFIED_LABEL', service: 'SEDEX', quantity: 1, documentMode: 'SIMPLIFIED',
          });
          return { batch: activeBatch() };
        }
        case 'production.gates': return { gates: gates() };
        case 'production.matrix.verify': {
          state.matrixVerified = true;
          return { gates: gates() };
        }
        case 'production.labelTest.data': return { trackingCode: tracking };
        case 'production.labelTest.approve': {
          if (String(params.readTrackingCode || '').replace(/\s/g, '') !== tracking) throw new Error('SRO divergente');
          state.labelApproved = true;
          return { gates: gates() };
        }
        case 'production.volumes': return { volumes: state.volumes };
        case 'production.print.confirm': {
          state.printed += Number(params.quantity || 0);
          return { gates: gates() };
        }
        case 'production.handoff': {
          state.handedOff = true;
          return { gates: gates() };
        }
        case 'production.documents.test': return {
          trackingCode: tracking,
          object: {
            trackingCode: tracking,
            service: 'SEDEX',
            recipient: {
              name: 'ELEITOR TESTE', address: 'RUA TESTE', number: '100', complement: '', district: 'CENTRO',
              city: 'FORTALEZA', state: 'CE', zip: '60000000', document: '12345678901',
            },
            sender: state.campaign.profile.sender,
            content: 'PANFLETOS E ADESIVOS DA CAMPANHA',
            quantity: 1,
          },
          campaign: state.campaign,
        };
        case 'production.documents.volume': return {
          volume: state.volumes[0], objects: [(await action('production.documents.test')).object], campaign: state.campaign,
        };
        case 'internal.delivery.list': return { deliveries: [] };
        case 'internal.delivery.link': return { delivery: { id: 'delivery-1', status: 'PLANNED' } };
        case 'internal.delivery.confirm': {
          state.handedOff = true;
          return { delivery: { id: 'delivery-1', status: 'DELIVERED' } };
        }
        case 'tracking.summary': return { summary: { total: 1, delivered: 0, inTransit: 1, exceptions: 0 }, objects: [] };
        case 'report.operation': return { summary: { total: 1, printed: state.printed, handedOff: state.handedOff }, rows: [] };
        default:
          state.unknownActions.push(name);
          return {};
      }
    }

    window.__E2E_STATE__ = state;
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!url.includes('script.google.com') && !url.includes('/exec')) return originalFetch(input, init);
      const body = init?.body ? JSON.parse(init.body) : {};
      try {
        const result = await action(body.action, body.params || body);
        return reply(result);
      } catch (error) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ ok: false, error: error.message }),
          text: async () => JSON.stringify({ ok: false, error: error.message }),
        });
      }
    };
  }, { state, tracking: TRACKING, header: CSV_HEADER, row: CSV_ROW }).then(() => ({ state }));
}

async function clickStage(page, number) {
  await page.locator(`[data-operation-stage="${number}"]`).click();
  await expect(page.locator('#elections-app')).toHaveAttribute('data-operation-stage', String(number));
}

async function inspectPdfDownload(download, pages) {
  const path = await download.path();
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path));
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(pages);
  const [page] = pdf.getPages();
  const { width, height } = page.getSize();
  expect(width).toBeGreaterThan(280);
  expect(width).toBeLessThan(290);
  expect(height).toBeGreaterThan(420);
  expect(height).toBeLessThan(430);
}

test.use({ acceptDownloads: true });
test.setTimeout(240_000);

test('usuário percorre o fluxo completo e gera etiquetas 10x15 sem voltar de etapa', async ({ page }) => {
  const backend = await installBackend(page);
  await page.goto(APP_URL);
  await expect(page.getByText('Passo a passo da operação')).toBeVisible();

  await clickStage(page, 1);
  const file = {
    name: 'SEDEX_250_26.08.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([CSV_HEADER, CSV_ROW].join('\n')),
  };
  await page.locator('#base-file').setInputFiles(file);
  await expect(page.getByText('SEDEX_250_26.08.csv')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Preparar base' }).click();
  await expect(page.getByRole('button', { name: 'Gerar CSV para o Portal Postal' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Gerar CSV para o Portal Postal' }).click();
  await expect(page.getByText('Arquivos prontos para o Portal Postal.')).toBeVisible();

  await clickStage(page, 2);
  await expect(page.getByRole('link', { name: /Baixar/ })).toBeVisible();

  await clickStage(page, 3);
  await page.locator('#portal-return-csv').setInputFiles({
    name: 'retorno.csv', mimeType: 'text/csv', buffer: Buffer.from([CSV_HEADER, CSV_ROW].join('\n')),
  });
  await page.locator('#portal-return-pdfs').setInputFiles({
    name: 'etiqueta.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await PDFDocument.create().then(async (pdf) => {
      const page = pdf.addPage([288, 432]);
      page.drawText(TRACKING, { x: 20, y: 400, size: 12 });
      return pdf.save();
    })),
  });

  await clickStage(page, 4);
  const overlay = page.locator('[data-region-overlay]');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  await overlay.dispatchEvent('pointerdown', { clientX: 80, clientY: 80, pointerId: 1 });
  await overlay.dispatchEvent('pointermove', { clientX: 180, clientY: 180, pointerId: 1 });
  await overlay.dispatchEvent('pointerup', { clientX: 180, clientY: 180, pointerId: 1 });
  await page.locator('[data-postage-mark]').setInputFiles({
    name: 'chancela.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4i8AAAAASUVORK5CYII=', 'base64'),
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
  await expect(activeCard.locator('.production-gate').filter({ hasText: 'Impressão' }).locator('strong')).toContainText('1/1', { timeout: 30_000 });

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