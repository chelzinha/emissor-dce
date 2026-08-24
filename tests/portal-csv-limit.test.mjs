import assert from 'node:assert/strict';
import test from 'node:test';
import { PORTAL_CSV_MAX_ROWS, splitPortalCsv } from '../src/elections-portal-csv-limit-ui.js';

function sampleCsv(total) {
  const header = 'NOME;CEP;SERVICO';
  const rows = Array.from({ length: total }, (_, index) => `Pessoa ${index + 1};60000000;PAC`);
  return `${header}\r\n${rows.join('\r\n')}\r\n`;
}

test('limite operacional do Portal é 500 cadastros por arquivo', () => {
  assert.equal(PORTAL_CSV_MAX_ROWS, 500);
});

test('1600 cadastros viram quatro CSVs de 500, 500, 500 e 100', () => {
  const parts = splitPortalCsv(sampleCsv(1600), 'portal_postal_PAC_1600.csv');
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.map((part) => part.count), [500, 500, 500, 100]);
  assert.equal(parts[0].fileName, 'portal_postal_PAC_1600_parte_01_de_04.csv');
  assert.equal(parts[3].fileName, 'portal_postal_PAC_1600_parte_04_de_04.csv');
  parts.forEach((part) => {
    assert.equal(part.content.split(/\r?\n/).filter(Boolean)[0], 'NOME;CEP;SERVICO');
  });
});

test('até 500 cadastros permanecem em um único CSV', () => {
  const parts = splitPortalCsv(sampleCsv(500), 'portal_postal_SEDEX_500.csv');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].count, 500);
  assert.equal(parts[0].fileName, 'portal_postal_SEDEX_500.csv');
});

test('mais de 2000 cadastros são divididos em tantas partes quanto necessário', () => {
  const parts = splitPortalCsv(sampleCsv(2501), 'portal.csv');
  assert.deepEqual(parts.map((part) => part.count), [500, 500, 500, 500, 500, 1]);
  assert.equal(parts[5].fileName, 'portal_parte_06_de_06.csv');
});
