import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const portal = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const portalJs = fs.readFileSync(new URL('../src/client-portal.js', import.meta.url), 'utf8');
const finance = fs.readFileSync(new URL('../src/client-finance-highlights.js', import.meta.url), 'utf8');

test('portal do cliente mantém exatamente três áreas principais', () => {
  assert.match(portalJs, /\["dashboard","▥","Dashboard"\]/);
  assert.match(portalJs, /\["simulator","▦","Simulador"\]/);
  assert.match(portalJs, /\["authorization","✓","Autorizar DC-e"\]/);
  assert.doesNotMatch(portalJs, /\["finance"/);
});

test('financeiro aparece dentro do Dashboard e usa somente o resumo da campanha', () => {
  assert.match(portal, /client-finance-highlights\.js/);
  assert.match(finance, /finance\.summary/);
  assert.match(finance, /Financeiro da operação/);
  assert.match(finance, /Saldo em aberto/);
  assert.doesNotMatch(finance, /finance\.payments\.list|finance\.payment\.record/);
});
