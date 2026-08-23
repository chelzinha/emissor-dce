import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps-script/OperationClosure.gs',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
const sandbox={safeJsonParse_:(value,fallback)=>{try{return typeof value==='string'?JSON.parse(value):value||fallback;}catch{return fallback;}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);

function base(overrides={}){
  return {
    totalObjects:100,portalReturnPending:0,unassignedObjects:0,generationPending:0,
    printPending:0,handoffPending:0,notPosted:0,unresolvedTracking:0,returned:0,
    ...overrides,
  };
}

test('operação só fica pronta quando todos os gates estão zerados',()=>{
  const result=sandbox.operationClosureDecision_(base());
  assert.equal(result.ready,true);
  assert.equal(result.status,'READY');
  assert.deepEqual(Array.from(result.blockers),[]);
});

test('devolução é terminal, mas fica explícita no fechamento',()=>{
  const result=sandbox.operationClosureDecision_(base({returned:7}));
  assert.equal(result.ready,true);
  assert.equal(result.status,'READY_WITH_RETURNS');
});

test('rastreamento transitório bloqueia encerramento',()=>{
  const result=sandbox.operationClosureDecision_(base({unresolvedTracking:5}));
  assert.equal(result.ready,false);
  assert.equal(result.status,'NOT_READY');
  assert.equal(result.blockers.find(item=>item.code==='TRACKING_PENDING').quantity,5);
});

test('impressão, entrega interna e postagem pendentes aparecem separadamente',()=>{
  const result=sandbox.operationClosureDecision_(base({printPending:4,handoffPending:7,notPosted:9}));
  assert.deepEqual(Array.from(result.blockers).map(item=>item.code),['PRINT_PENDING','HANDOFF_PENDING','POSTING_PENDING']);
});

test('etiquetas geradas por volume são atribuídas ao lote pelos metadados',()=>{
  const events=[
    {TYPE:'LABEL_GENERATED',SOURCE_TYPE:'DELIVERY_VOLUME',SOURCE_ID:'vol-1',QUANTITY:250,METADATA_JSON:'{"productionBatchId":"batch-1"}'},
    {TYPE:'LABEL_GENERATED',SOURCE_TYPE:'DELIVERY_VOLUME',SOURCE_ID:'vol-2',QUANTITY:83,METADATA_JSON:'{"productionBatchId":"batch-1"}'},
    {TYPE:'LABEL_GENERATED',SOURCE_TYPE:'DELIVERY_VOLUME',SOURCE_ID:'vol-3',QUANTITY:10,METADATA_JSON:'{"productionBatchId":"batch-2"}'},
  ];
  assert.equal(sandbox.operationClosureEventSum_(events,'batch-1','LABEL_GENERATED'),333);
});

test('dispatcher expõe diagnóstico de encerramento somente leitura',()=>{
  assert.match(api,/operation\.closure\.status/);
  assert.doesNotMatch(source,/updateRow_\('CAMPAIGNS'/);
});
