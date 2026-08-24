import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/elections-approved-ui.js', import.meta.url), 'utf8');

test('base recebida avanca para higienizacao completa antes do Portal Postal', () => {
  assert.match(source, /Higienizar base/);
  assert.match(source, /Revisar pendências/);
  assert.match(source, /Definir postagem e exportar/);
  assert.match(source, /Importe a base completa, higienize e revise o que for necessário/);
  assert.doesNotMatch(source, /Higienizar próximo bloco/);
  assert.doesNotMatch(source, /bases:\["portal","Seguir para Portal Postal"\]/);
});
