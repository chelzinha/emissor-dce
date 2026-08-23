import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps-script/OperationClosureActions.gs',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);

test('confirmações de encerramento e reabertura são explícitas',()=>{
  assert.equal(sandbox.closureConfirmation_('ENCERRAR','ENCERRAR'),true);
  assert.equal(sandbox.closureConfirmation_(' encerrar ','ENCERRAR'),true);
  assert.equal(sandbox.closureConfirmation_('sim','ENCERRAR'),false);
  assert.equal(sandbox.closureConfirmation_('REABRIR','REABRIR'),true);
});

test('operação encerrada mantém consultas e bloqueia mutações',()=>{
  sandbox.findRow_=()=>({ID:'camp-1',STATUS:'CLOSED'});
  assert.doesNotThrow(()=>sandbox.guardClosedCampaignAction_('tracking.summary',{campaignId:'camp-1'}));
  assert.doesNotThrow(()=>sandbox.guardClosedCampaignAction_('operation.closure.reopen',{campaignId:'camp-1'}));
  assert.throws(()=>sandbox.guardClosedCampaignAction_('tracking.updates.append',{campaignId:'camp-1'}),/encerrada/);
  assert.throws(()=>sandbox.guardClosedCampaignAction_('production.posting.confirm',{campaignId:'camp-1'}),/encerrada/);
  assert.throws(()=>sandbox.guardClosedCampaignAction_('campaign.upsert',{id:'camp-1'}),/encerrada/);
});

test('operação ativa não sofre bloqueio do guard',()=>{
  sandbox.findRow_=()=>({ID:'camp-1',STATUS:'ACTIVE'});
  assert.doesNotThrow(()=>sandbox.guardClosedCampaignAction_('tracking.updates.append',{campaignId:'camp-1'}));
});

test('dispatcher aplica o guard e expõe fechar e reabrir',()=>{
  assert.match(api,/guardClosedCampaignAction_\(action, payload\)/);
  assert.match(api,/operation\.closure\.close/);
  assert.match(api,/operation\.closure\.reopen/);
});
