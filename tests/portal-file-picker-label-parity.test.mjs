import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../eleicoes.html', import.meta.url), 'utf8');
const picker = await readFile(new URL('../src/elections-file-picker-fix.js', import.meta.url), 'utf8');
const label = await readFile(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const spec = await import('../src/label-production.js');

test('retorno do Portal usa botoes explicitos para abrir os inputs nativos', () => {
  assert.match(html, /elections-file-picker-fix\.js/);
  assert.match(picker, /#portal-return-csv/);
  assert.match(picker, /#portal-return-pdfs/);
  assert.match(picker, /label-setup-modal \[data-stamp\]/);
  assert.match(picker, /input\.click\(\)/);
  assert.match(picker, /pointer-events:auto!important/);
});

test('grade 10x15 preserva medidas do gerador local', () => {
  const format = spec.LABEL_FORMATS['10x15'];
  assert.equal(format.widthMm, 100);
  assert.equal(format.heightMm, 150);
  assert.equal(format.marginMm, 4);
  assert.equal(format.trackingBarcode.widthMm, 80);
  assert.equal(format.trackingBarcode.heightMm, 11.5);
  assert.equal(format.zipBarcode.widthMm, 40);
  assert.equal(format.zipBarcode.heightMm, 13);
  assert.equal(format.zipBarcode.xMm, 56);
  assert.deepEqual(format.zones, {
    top: 23,
    tracking: 20,
    receiver: 8.5,
    recipient: 23,
    sender: 12,
    separator: 2.5,
    declarationTitle: 4.2,
    declarationId: 9.5,
    declarationParties: 13,
    declarationItems: 6,
    declarationLegal: 19.5,
  });
});

test('etiqueta usa simbolos PAC e SEDEX e rotulos conferidos no Portal', () => {
  assert.match(label, /family === 'SEDEX'/);
  assert.match(label, /family === 'PAC'/);
  assert.match(label, /modal: 'EXPRESSA'/);
  assert.match(label, /modal: 'STANDARD'/);
  assert.match(label, /drawRoutingSymbol/);
  assert.match(label, /width: mm\(40\), height: mm\(13\)/);
  assert.match(label, /formatTracking\(tracking\)/);
});
