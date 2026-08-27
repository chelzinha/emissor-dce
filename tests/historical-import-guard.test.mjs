import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../netlify/functions/historical-import.mjs', import.meta.url), 'utf8');

test('migração histórica exige token e usa lista explícita de ações', () => {
  assert.match(source, /HISTORICAL_IMPORT_TOKEN/);
  assert.match(source, /const ALLOWED_ACTIONS = new Set/);
  assert.match(source, /ALLOWED_ACTIONS\.has\(request\.action\)/);
  assert.doesNotMatch(source, /callOperationsAppsScript\(body\.action/);
});

test('migração permite somente fluxos operacionais necessários', () => {
  for (const action of [
    'campaign.upsert',
    'addressList.append',
    'portalReturn.append',
    'production.prepare',
    'production.posting.confirm',
    'tracking.updates.append',
    'operation.record',
  ]) assert.match(source, new RegExp(`"${action.replaceAll('.', '\\.') }"`));
  assert.doesNotMatch(source, /finance\.payment\.record/);
  assert.doesNotMatch(source, /operation\.closure\.close/);
});
