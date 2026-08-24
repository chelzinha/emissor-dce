import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// O componente elections-approved-ui.js foi removido em 24/08/2026 por estar
// oculto por CSS e concorrer com as 8 etapas atuais. Este teste validava
// textos que só existiam nele; foi reescrito contra o fluxo vivo.
const source = fs.readFileSync(new URL('../src/elections-base-flow-v2.js', import.meta.url), 'utf8');

test('base recebida avanca para higienizacao completa antes do Portal Postal', () => {
  assert.match(source, /Importar base completa/);
  assert.match(source, /Higienizar base/);
  assert.match(source, /Higienização concluída para a base completa\./);
  assert.match(source, /Gerar CSV para o Portal Postal/);
  // a higienização é da base inteira, nunca por blocos parciais
  assert.doesNotMatch(source, /Higienizar próximo bloco/);
});

test('o CSV do Portal só é liberado depois da higienização', () => {
  assert.match(source, /Higienização concluída\. Existem cadastros para revisão\./);
  assert.match(source, /Ainda há pendências\./);
});
