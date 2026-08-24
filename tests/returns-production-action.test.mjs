import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const release = fs.readFileSync(new URL('../src/elections-release-simplified.js', import.meta.url), 'utf8');

test('retorno pronto deixa claro que apenas escolhe a modalidade documental', () => {
  assert.match(release, /Usar Declaração Simplificada/);
  assert.match(release, /Cria o lote de produção/);
});

test('retorno em produção oferece continuação em vez de nova criação', () => {
  assert.match(release, /status === 'IN_PRODUCTION'/);
  assert.match(release, /Continuar na Produção/);
  assert.match(release, /data-simplified-return-action/);
  assert.match(release, /continueToProduction/);
});

test('status traduzido continua preservando o código técnico para a regra funcional', () => {
  assert.match(release, /dataset\.statusCode/);
  assert.match(release, /Modalidade operacional atual/);
});
