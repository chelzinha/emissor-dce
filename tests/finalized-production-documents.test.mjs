import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/elections-production-documents-ui.js', import.meta.url), 'utf8');

test('documentos de produção ignoram lotes finalizados e históricos', () => {
  assert.match(source, /OPERATIONAL_BATCH_STATUSES/);
  assert.match(source, /isOperationalBatchStatus/);
  assert.match(source, /existing\?\.remove\(\)/);
  assert.match(
    source,
    /!isAssociationMismatch\(error\) \|\| !isOperationalBatchStatus\(batchRecordStatus\(batch\)\)/
  );
  assert.match(
    source,
    /if \(!isOperationalBatchStatus\(batchRecordStatus\(batch\)\)\) \{[\s\S]*host\.remove\(\)/
  );
});
