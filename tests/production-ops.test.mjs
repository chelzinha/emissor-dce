import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps-script/ProductionOps.gs',import.meta.url),'utf8');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);

test('normaliza SRO lido fisicamente',()=>{
  assert.equal(sandbox.productionOpsTracking_(' oy 855 182 534 br '),'OY855182534BR');
});

test('extrai número real da lista postal por aliases conhecidos',()=>{
  assert.equal(sandbox.productionPostalListId_({LISTA:'191539'}),'191539');
  assert.equal(sandbox.productionPostalListId_({NUMERO_LISTA:'191540'}),'191540');
  assert.equal(sandbox.productionPostalListId_({PLP:'191541'}),'191541');
});

test('dispatcher contém os endpoints endurecidos do checkpoint operacional',()=>{
  const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
  for(const action of ['production.matrix.confirm','production.labelTest.approve','production.print.confirm','production.handoff.confirm','production.protocol.data']){
    assert.match(api,new RegExp(action.replaceAll('.','\\.')));
  }
});

test('evento DCE_PREPARED prematuro é suprimido no recorder',()=>{
  const operations=fs.readFileSync(new URL('../apps-script/Operations.gs',import.meta.url),'utf8');
  assert.match(operations,/PREMATURE_DCE_PREPARED/);
  assert.match(operations,/AWAITING_DCE_PREPARATION/);
});