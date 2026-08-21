import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFLINE_SYNC_MODES,
  canonicalOfflineObjectSet,
  classifyOfflineOverlap,
  verifyOfflineSourceFiles,
  chunkOfflineRows,
  summarizeOfflineSyncPlan,
} from '../src/offline-sync.js';

function manifest() {
  return {
    schema: 'agf-postal-operations-local-manifest', version: 3, batchId: 'local-1', documentMode: 'SIMPLIFIED_DECLARATION',
    summary: { total: 2, pac: 1, sedex: 1, matrixVerified: 2, matrixPending: 0 },
    physicalTests: [
      { service: 'PAC', trackingCode: 'AA123456789BR', approved: true },
      { service: 'SEDEX', trackingCode: 'BB123456789BR', approved: true },
    ],
    sourceFiles: [
      { name: 'r.csv', sha256: 'a'.repeat(64) },
      { name: 'e.pdf', sha256: 'b'.repeat(64) },
    ],
    generatedFiles: [{ name: 'lote.pdf', sha256: 'c'.repeat(64) }],
    volumes: [
      { number: 1, service: 'SEDEX', quantity: 1, trackingCodes: ['BB123456789BR'] },
      { number: 2, service: 'PAC', quantity: 1, trackingCodes: ['AA123456789BR'] },
    ],
    operationEvents: [],
    objects: [
      { trackingCode: 'AA123456789BR', service: 'PAC', matrixStatus: 'AUTO_VERIFIED' },
      { trackingCode: 'BB123456789BR', service: 'SEDEX', matrixStatus: 'VERIFIED' },
    ],
  };
}

test('canonical object set is stable and sorted', () => {
  assert.equal(canonicalOfflineObjectSet(manifest()), 'AA123456789BR|PAC\nBB123456789BR|SEDEX');
});

test('classifies no overlap as new import', () => {
  const result = classifyOfflineOverlap(manifest(), []);
  assert.equal(result.mode, OFFLINE_SYNC_MODES.NEW_IMPORT);
});

test('classifies exact single batch overlap as reconciliation', () => {
  const result = classifyOfflineOverlap(manifest(), [
    { trackingCode: 'AA123456789BR', service: 'PAC', productionBatchId: 'p1' },
    { trackingCode: 'BB123456789BR', service: 'SEDEX', productionBatchId: 'p1' },
  ]);
  assert.equal(result.mode, OFFLINE_SYNC_MODES.RECONCILE_EXISTING);
  assert.equal(result.productionBatchId, 'p1');
});

test('blocks partial overlap', () => {
  const result = classifyOfflineOverlap(manifest(), [
    { trackingCode: 'AA123456789BR', service: 'PAC', productionBatchId: 'p1' },
  ]);
  assert.equal(result.mode, OFFLINE_SYNC_MODES.CONFLICT);
  assert.deepEqual(result.missing, ['BB123456789BR']);
});

test('blocks service mismatch and multiple batches', () => {
  const mismatch = classifyOfflineOverlap(manifest(), [
    { trackingCode: 'AA123456789BR', service: 'SEDEX', productionBatchId: 'p1' },
    { trackingCode: 'BB123456789BR', service: 'SEDEX', productionBatchId: 'p1' },
  ]);
  assert.equal(mismatch.mode, OFFLINE_SYNC_MODES.CONFLICT);
  assert.equal(mismatch.serviceMismatch.length, 1);

  const multiple = classifyOfflineOverlap(manifest(), [
    { trackingCode: 'AA123456789BR', service: 'PAC', productionBatchId: 'p1' },
    { trackingCode: 'BB123456789BR', service: 'SEDEX', productionBatchId: 'p2' },
  ]);
  assert.equal(multiple.mode, OFFLINE_SYNC_MODES.CONFLICT);
  assert.equal(multiple.reason, 'MULTIPLE_PRODUCTION_BATCHES');
});

test('source verification compares SHA-256 instead of trusting filename', () => {
  const result = verifyOfflineSourceFiles(manifest(), [
    { name: 'renamed.csv', sha256: 'a'.repeat(64) },
    { name: 'other.pdf', sha256: 'b'.repeat(64) },
  ]);
  assert.equal(result.exact, true);
  assert.equal(result.matched.length, 2);
});

test('source verification identifies missing source', () => {
  const result = verifyOfflineSourceFiles(manifest(), [{ name: 'r.csv', sha256: 'a'.repeat(64) }]);
  assert.equal(result.exact, false);
  assert.equal(result.missing.length, 1);
});

test('chunks rows deterministically', () => {
  const rows = Array.from({ length: 451 }, (_, index) => ({ index }));
  const chunks = chunkOfflineRows(rows, 200);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [200, 200, 51]);
});

test('plan requires source verification only for new imports', () => {
  const m = manifest();
  const blocked = summarizeOfflineSyncPlan({ manifest: m, inspectResult: { mode: OFFLINE_SYNC_MODES.NEW_IMPORT } });
  assert.equal(blocked.canProceed, false);
  const ready = summarizeOfflineSyncPlan({ manifest: m, inspectResult: { mode: OFFLINE_SYNC_MODES.NEW_IMPORT }, sourceVerification: { exact: true } });
  assert.equal(ready.canProceed, true);
  const reconcile = summarizeOfflineSyncPlan({ manifest: m, inspectResult: { mode: OFFLINE_SYNC_MODES.RECONCILE_EXISTING } });
  assert.equal(reconcile.canProceed, true);
  assert.equal(reconcile.needsSourceFiles, false);
});

test('resume de NEW_IMPORT ainda exige fontes originais', () => {
  const m = manifest();
  const inspect = { mode: OFFLINE_SYNC_MODES.RESUME, sync: { mode: OFFLINE_SYNC_MODES.NEW_IMPORT, status: 'RECEIVING' } };
  const blocked = summarizeOfflineSyncPlan({ manifest: m, inspectResult: inspect });
  assert.equal(blocked.needsSourceFiles, true);
  assert.equal(blocked.canProceed, false);
  const ready = summarizeOfflineSyncPlan({ manifest: m, inspectResult: inspect, sourceVerification: { exact: true } });
  assert.equal(ready.canProceed, true);
});
