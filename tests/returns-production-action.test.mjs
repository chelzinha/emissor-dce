import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const release = fs.readFileSync(new URL('../src/elections-release-simplified.js', import.meta.url), 'utf8');

test('retorno READY deixa claro que apenas escolhe a modalidade documental', () => {
  assert.match(release, /Usar Declaração Simplificada/);
  assert.match(release, /Os PDFs são gerados na etapa Produção/);
});

test('retorno IN_PRODUCTION não exibe a declaração como botão desabilitado', () => {
  assert.match(release, /status === 'IN_PRODUCTION'/);
  assert.match(release, /Continuar na Produção/);
  assert.match(release, /data-simplified-return-action/);
  assert.match(release, /productionNav\.click\(\)/);
});

test('tela explica onde a etiqueta unificada é gerada e impressa', () => {
  assert.match(release, /geração e impressão dos PDFs acontece em Produção/);
  assert.match(release, /etiqueta unificada é gerada e impressa na etapa Produção/);
});
