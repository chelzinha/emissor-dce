import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const generator = fs.readFileSync(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../src/production-label-layout-v13.js', import.meta.url), 'utf8');
const documents = fs.readFileSync(new URL('../apps-script/ProductionDocuments.gs', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../apps-script/Api.gs', import.meta.url), 'utf8');

test('declaração simplificada é identificada como operacional e não fiscal', () => {
  assert.match(layout, /DECLARAÇÃO SIMPLIFICADA DE CONTEÚDO/);
  assert.match(layout, /Não representa DC-e autorizada; não possui chave ou protocolo fiscal/);
  assert.match(layout, /finalidade operacional/);
});

test('DACE resumida exige dados reais do lote fiscal no backend', () => {
  assert.match(documents, /dce\.status !== 'AUTHORIZED'/);
  assert.match(documents, /\^\\d\{44\}\$/);
  assert.match(documents, /!dce\.protocol/);
  assert.match(layout, /DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA/);
  assert.match(layout, /MODALIDADE DE TRANSPORTE:/);
  assert.match(layout, /0 - CORREIOS/);
});

test('PDF de volume só é liberado após matriz e etiqueta teste', () => {
  assert.match(documents, /if \(!gates\.matrixVerified\)/);
  assert.match(documents, /if \(!testOnly && !gates\.labelTestApproved\)/);
  assert.match(documents, /DCE_CONFIG\.VOLUME_CAPACITY/);
});

test('Data Matrix é recuperado do PDF original e não regenerado', () => {
  assert.match(generator, /getPortalReturnAssets/);
  assert.match(generator, /auditPdfDocuments/);
  assert.match(generator, /verifyCrops/);
  assert.match(generator, /const crop = crops\.get\(tracking\)/);
  assert.match(generator, /matrixDataUrl: crop/);
});

test('dispatcher expõe somente os endpoints documentais esperados', () => {
  assert.match(api, /production\.documents\.test/);
  assert.match(api, /production\.documents\.volume/);
});
