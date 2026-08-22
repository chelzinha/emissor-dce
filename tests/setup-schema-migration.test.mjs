import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps-script/Setup.gs', import.meta.url), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

test('migração preserva dados antigos ao inserir colunas no meio do schema', () => {
  const oldHeaders = [
    'ID', 'CAMPAIGN_ID', 'PORTAL_RETURN_ID', 'DOCUMENT_MODE', 'STATUS', 'TOTAL', 'PAC', 'SEDEX',
    'MATRIX_SUMMARY_JSON', 'CREATED_BY', 'CREATED_AT', 'UPDATED_AT'
  ];
  const newHeaders = [
    'ID', 'CAMPAIGN_ID', 'PORTAL_RETURN_ID', 'DOCUMENT_MODE', 'STATUS', 'TOTAL', 'PAC', 'SEDEX',
    'MATRIX_SUMMARY_JSON', 'DCE_USER_ID', 'DCE_BATCH_ID', 'DCE_AUTHORIZED', 'DCE_REJECTED', 'DCE_ERRORS',
    'CREATED_BY', 'CREATED_AT', 'UPDATED_AT'
  ];
  const row = [
    'batch-1', 'campaign-1', 'return-1', 'DCE_AUTHORIZED', 'IN_PRODUCTION', 250, 120, 130,
    '{"verified":250}', 'agency-user', '2026-08-20T10:00:00Z', '2026-08-20T11:00:00Z'
  ];

  const [migrated] = sandbox.remapRowsByHeader_(oldHeaders, [row], newHeaders);

  assert.equal(migrated[newHeaders.indexOf('CREATED_BY')], 'agency-user');
  assert.equal(migrated[newHeaders.indexOf('CREATED_AT')], '2026-08-20T10:00:00Z');
  assert.equal(migrated[newHeaders.indexOf('UPDATED_AT')], '2026-08-20T11:00:00Z');
  assert.equal(migrated[newHeaders.indexOf('DCE_USER_ID')], '');
  assert.equal(migrated[newHeaders.indexOf('DCE_BATCH_ID')], '');
  assert.equal(migrated[newHeaders.indexOf('DCE_AUTHORIZED')], '');
  assert.equal(migrated[newHeaders.indexOf('DCE_REJECTED')], '');
  assert.equal(migrated[newHeaders.indexOf('DCE_ERRORS')], '');
});

test('migração acompanha o nome da coluna, não a posição', () => {
  const oldHeaders = ['A', 'B', 'C'];
  const newHeaders = ['A', 'X', 'B', 'C'];
  const [migrated] = sandbox.remapRowsByHeader_(oldHeaders, [['a', 'b', 'c']], newHeaders);
  assert.deepEqual(Array.from(migrated), ['a', '', 'b', 'c']);
});