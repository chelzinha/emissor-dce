import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYTICAL_POSTINGS_HEADERS,
  classifyTrackingStatus,
  parseTrackingCsv,
  trackingImportRows,
} from '../src/tracking-import.js';

function analyticalRow(overrides = {}) {
  const row = Object.fromEntries(ANALYTICAL_POSTINGS_HEADERS.map((header) => [header, '']));
  Object.assign(row, {
    OBJETO: 'OY855197627BR',
    SERVICO: 'SEDEX',
    PESO: '700',
    QTD: '1',
    POSTAGEM: '26/08/2026',
    VALOR: '27,60',
    DESTINATARIO: 'DESTINATARIO TESTE',
    CEP: '60762-376',
    SITUACAO: 'Objeto em transferência - por favor aguarde',
    DATA_SITUACAO: '26/08/2026',
    CIDADE: 'FORTALEZA',
    UF: 'CE',
    CODIGO_ECT: '4014',
    ...overrides,
  });
  return ANALYTICAL_POSTINGS_HEADERS.map((header) => row[header]).join(';');
}

const header = ANALYTICAL_POSTINGS_HEADERS.join(';');

test('aceita diretamente o cabeçalho do relatório analítico de postagens', () => {
  const parsed = parseTrackingCsv([header, analyticalRow()].join('\n'));
  assert.equal(parsed.format, 'POSTAGENS_ANALITICO');
  assert.equal(parsed.headers.length, 32);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.summary, { total: 1, valid: 1, ignored: 0, invalid: 0 });
  assert.equal(parsed.rows[0].trackingCode, 'OY855197627BR');
  assert.equal(parsed.rows[0].location, 'FORTALEZA/CE');
  assert.equal(parsed.rows[0].category, 'IN_TRANSIT');
});

test('ignora SEM_REGISTRO sem transformar a linha em pendência', () => {
  const csv = [
    header,
    analyticalRow({
      OBJETO: 'SEM_REGISTRO',
      SERVICO: 'OPERACAO A - ETIQUETAGEM - PACOTE',
      QTD: '1299',
      SITUACAO: 'Objeto postado',
      DATA_SITUACAO: '',
      CIDADE: '',
      UF: '',
    }),
    analyticalRow(),
  ].join('\n');
  const parsed = parseTrackingCsv(csv);
  assert.deepEqual(parsed.summary, { total: 2, valid: 1, ignored: 1, invalid: 0 });
  assert.equal(parsed.rows[0].ignored, true);
  assert.equal(parsed.rows[0].ignoreReason, 'SEM_REGISTRO');
  assert.equal(trackingImportRows(parsed.rows).length, 1);
});

test('classifica situações reais ainda não reconhecidas como ocorrências', () => {
  assert.equal(classifyTrackingStatus('Saída para entrega cancelada'), 'EXCEPTION');
  assert.equal(classifyTrackingStatus('Objeto encaminhado para retirada no endereço indicado'), 'EXCEPTION');
  assert.equal(classifyTrackingStatus('Inconsistências no endereçamento do objeto'), 'EXCEPTION');
  assert.equal(classifyTrackingStatus('Inconsistências no endereçamento do objeto.'), 'EXCEPTION');
});
