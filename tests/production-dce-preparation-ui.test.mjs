import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const productionUi = fs.readFileSync(path.join(root, 'src', 'operations-production-ui.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'agency-dce-preparation-panel.js'), 'utf8');

 test('produção oferece preparo fiscal quando lote DC-e ainda aguarda preparação', () => {
  assert.match(productionUi, /status === "AWAITING_DCE_PREPARATION"/);
  assert.match(productionUi, /data-prepare-dce/);
  assert.match(productionUi, /Preparar pacote DC-e/);
});

test('produção abre o painel fiscal pelo productionBatchId e re-renderiza depois', () => {
  assert.match(productionUi, /openAgencyDcePreparation/);
  assert.match(productionUi, /productionBatchId: id/);
  assert.match(productionUi, /await renderWorkflow\(slot\)/);
});

test('painel fiscal possui css dedicado sem depender do portal do cliente', () => {
  assert.match(panel, /agency-dce-preparation\.css/);
  assert.doesNotMatch(panel, /client-portal\.css/);
});

test('aprovação física exige SRO lido e usa endpoint endurecido do pós-produção', () => {
  assert.match(productionUi, /data-test-scan/);
  assert.match(productionUi, /production\.labelTest\.approve/);
  assert.match(productionUi, /scannedTrackingCode: scanned/);
  assert.doesNotMatch(productionUi, /data-test-check/);
});
