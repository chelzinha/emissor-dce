import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const portal = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/client-cnpj-temp.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/client-cnpj-temp.css', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/cnpj-certificate.mjs', import.meta.url), 'utf8');

test('portal temporário abre diretamente sem login', () => {
  assert.match(portal, /client-cnpj-temp\.js/);
  assert.doesNotMatch(portal, /client-portal\.js/);
  assert.doesNotMatch(client, /getUser|logout|portal\/login|Netlify Identity/i);
  assert.match(client, /appView\(\);\s*$/);
});

test('portal temporário não contém dashboard, simulador ou autorização DC-e', () => {
  assert.doesNotMatch(client, /function dashboard|function simulator|authorize\(|Autorizar DC-e/);
  assert.match(client, /Validar e-CNPJ A1/);
  assert.match(client, /Validar CNPJ/);
});

test('painel deixa os dados de demonstração explicitamente fictícios', () => {
  assert.match(client, /DADOS FICTÍCIOS/);
  assert.match(client, /Nenhum deles representa uma operação real/);
  assert.match(client, /Campanha Ceará 2026 - Demonstração/);
});

test('validação pública usa endpoint dedicado e não enfraquece endpoint autenticado da DC-e', () => {
  assert.match(client, /\/api\/cnpj\/certificate/);
  assert.match(endpoint, /readPkcs12/);
  assert.match(endpoint, /parseJson\(req, 5_000_000\)/);
  assert.doesNotMatch(endpoint, /requireUser/);
  assert.match(endpoint, /path: '\/api\/cnpj\/certificate'/);
});

test('layout tem comportamento mobile', () => {
  assert.match(css, /@media\(max-width:420px\)/);
  assert.match(css, /width:min\(760px,100%\)/);
});
