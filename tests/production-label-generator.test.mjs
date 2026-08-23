import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const generator=fs.readFileSync(new URL('../src/production-label-generator.js',import.meta.url),'utf8');
const documents=fs.readFileSync(new URL('../apps-script/ProductionDocuments.gs',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');

test('declaração simplificada é identificada como operacional e não fiscal',()=>{
  assert.match(generator,/DECLARAÇÃO SIMPLIFICADA DE CONTEÚDO/);
  assert.match(generator,/Não representa DC-e autorizada; não possui chave ou protocolo fiscal/);
  assert.match(generator,/finalidade operacional/);
});

test('DACE resumida exige dados reais do lote fiscal no backend',()=>{
  assert.match(documents,/dce\.status !== 'AUTHORIZED'/);
  assert.match(documents,/\^\\d\{44\}\$/);
  assert.match(documents,/!dce\.protocol/);
  assert.match(generator,/DACE RESUMIDA - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRÔNICA/);
  assert.match(generator,/MODALIDADE DE TRANSPORTE: 0 - CORREIOS/);
});

test('PDF de volume só é liberado após matriz e etiqueta teste',()=>{
  assert.match(documents,/if \(!gates\.matrixVerified\)/);
  assert.match(documents,/if \(!testOnly && !gates\.labelTestApproved\)/);
  assert.match(documents,/DCE_CONFIG\.VOLUME_CAPACITY/);
});

test('Data Matrix é recuperado do PDF original e não regenerado',()=>{
  assert.match(generator,/getPortalReturnAssets/);
  assert.match(generator,/auditPdfDocuments/);
  assert.match(generator,/verifyCrops/);
  assert.match(generator,/crops\.get\(normalizeTracking\(object\.trackingCode\)\)/);
});

test('dispatcher expõe somente os endpoints documentais esperados',()=>{
  assert.match(api,/production\.documents\.test/);
  assert.match(api,/production\.documents\.volume/);
});