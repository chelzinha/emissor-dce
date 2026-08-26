import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  findProductionForReturn,
  isPartialAssociationError,
} from '../src/elections-production-prepare-recovery.js';

const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../src/elections-production-prepare-recovery.js', import.meta.url), 'utf8');

test('localiza lote criado mesmo quando a primeira chamada terminou com erro HTTP', () => {
  const rows = [
    { ID: 'batch-1', PORTAL_RETURN_ID: 'return-1', DOCUMENT_MODE: 'SIMPLIFIED_DECLARATION' },
    { id: 'batch-2', portalReturnId: 'return-2', documentMode: 'DCE_AUTHORIZED' },
  ];
  assert.equal(findProductionForReturn(rows, 'return-1', 'SIMPLIFIED_DECLARATION')?.ID, 'batch-1');
  assert.equal(findProductionForReturn(rows, 'return-2', 'DCE_AUTHORIZED')?.id, 'batch-2');
  assert.equal(findProductionForReturn(rows, 'return-1', 'DCE_AUTHORIZED'), null);
});

test('reconhece erros de associação parcial dos objetos', () => {
  assert.equal(isPartialAssociationError(new Error('Quantidade de objetos do lote diverge do total registrado.')), true);
  assert.equal(isPartialAssociationError(new Error('Nenhum objeto associado ao lote de producao.')), true);
  assert.equal(isPartialAssociationError(new Error('Senha inválida.')), false);
});

test('interface intercepta a ação, confere o lote e tenta reparo antes de mostrar erro', () => {
  assert.match(html, /elections-production-prepare-recovery\.js/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /production\.list/);
  assert.match(source, /production\.gates/);
  assert.match(source, /Reparando associações do lote/);
  assert.match(source, /view: 'production'/);
});
