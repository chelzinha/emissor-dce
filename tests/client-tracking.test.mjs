import test from 'node:test';
import assert from 'node:assert/strict';
import { clientTrackingSegments } from '../src/client-tracking.js';

test('segmentos do destaque do cliente são exclusivos e somam 100%',()=>{
  const result=clientTrackingSegments({posted:100,delivered:48,inTransit:30,outForDelivery:10,exception:5,returning:2,returned:1,unknown:1,awaitingUpdate:3});
  assert.equal(result.total,100);
  assert.equal(result.counts.delivered,48);
  assert.equal(result.counts.movement,40);
  assert.equal(result.counts.attention,9);
  assert.equal(result.counts.awaiting,3);
  assert.equal(Object.values(result.percentages).reduce((a,b)=>a+b,0),100);
});

test('snapshot vazio não inventa percentuais',()=>{
  const result=clientTrackingSegments({});
  assert.equal(result.total,0);
  assert.deepEqual(result.percentages,{delivered:0,movement:0,attention:0,awaiting:0});
});
