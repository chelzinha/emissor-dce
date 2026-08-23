import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiSource = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const operationsFunction = fs.readFileSync(new URL('../netlify/functions/operations-data.mjs', import.meta.url), 'utf8');
const operationsBridge = fs.readFileSync(new URL('../netlify/functions/_shared/operations-apps-script.mjs', import.meta.url), 'utf8');
const agencyHtml = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('agency frontend routes data actions to isolated operations backend', () => {
  assert.match(apiSource, /\/api\/operations-data/);
  assert.match(apiSource, /eleicoes\.html/);
});

test('operations function uses dedicated Apps Script environment variables', () => {
  assert.match(operationsFunction, /callOperationsAppsScript/);
  assert.match(operationsBridge, /OPERATIONS_APPS_SCRIPT_URL/);
  assert.match(operationsBridge, /OPERATIONS_APPS_SCRIPT_TOKEN/);
  assert.doesNotMatch(operationsBridge, /env\("APPS_SCRIPT_URL"\)/);
});

test('simplified production release does not load agency DC-e module', () => {
  assert.doesNotMatch(agencyHtml, /elections-production-dce-ui\.js/);
  assert.match(agencyHtml, /elections-release-simplified\.js/);
});
