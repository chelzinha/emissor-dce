import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const bridge = fs.readFileSync(new URL('../src/elections-production-status-bridge.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('status traduzidos preservam o código técnico usado pelos módulos de produção', () => {
  assert.match(bridge, /dataset\?\.statusCode \|\| chip\?\.dataset\?\.systemCode/);
  assert.match(bridge, /chip\.dataset\.statusCode = code/);
  assert.match(bridge, /attributeFilter: \['data-system-code'\]/);
});

test('ponte de status carrega antes dos gates e documentos de produção', () => {
  const bridgeIndex = html.indexOf('/src/elections-production-status-bridge.js');
  const gatesIndex = html.indexOf('/src/elections-production-ops-ui.js');
  const documentsIndex = html.indexOf('/src/elections-production-documents-ui.js');
  assert.ok(bridgeIndex > 0);
  assert.ok(bridgeIndex < gatesIndex);
  assert.ok(bridgeIndex < documentsIndex);
});
