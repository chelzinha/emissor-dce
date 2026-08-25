import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const internalDelivery = fs.readFileSync(new URL('../src/elections-internal-delivery-ui.js', import.meta.url), 'utf8');
const productionOps = fs.readFileSync(new URL('../src/elections-production-ops-ui.js', import.meta.url), 'utf8');
const dceUi = fs.readFileSync(new URL('../src/elections-production-dce-ui.js', import.meta.url), 'utf8');

test('entrega interna usa a etapa 9 do fluxo de onze etapas', () => {
  assert.match(internalDelivery, /AGF_OPERATION_STAGE_FULL_1_11/);
  assert.match(internalDelivery, /currentStage\(\) === '9'/);
  assert.match(internalDelivery, /ETAPA 9/);
  assert.doesNotMatch(internalDelivery, /AGF_OPERATION_STAGE_1_8/);
  assert.doesNotMatch(internalDelivery, /isStageEight/);
});

test('gates bloqueiam Data Matrix, teste e impressão até liberação documental', () => {
  assert.match(productionOps, /READY_FOR_UNIFIED_LABEL/);
  assert.match(productionOps, /Documento do lote/);
  assert.match(productionOps, /Bloqueado até liberação documental/);
  assert.match(productionOps, /ready && setupReady && !gates\.matrixVerified/);
  assert.match(productionOps, /ready && gates\.labelTestApproved && !gates\.printComplete/);
});

test('entrega física não é mais confirmada dentro dos gates de produção', () => {
  assert.doesNotMatch(productionOps, /data-op="handoff"/);
  assert.doesNotMatch(productionOps, /data-op="protocol"/);
  assert.match(productionOps, /Continue na etapa 9 - Entrega à operação/);
});

test('fluxo DC-e não confunde o portal demonstrativo com autorização fiscal', () => {
  assert.match(dceUi, /Abrir validação de CNPJ/);
  assert.match(dceUi, /portal público está temporariamente em modo demonstração e validação de CNPJ/);
  assert.match(dceUi, /A autorização da DC-e será reativada no portal definitivo/);
  assert.doesNotMatch(dceUi, /Abrir Portal do Cliente/);
});
