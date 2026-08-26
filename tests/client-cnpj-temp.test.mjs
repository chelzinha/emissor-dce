import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const temporaryPortal = fs.readFileSync(new URL('../portal-certificado.html', import.meta.url), 'utf8');
const mainPortal = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/client-cnpj-temp.js', import.meta.url), 'utf8');
const finalCss = fs.readFileSync(new URL('../src/client-portal.css', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/cnpj-certificate.mjs', import.meta.url), 'utf8');

test('validação temporária continua disponível em rota separada e sem login', () => {
  assert.match(temporaryPortal, /client-cnpj-temp\.js/);
  assert.doesNotMatch(temporaryPortal, /client-portal\.js/);
  assert.doesNotMatch(client, /getUser|logout|portal\/login|Netlify Identity/i);
  assert.match(client, /render\(\);\s*$/);
});

test('portal principal volta a carregar a experiência autenticada', () => {
  assert.match(mainPortal, /client-portal\.js/);
  assert.match(mainPortal, /client-tracking-highlights\.js/);
  assert.match(mainPortal, /client-finance-highlights\.js/);
  assert.doesNotMatch(mainPortal, /client-cnpj-temp\.js/);
});

test('portal demonstrativo reutiliza o CSS da versão final', () => {
  assert.match(client, /import '\.\/client-portal\.css'/);
  assert.match(client, /client-app/);
  assert.match(client, /mobile-tabs/);
  assert.match(finalCss, /@media\(max-width:760px\)/);
});

test('dashboard demonstrativo aparece com dados fictícios e sem simulador de preços', () => {
  assert.match(client, /function dashboard/);
  assert.match(client, /Acompanhamento da operação/);
  assert.match(client, /Campanha Ceará 2026 - Demonstração/);
  assert.match(client, /os dados abaixo são fictícios/i);
  assert.doesNotMatch(client, /function simulator|Tabela de preços|Simular/);
});

test('validação de CNPJ permanece como única função real do portal temporário', () => {
  assert.match(client, /Validar e-CNPJ A1/);
  assert.match(client, /\/api\/cnpj\/certificate/);
  assert.doesNotMatch(client, /authorize\(|Autorizar DC-e/);
});

test('endpoint público dedicado lê somente os dados necessários do certificado', () => {
  assert.match(endpoint, /readPkcs12/);
  assert.match(endpoint, /parseJson\(req, 5_000_000\)/);
  assert.doesNotMatch(endpoint, /requireUser/);
  assert.match(endpoint, /path: '\/api\/cnpj\/certificate'/);
});
