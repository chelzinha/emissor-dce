import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTrackingStatus,
  parseTrackingCsv,
  trackingSourceKey,
  chunkTrackingRows,
} from '../src/tracking-import.js';

test('classifica estados principais de rastreamento',()=>{
  assert.equal(classifyTrackingStatus('Objeto entregue ao destinatário'),'DELIVERED');
  assert.equal(classifyTrackingStatus('Objeto saiu para entrega ao destinatário'),'OUT_FOR_DELIVERY');
  assert.equal(classifyTrackingStatus('Objeto em trânsito - por favor aguarde'),'IN_TRANSIT');
  assert.equal(classifyTrackingStatus('Objeto devolvido ao remetente'),'RETURNED');
  assert.equal(classifyTrackingStatus('Destinatário ausente'),'EXCEPTION');
});

test('lê CSV com ponto e vírgula e data brasileira',()=>{
  const csv=['SRO;STATUS;DATA_EVENTO;HORA;LOCAL','OY855189152BR;Objeto entregue ao destinatário;22/08/2026;14:35;Fortaleza/CE'].join('\n');
  const result=parseTrackingCsv(csv);
  assert.equal(result.delimiter,';');
  assert.equal(result.rows[0].trackingCode,'OY855189152BR');
  assert.equal(result.rows[0].category,'DELIVERED');
  assert.match(result.rows[0].eventAt,/^2026-08-22T/);
  assert.deepEqual(result.rows[0].errors,[]);
});

test('source key é estável e chunks respeitam 200',()=>{
  const row={trackingCode:'OY855189152BR',eventAt:'2026-08-22T17:35:00.000Z',category:'DELIVERED',status:'Entregue',description:'',location:'Fortaleza'};
  assert.equal(trackingSourceKey(row),trackingSourceKey({...row}));
  assert.deepEqual(chunkTrackingRows(Array.from({length:401}),200).map(x=>x.length),[200,200,1]);
});
