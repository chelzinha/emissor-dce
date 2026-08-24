import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiGs = fs.readFileSync(new URL('../apps-script/Api.gs', import.meta.url), 'utf8');
const safeGs = fs.readFileSync(new URL('../apps-script/LargeBatchSafeActions.gs', import.meta.url), 'utf8');
const exportUi = fs.readFileSync(new URL('../src/portal-export-resilience.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('exportação do Portal é recuperável e não depende de reload imediato', () => {
  assert.match(html, /portal-export-resilience\.js/);
  assert.match(exportUi, /stopImmediatePropagation/);
  assert.match(exportUi, /portal\.export\.file/);
  assert.match(exportUi, /portal\.exports\.list/);
  assert.match(exportUi, /Baixar arquivos novamente/);
  assert.doesNotMatch(exportUi, /location\.reload/);
});

test('router usa implementações seguras nas etapas de maior volume', () => {
  assert.match(apiGs, /portal\.export'.*exportPortalPostalSafe_/);
  assert.match(apiGs, /production\.prepare'.*prepareProductionBatchSafe_/);
  assert.match(apiGs, /production\.posting\.confirm'.*confirmProductionPostingSafe_/);
  assert.match(apiGs, /tracking\.updates\.append'.*trackingAppendUpdatesSafe_/);
});

test('gravações de milhares de linhas são consolidadas em ranges', () => {
  assert.match(safeGs, /function updateRowsBatchSafe_/);
  assert.match(safeGs, /getRange\(firstRow, 1, end - cursor, width\)\.getValues/);
  assert.match(safeGs, /setValues\(values\)/);
  assert.match(safeGs, /updateRowsBatchSafe_\('ADDRESS_ROWS'/);
  assert.match(safeGs, /updateRowsBatchSafe_\('POSTAL_OBJECTS'/);
});

test('exportação é idempotente e recupera arquivo já criado após timeout', () => {
  assert.match(safeGs, /portalExportForListSafe_/);
  assert.match(safeGs, /repairExistingPortalExportSafe_/);
  assert.match(safeGs, /DriveApp\.getFileById/);
  assert.match(safeGs, /recovered: true/);
});

test('preparação, postagem e rastreamento conseguem retomar estado parcial', () => {
  assert.match(safeGs, /deliveryVolumesSafe_/);
  assert.match(safeGs, /String\(portalReturn\.STATUS\).*IN_PRODUCTION/);
  assert.match(safeGs, /postingEventForList_/);
  assert.match(safeGs, /appendDeliveredOperationEventsSafe_/);
  assert.match(safeGs, /appendObjects_\('TRACKING_EVENTS', records\)/);
});
