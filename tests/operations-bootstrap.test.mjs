import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const setup = fs.readFileSync(new URL('../apps-script/Setup.gs', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../scripts/create-operations-apps-script.ps1', import.meta.url), 'utf8');

test('operations bootstrap creates isolated credentials without logging the token', () => {
  assert.match(setup, /function bootstrapOperationsProject\(\)/);
  assert.match(setup, /AGF_OPERACOES_BOOTSTRAP\.json/);
  assert.match(setup, /Utilities\.getUuid\(\)/);
  assert.match(setup, /DCE_CONFIG\.PROPERTY_API_TOKEN/);
  assert.doesNotMatch(setup, /console\.log\([^\n]*apiToken/);
});

test('powershell helper creates a new standalone clasp project in an isolated directory', () => {
  assert.match(helper, /\.operations-apps-script-deploy/);
  assert.match(helper, /clasp create --type standalone/);
  assert.match(helper, /clasp push --force/);
  assert.match(helper, /bootstrapOperationsProject/);
});
