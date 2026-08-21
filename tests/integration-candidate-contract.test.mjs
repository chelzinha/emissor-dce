import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const api = read('apps-script','Api.gs');
const config = read('apps-script','Config.gs');
const operations = read('apps-script','Operations.gs');
const vite = read('vite.config.js');
const entry = read('eleicoes.html');
const strict = read('apps-script','StrictCompatibility.gs');
const postProduction = read('apps-script','PostProduction.gs');
const offlineSyncBackend = read('apps-script','OfflineSync.gs');

test('dispatcher consolidado contém ações críticas dos checkpoints', () => {
  for (const action of [
    'offlineSync.inspect','client.dashboard','simulator.quote','issuer.get','dcePrep.context',
    'client.dce.prepareStart','client.dce.saveResults','production.dceLabelData',
    'production.labelTest.approve','production.generation.confirm','production.print.confirm','production.handoff.confirm',
    'production.protocol.data','production.postProduction.snapshot'
  ]) assert.ok(api.includes(`'${action}'`), `ação ausente: ${action}`);
});

test('dispatcher usa wrappers endurecidos nos pontos de compatibilidade', () => {
  for (const fn of [
    'addCampaignUserStrict_','updateCleanAddressRowStrict_','processCleaningBatchStrict_',
    'exportPortalPostalStrict_','finishPortalReturnStrict_','listPostalObjectsStrict_',
    'prepareProductionBatchStrict_'
  ]) assert.ok(api.includes(fn), `wrapper ausente no dispatcher: ${fn}`);
});

test('schemas novos existem e campos de sheets existentes só são anexados ao final', () => {
  for (const sheet of ['POSTAL_TARIFF_VERSIONS','POSTAL_TARIFF_ROWS','POSTAL_TARIFF_ASSIGNMENTS','DCE_ISSUER_PROFILES','DCE_AUTH_PACKAGES','DCE_AUTH_ITEMS','OFFLINE_SYNCS','OFFLINE_SYNC_OBJECTS']) {
    assert.ok(config.includes(`${sheet}:`), `sheet ausente: ${sheet}`);
  }
  assert.match(config, /DELIVERY_VOLUMES: \[[^\]]*'UPDATED_AT', 'PRINTED_AT', 'PRINTED_BY'\]/s);
  assert.match(config, /DCE_AUTH_ITEMS: \[[^\]]*'UPDATED_AT', 'QR_CODE'\]/s);
});

test('eventos de teste e sync offline estão no whitelist', () => {
  assert.match(operations, /'LABEL_TEST_APPROVED'/);
  assert.match(operations, /'OFFLINE_SYNC_COMPLETED'/);
});

test('entrada vite adiciona portal sem remover emissor e painel operacional', () => {
  assert.match(vite, /dce: resolve\(rootDir, "index\.html"\)/);
  assert.match(vite, /eleicoes: resolve\(rootDir, "eleicoes\.html"\)/);
  assert.match(vite, /portal: resolve\(rootDir, "portal\.html"\)/);
});

test('painel operacional carrega produção e volumes em módulos separados', () => {
  assert.match(entry, /operations-production-ui\.js/);
  assert.match(entry, /operations-volume-ui\.js/);
});

test('aprovação do teste gravada pelo backend é reconhecível pelo gate frontend', () => {
  assert.match(postProduction, /scanValidated: true/);
});

const volumeUi = read('src','operations-volume-ui.js');

test('pós-produção usa endpoints endurecidos em vez de gravar eventos diretamente', () => {
  assert.match(volumeUi, /production\.print\.confirm/);
  assert.match(volumeUi, /production\.handoff\.confirm/);
  assert.match(volumeUi, /production\.protocol\.data/);
  assert.doesNotMatch(volumeUi, /dataAction\("operation\.record"/);
  assert.doesNotMatch(volumeUi, /dataAction\("volumes\.handoff"/);
});

test('protocolo da UI passa pelo backend e continua baseado em listas postais', () => {
  assert.match(volumeUi, /LISTA: row\.listNumber/);
  assert.match(volumeUi, /buildPostingProtocolModel\(objects, \{ senderName: protocol\.senderName, cnpj: protocol\.cnpj \}\)/);
});

test('compatibilidade fecha o gate Matrix e adiciona paginação offset', () => {
  assert.match(strict, /\['AUTO_VERIFIED', 'VERIFIED'\]/);
  assert.match(strict, /const offset = Math\.max\(0, Number\(payload\.offset \|\| 0\)\)/);
  assert.match(strict, /slice\(offset, offset \+ limit\)/);
  assert.match(strict, /!isVerifiedMatrixStatus_\(row\.MATRIX_STATUS\)/);
});

test('compatibilidade não registra DCE_PREPARED ao apenas criar lote', () => {
  const functionBody = strict.slice(strict.indexOf('function prepareProductionBatchStrict_'));
  assert.doesNotMatch(functionBody, /type: 'DCE_PREPARED'/);
});

test('compatibilidade preserva IBGE e usa ADDRESS_ROWS.ID como chave do cliente', () => {
  assert.match(strict, /cleaned\.cityCode = cityCode/);
  assert.match(strict, /cleaned\.customerId = String\(row\.ID\)/);
});

test('compatibilidade permite CLIENT_USER sem retirar perfis existentes', () => {
  assert.match(strict, /'AGENCY_ADMIN', 'CAMPAIGN_USER', 'CLIENT_USER'/);
});


const productionUi = read('src','operations-production-ui.js');

test('LABEL_GENERATED só é registrado depois da geração integral do PDF', () => {
  const strictFinish = strict.slice(strict.indexOf('function finishPortalReturnStrict_'), strict.indexOf('function listPostalObjectsStrict_'));
  assert.doesNotMatch(strictFinish, /type: 'LABEL_GENERATED'/);
  assert.match(postProduction, /function confirmProductionGeneration_/);
  assert.match(postProduction, /type: 'LABEL_GENERATED'/);
  assert.match(postProduction, /idempotencyKey: 'label-generated:' \+ productionBatchId \+ ':' \+ service/);
  assert.match(productionUi, /downloadBlob\(pdf,[\s\S]*?await dataAction\("production\.generation\.confirm"/);
});


test('sync offline não inventa LABEL_GENERATED e só o reproduz quando veio do manifesto', () => {
  const createBody = offlineSyncBackend.slice(offlineSyncBackend.indexOf('function offlineSyncCreateConnectedBatch_'), offlineSyncBackend.indexOf('function offlineSyncReplayEvents_'));
  assert.doesNotMatch(createBody, /offline-label-generated/);
  assert.match(offlineSyncBackend, /'LABEL_TEST_APPROVED', 'LABEL_GENERATED', 'LABEL_PRINTED', 'LABEL_HANDOFF'/);
  assert.match(offlineSyncBackend, /event\.type === 'LABEL_GENERATED'/);
  assert.match(offlineSyncBackend, /idempotencyKey: 'label-generated:' \+ productionBatchId \+ ':' \+ event\.service/);
});
