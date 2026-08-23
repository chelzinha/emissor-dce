import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationSnapshot, buildDailyActivity, operationReportCsv } from '../src/operation-report.js';

test('snapshot preserva saldo parcial entre etapas',()=>{
  const snapshot=buildOperationSnapshot({
    addressLists:[{total:1000,ready:900,review:70,rejected:10}],
    portalExports:[{TOTAL_ROWS:850}],
    portalReturns:[{TOTAL_ROWS:820}],
    events:[
      {type:'LABEL_GENERATED',service:'PAC',quantity:500,occurredAt:'2026-08-22T12:00:00Z'},
      {type:'LABEL_GENERATED',service:'SEDEX',quantity:300,occurredAt:'2026-08-22T12:01:00Z'},
      {type:'LABEL_PRINTED',quantity:700,occurredAt:'2026-08-22T13:00:00Z'},
      {type:'LABEL_HANDOFF',quantity:650,occurredAt:'2026-08-22T14:00:00Z'},
      {type:'POSTING_COMPLETED',quantity:600,occurredAt:'2026-08-22T15:00:00Z'},
    ],
    trackingSummary:{total:{posted:600,delivered:420,inTransit:150,outForDelivery:10,exception:15,returning:3,returned:2}},
  });
  assert.equal(snapshot.cleanPending,20);
  assert.equal(snapshot.generated,800);
  assert.equal(snapshot.generatedPac,500);
  assert.equal(snapshot.generatedSedex,300);
  assert.equal(snapshot.stages.find(row=>row.key==='printed').pending,100);
  assert.equal(snapshot.stages.find(row=>row.key==='posted').pending,50);
  assert.equal(snapshot.stages.find(row=>row.key==='delivered').pending,180);
});

test('atividade diária separa PAC e SEDEX e respeita período',()=>{
  const rows=buildDailyActivity([
    {type:'LABEL_GENERATED',service:'PAC',quantity:10,occurredAt:'2026-08-22T13:00:00Z'},
    {type:'LABEL_GENERATED',service:'SEDEX',quantity:5,occurredAt:'2026-08-22T14:00:00Z'},
    {type:'TRACKING_DELIVERED',service:'PAC',quantity:3,occurredAt:'2026-08-23T12:00:00Z'},
  ],{from:'2026-08-22',to:'2026-08-22'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].generatedPac,10);
  assert.equal(rows[0].generatedSedex,5);
  assert.equal(rows[0].generated,15);
  assert.equal(rows[0].delivered,0);
});

test('CSV usa ponto e vírgula e inclui atividade diária',()=>{
  const csv=operationReportCsv({stages:[{label:'Postagem',total:10,completed:8,pending:2}],generatedPac:5,generatedSedex:3},[{date:'2026-08-22',posted:8}]);
  assert.match(csv,/ETAPA;TOTAL;CONCLUÍDO/);
  assert.match(csv,/Postagem;10;8;0;0;2/);
  assert.match(csv,/ATIVIDADE DIÁRIA/);
});
