import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/elections-approved-ui.js', import.meta.url), 'utf8');

test('base recebida avanca para higienizacao antes do Portal Postal', () => {
  assert.match(source, /Higienizar próximo bloco/);
  assert.match(source, /Exportar CSV PAC\/SEDEX/);
  assert.match(source, /Receba a base, higienize os cadastros e só depois exporte o CSV/);
  assert.doesNotMatch(source, /bases:\["portal","Seguir para Portal Postal"\]/);
});
