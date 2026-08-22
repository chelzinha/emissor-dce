import test from 'node:test';
import assert from 'node:assert/strict';
import { canContinueProductionDce, fiscalBatchId, pendingAuthorizationDocuments } from '../src/dce-authorization-state.js';

test('lotes preparados, reservados ou parciais podem continuar autorização', () => {
  assert.equal(canContinueProductionDce('DCE_PREPARED'), true);
  assert.equal(canContinueProductionDce('DCE_RESERVED'), true);
  assert.equal(canContinueProductionDce('DCE_PARTIAL'), true);
  assert.equal(canContinueProductionDce('READY_FOR_UNIFIED_LABEL'), false);
});

test('retomada não reenvia documentos em estado terminal', () => {
  const docs = [
    { reference: '1', status: 'AUTHORIZED' },
    { reference: '2', status: 'REJECTED' },
    { reference: '3', status: 'CANCELLED' },
    { reference: '4', status: 'PREPARED' },
    { reference: '5', status: 'ERROR' },
  ];
  assert.deepEqual(pendingAuthorizationDocuments(docs).map((doc) => doc.reference), ['4', '5']);
});

test('identificador fiscal funciona na primeira reserva e na retomada', () => {
  assert.equal(fiscalBatchId({ id: 'batch-new' }), 'batch-new');
  assert.equal(fiscalBatchId({ batch: { ID: 'batch-existing' } }), 'batch-existing');
  assert.equal(fiscalBatchId({ batch: { id: 'batch-existing-2' } }), 'batch-existing-2');
});
