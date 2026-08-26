import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/elections-production-ops-ui.js', import.meta.url), 'utf8');

test('lotes finalizados não carregam gates operacionais', () => {
  assert.match(source, /OPERATIONAL_BATCH_STATUSES/);
  assert.match(source, /'READY_FOR_UNIFIED_LABEL'/);
  assert.match(source, /'AWAITING_DCE_PREPARATION'/);
  assert.match(source, /'FINALIZADO': 'FINISHED'/);
  assert.match(source, /if \(!isOperationalBatchStatus\(cardBatchStatus\(card\)\)\) \{/);
  assert.match(source, /existing\?\.remove\(\)/);
});

test('recuperação automática só pode rodar em lote ainda operacional', () => {
  assert.match(source, /!isAssociationMismatch\(error\) \|\| !isOperationalBatchStatus\(batchRecordStatus\(batch\)\)/);
  assert.match(source, /dataAction\('production\.prepare'/);
});
