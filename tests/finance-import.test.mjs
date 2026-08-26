import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinanceDate, normalizeFinanceService, parseConsolidadorCsv, parseMoney } from '../src/finance-import.js';

test('valores brasileiros e internacionais são normalizados sem perder centavos', () => {
  assert.equal(parseMoney('R$ 17.120,00'), 17120);
  assert.equal(parseMoney('12.144,35'), 12144.35);
  assert.equal(parseMoney('12144.35'), 12144.35);
});

test('datas e códigos ECT identificam PAC e SEDEX', () => {
  assert.equal(normalizeFinanceDate('25/08/2026'), '2026-08-25');
  assert.equal(normalizeFinanceDate('2026-08-24 10:30'), '2026-08-24');
  assert.equal(normalizeFinanceService('', '4510'), 'PAC');
  assert.equal(normalizeFinanceService('', '04014'), 'SEDEX');
});

test('CSV do Consolidador ignora total sem SRO e preserva grupos financeiros', () => {
  const csv = [
    'OBJETO;ECT;DATA;QTD;VALOR;LISTA;CODIGO PP',
    'QN909523035BR;4510;25/08/2026;1;27,52;191787;4823127',
    'OY855189170BR;4014;24/08/2026;1;31,10;191540;4820226',
    ';TOTAL;;;58,62;;',
  ].join('\n');
  const parsed = parseConsolidadorCsv(csv);
  assert.equal(parsed.validRows.length, 2);
  assert.equal(parsed.invalidRows.length, 0);
  assert.equal(parsed.skippedWithoutSro, 1);
  assert.equal(parsed.summary.totalObjects, 2);
  assert.equal(parsed.summary.totalAmount, 58.62);
  assert.equal(parsed.summary.pac.amount, 27.52);
  assert.equal(parsed.summary.sedex.amount, 31.10);
  assert.equal(parsed.validRows[0].listId, '191787');
});
