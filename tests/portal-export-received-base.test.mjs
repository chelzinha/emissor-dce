import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const manualUi = fs.readFileSync(new URL('../src/elections-manual-portal-export-ui.js', import.meta.url), 'utf8');
const resilience = fs.readFileSync(new URL('../src/portal-export-resilience.js', import.meta.url), 'utf8');

test('fluxo manual carrega o liberador de base recebida antes da exportação resiliente', () => {
  const manualIndex = html.indexOf('/src/elections-manual-portal-export-ui.js');
  const resilienceIndex = html.indexOf('/src/portal-export-resilience.js');
  assert.ok(manualIndex > -1);
  assert.ok(resilienceIndex > manualIndex);
});

test('base recebida volta a exibir formulário para gerar CSV do Portal', () => {
  assert.match(manualUi, /Base recebida/);
  assert.match(manualUi, /portal-export-list/);
  assert.match(manualUi, /portal-export-service/);
  assert.match(manualUi, /portal-export-content/);
  assert.match(manualUi, /portal-export-run/);
  assert.match(manualUi, /inferService/);
});

test('exportação prepara registros RAW em blocos antes de chamar portal.export', () => {
  assert.match(resilience, /const PREPARE_CHUNK = 200/);
  assert.match(resilience, /status: 'RAW'/);
  assert.match(resilience, /dataAction\('cleaning\.process'/);
  assert.match(resilience, /defaults: \{ service, content \}/);
  assert.match(resilience, /status: 'REVIEW'/);
  const prepareIndex = resilience.indexOf('await prepareReceivedBase');
  const exportIndex = resilience.indexOf("dataAction('portal.export'");
  assert.ok(prepareIndex > -1);
  assert.ok(exportIndex > prepareIndex);
});
