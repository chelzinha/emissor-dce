import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const production = fs.readFileSync(new URL('../src/elections-production-ops-ui.js', import.meta.url), 'utf8');
const delivery = fs.readFileSync(new URL('../src/elections-internal-delivery-ui.js', import.meta.url), 'utf8');

test('lotes finalizados não carregam gates operacionais', () => {
  assert.match(production, /OPERATIONAL_BATCH_STATUSES/);
  assert.match(production, /'READY_FOR_UNIFIED_LABEL'/);
  assert.match(production, /'AWAITING_DCE_PREPARATION'/);
  assert.match(production, /'FINALIZADO': 'FINISHED'/);
  assert.match(production, /if \(!isOperationalBatchStatus\(cardBatchStatus\(card\)\)\) \{/);
  assert.match(production, /existing\?\.remove\(\)/);
});

test('recuperação automática só pode rodar em lote ainda operacional', () => {
  assert.match(production, /!isAssociationMismatch\(error\) \|\| !isOperationalBatchStatus\(batchRecordStatus\(batch\)\)/);
  assert.match(production, /dataAction\('production\.prepare'/);
});

test('entrega interna consulta gates somente dos lotes em produção', () => {
  assert.match(delivery, /DELIVERY_OPERATIONAL_STATUSES/);
  assert.match(delivery, /'FINALIZADO': 'FINISHED'/);
  assert.match(delivery, /const operational = \(batches \|\| \[\]\)\.filter\(isDeliveryOperationalBatch\)/);
  assert.match(delivery, /Promise\.all\(operational\.map/);
  assert.doesNotMatch(delivery, /Promise\.all\(\(batches \|\| \[\]\)\.map/);
});
