import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps-script/OperationClosure.gs',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
const sandbox={};
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

test('dispatcher expõe diagnóstico de encerramento somente leitura',()=>{
  assert.match(api,/operation\.closure\.status/);
  assert.doesNotMatch(source,/updateRow_\('CAMPAIGNS'/);
});
