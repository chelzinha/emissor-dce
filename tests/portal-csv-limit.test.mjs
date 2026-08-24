import assert from 'node:assert/strict';
import test from 'node:test';
import { PORTAL_CSV_MAX_ROWS, splitPortalCsv } from '../src/elections-portal-csv-limit-ui.js';

function sampleCsv(total) {
  const header = 'NOME;CEP;SERVICO';
  const rows = Array.from({ length: total }, (_, index) => `Pessoa ${index + 1};60000000;PAC`);
  return `${header}\r\n${rows.join('\r\n')}\r\n`;
}

test('limite do Portal é 1000 cadastros por arquivo', () => {
  assert.equal(PORTAL_CSV_MAX_ROWS, 1000);
});

test('1600 cadastros viram dois CSVs de 1000 e 600', () => {
  const parts = splitPortalCsv(sampleCsv(1600), 'portal_postal_PAC_1600.csv');
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((part) => part.count), [1000, 600]);
  assert.equal(parts[0].fileName, 'portal_postal_PAC_1600_parte_01_de_02.csv');
  assert.equal(parts[1].fileName, 'portal_postal_PAC_1600_parte_02_de_02.csv');
  assert.equal(parts[0].content.split(/\r?\n/).filter(Boolean)[0], 'NOME;CEP;SERVICO');
  assert.equal(parts[1].content.split(/\r?\n/).filter(Boolean)[0], 'NOME;CEP;SERVICO');
});

test('até 1000 cadastros permanecem em um único CSV', () => {
  const parts = splitPortalCsv(sampleCsv(1000), 'portal_postal_SEDEX_1000.csv');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].count, 1000);
  assert.equal(parts[0].fileName, 'portal_postal_SEDEX_1000.csv');
});

test('mais de 2000 cadastros são divididos em tantas partes quanto necessário', () => {
  const parts = splitPortalCsv(sampleCsv(2501), 'portal.csv');
  assert.deepEqual(parts.map((part) => part.count), [1000, 1000, 501]);
  assert.equal(parts[2].fileName, 'portal_parte_03_de_03.csv');
});
