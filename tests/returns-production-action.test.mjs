import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const modeFlow = fs.readFileSync(new URL('../src/elections-document-mode-ui.js', import.meta.url), 'utf8');
const dceFlow = fs.readFileSync(new URL('../src/elections-production-dce-ui.js', import.meta.url), 'utf8');
const agencyHtml = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const clientHtml = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');

test('retorno pronto oferece as duas modalidades documentais', () => {
  assert.match(modeFlow, /Gerar Declaração Simplificada/);
  assert.match(modeFlow, /Gerar DC-e/);
  assert.match(modeFlow, /Escolha uma única modalidade/);
  assert.match(modeFlow, /status === 'READY'/);
  assert.match(modeFlow, /etapa 6/);
});

test('retorno em produção oferece continuação em vez de nova criação', () => {
  assert.match(modeFlow, /status === 'IN_PRODUCTION'/);
  assert.match(modeFlow, /Continuar no fluxo/);
  assert.match(modeFlow, /dataset\.documentModeState/);
  assert.match(modeFlow, /continueToProduction/);
});

test('painel da agência carrega validação DC-e e não carrega a antiga ocultação', () => {
  assert.match(agencyHtml, /elections-document-mode-ui\.js/);
  assert.match(agencyHtml, /elections-production-dce-ui\.js/);
  assert.doesNotMatch(agencyHtml, /elections-release-simplified\.js/);
  assert.match(dceFlow, /productionDce\.preflight/);
  assert.match(dceFlow, /Abrir Portal do Cliente/);
});

test('link do usuário final aponta temporariamente para validação pública de CNPJ', () => {
  assert.match(clientHtml, /client-cnpj-temp\.js/);
  assert.doesNotMatch(clientHtml, /client-portal\.js/);
  assert.doesNotMatch(clientHtml, /client-postal-simulator\.js/);
});
