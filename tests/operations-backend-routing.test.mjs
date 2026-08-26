import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiSource = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const operationsFunction = fs.readFileSync(new URL('../netlify/functions/operations-data.mjs', import.meta.url), 'utf8');
const operationsBridge = fs.readFileSync(new URL('../netlify/functions/_shared/operations-apps-script.mjs', import.meta.url), 'utf8');
const portalUserCreate = fs.readFileSync(new URL('../netlify/functions/portal-user-create.mjs', import.meta.url), 'utf8');
const agencyHtml = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const clientHtml = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const tempClientHtml = fs.readFileSync(new URL('../portal-certificado.html', import.meta.url), 'utf8');
const tempClient = fs.readFileSync(new URL('../src/client-cnpj-temp.js', import.meta.url), 'utf8');

test('agency and full client frontend keep the isolated operations backend available', () => {
  assert.match(apiSource, /\/api\/operations-data/);
  assert.match(apiSource, /eleicoes\.html/);
  assert.match(apiSource, /portal\.html/);
});

test('operations function uses dedicated Apps Script environment variables', () => {
  assert.match(operationsFunction, /callOperationsAppsScript/);
  assert.match(operationsBridge, /OPERATIONS_APPS_SCRIPT_URL/);
  assert.match(operationsBridge, /OPERATIONS_APPS_SCRIPT_TOKEN/);
  assert.doesNotMatch(operationsBridge, /env\("APPS_SCRIPT_URL"\)/);
});

test('portal user provisioning remains available for reactivation of the full portal', () => {
  assert.match(portalUserCreate, /callOperationsAppsScript/);
  assert.doesNotMatch(portalUserCreate, /callAppsScript/);
  assert.match(portalUserCreate, /campaign\.user\.add/);
});

test('homologação mantém DC-e completa na agência, portal autenticado e validação isolada', () => {
  assert.match(agencyHtml, /elections-production-dce-ui\.js/);
  assert.match(agencyHtml, /elections-document-mode-ui\.js/);
  assert.doesNotMatch(agencyHtml, /elections-release-simplified\.js/);
  assert.match(clientHtml, /client-portal\.js/);
  assert.match(clientHtml, /client-finance-highlights\.js/);
  assert.doesNotMatch(clientHtml, /client-cnpj-temp\.js/);
  assert.match(tempClientHtml, /client-cnpj-temp\.js/);
  assert.match(tempClient, /client-portal\.css/);
  assert.match(tempClient, /Dashboard/);
  assert.match(tempClient, /Validar CNPJ/);
});
