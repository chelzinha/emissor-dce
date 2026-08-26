import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const portalReturnUi = fs.readFileSync(new URL('../src/elections-portal-return-ui.js', import.meta.url), 'utf8');
const portalReturnService = fs.readFileSync(new URL('../src/portal-return-service.js', import.meta.url), 'utf8');
const productionOps = fs.readFileSync(new URL('../src/elections-production-ops-ui.js', import.meta.url), 'utf8');
const productionDocs = fs.readFileSync(new URL('../src/elections-production-documents-ui.js', import.meta.url), 'utf8');
const generator = fs.readFileSync(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../src/production-label-layout-v13.js', import.meta.url), 'utf8');
const assets = fs.readFileSync(new URL('../src/portal-assets.js', import.meta.url), 'utf8');

test('retorno exige configuracao visual antes da auditoria', () => {
  assert.match(portalReturnUi, /Configurar modelo da etiqueta/);
  assert.match(portalReturnUi, /configureLabelSetup/);
  assert.match(portalReturnUi, /region: currentLabelSetup\.matrixRegion/);
  assert.match(portalReturnUi, /postageMarkName/);
  assert.match(portalReturnUi, /disabled>4\. Auditar CSV \+ PDF/);
});

test('configuracao fica vinculada aos PDFs originais do retorno', () => {
  assert.match(assets, /labelSetup: labelSetup \|\| null/);
  assert.match(assets, /updatePortalReturnLabelSetup/);
  assert.match(assets, /labelSetupConfigured/);
});

test('producao reaproveita regiao manual e bloqueia ate haver chancela', () => {
  assert.match(productionOps, /Modelo da etiqueta/);
  assert.match(productionOps, /Configurar Data Matrix e chancela/);
  assert.match(productionOps, /region: assets\.labelSetup\.matrixRegion/);
  assert.match(productionDocs, /Configure primeiro a área do Data Matrix e a chancela/);
});

test('etiqueta final usa a chancela real e nao o placeholder antigo', () => {
  assert.match(generator, /postageMarkDataUrl/);
  assert.match(generator, /assets\?\.labelSetup\?\.matrixRegion/);
  assert.match(layout, /fitImage\(page, pdf, postageMarkDataUrl/);
  assert.doesNotMatch(layout, /'CHANCELA'/);
  assert.doesNotMatch(layout, /'CLIENTE'/);
});

test('producao recupera associacoes quebradas somente para lote operacional', () => {
  assert.match(productionOps, /gatesWithRecovery/);
  assert.match(productionOps, /production\.prepare/);
  assert.match(productionOps, /Quantidade de objetos do lote diverge do total registrado/);
  assert.match(productionOps, /isOperationalBatchStatus\(batchRecordStatus\(batch\)\)/);
  assert.match(productionDocs, /gatesWithRecovery/);
});

test('declaracao simplificada gera etiqueta unificada e exige remetente completo', () => {
  assert.match(productionDocs, /Etiqueta unificada \+ Declaração Simplificada/);
  assert.match(productionDocs, /Gerar PDF unificado/);
  assert.match(productionDocs, /Configurar remetente da etiqueta/);
  assert.match(productionDocs, /campaign\.upsert/);
  assert.match(productionDocs, /senderReady/);
});

test('retorno do Portal retoma falha sem criar nova copia do mesmo CSV', () => {
  assert.match(portalReturnService, /existingReturnForAnalysis/);
  assert.match(portalReturnService, /resumeUploadingReturn/);
  assert.match(portalReturnService, /portalReturns\.list/);
  assert.match(portalReturnService, /Retorno já registrado/);
});
