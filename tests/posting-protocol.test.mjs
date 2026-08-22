import test from 'node:test';
import assert from 'node:assert/strict';
import { paginatePostingProtocol } from '../src/posting-protocol-generator.js';

test('protocolo mantém listas postais e reinicia numeração por lista',()=>{
  const data={lists:[
    {listId:'191539',serviceCode:'4510',service:'PAC',total:2,objects:[{trackingCode:'QN000000001BR',zip:'60000000',recipientName:'A'},{trackingCode:'QN000000002BR',zip:'60000001',recipientName:'B'}]},
    {listId:'191540',serviceCode:'4014',service:'SEDEX',total:1,objects:[{trackingCode:'OY000000001BR',zip:'60100000',recipientName:'C'}]},
  ]};
  const plan=paginatePostingProtocol(data);
  const rows=plan.flat().filter(unit=>unit.type==='row');
  assert.deepEqual(rows.map(unit=>[unit.list.listId,unit.index]),[['191539',1],['191539',2],['191540',1]]);
});

test('lista longa continua em outra coluna ou página com identificador de continuação',()=>{
  const objects=Array.from({length:220},(_,i)=>({trackingCode:`QN${String(i+1).padStart(9,'0')}BR`,zip:'60000000',recipientName:`DEST ${i+1}`}));
  const plan=paginatePostingProtocol({lists:[{listId:'191539',serviceCode:'4510',service:'PAC',total:objects.length,objects}]});
  const continuations=plan.flat().filter(unit=>unit.type==='column'&&unit.continuation==='191539');
  assert.ok(continuations.length>=1);
  assert.equal(plan.flat().filter(unit=>unit.type==='row').length,220);
});
