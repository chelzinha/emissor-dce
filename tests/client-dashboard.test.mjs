import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientDashboard, normalizeClientTimeline, summarizeClientEvents } from '../src/client-dashboard.js';

test('consolida eventos sem confundir handoff com entrega postal', () => {
  const metrics = summarizeClientEvents([
    { type:'ADDRESS_LIST_RECEIVED', quantity:1183 },
    { type:'LABEL_GENERATED', service:'PAC', quantity:183 },
    { type:'LABEL_GENERATED', service:'SEDEX', quantity:1000 },
    { type:'LABEL_HANDOFF', quantity:1183 },
    { type:'POSTING_COMPLETED', quantity:1183 },
    { type:'TRACKING_DELIVERED', quantity:742 },
  ]);
  assert.equal(metrics.labelsGenerated, 1183);
  assert.equal(metrics.labelsHandedOff, 1183);
  assert.equal(metrics.delivered, 742);
  assert.equal(metrics.withoutDeliveryRecord, 441);
});

test('timeline ordena mais recente primeiro e limita resultados', () => {
  const timeline = normalizeClientTimeline([
    { type:'LABEL_PRINTED', quantity:10, occurredAt:'2026-08-20T10:00:00-03:00' },
    { type:'POSTING_COMPLETED', quantity:10, occurredAt:'2026-08-21T10:00:00-03:00' },
  ], 1);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].type, 'POSTING_COMPLETED');
});

test('classifica lotes ativos, concluidos e bloqueados', () => {
  const result = buildClientDashboard([], [
    { status:'DCE_AUTHORIZED' }, { status:'AWAITING_CLIENT_AUTHORIZATION' }, { status:'REVIEW' }
  ]);
  assert.deepEqual(result.productionStatus, { total:3, active:1, completed:1, blocked:1 });
});
