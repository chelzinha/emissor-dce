import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';

const html = await readFile(new URL('../eleicoes.html', import.meta.url), 'utf8');
const picker = await readFile(new URL('../src/elections-file-picker-fix.js', import.meta.url), 'utf8');
const label = await readFile(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const spec = await import('../src/label-production.js');

test('retorno do Portal usa botoes explicitos para abrir os inputs nativos', () => {
  assert.match(html, /elections-file-picker-fix\.js/);
  assert.match(picker, /#portal-return-csv/);
  assert.match(picker, /#portal-return-pdfs/);
  assert.match(picker, /label-setup-modal \[data-stamp\]/);
  assert.match(picker, /pointer-events:auto!important/);
});

test('clique dos seletores usa delegacao no document, nao listener por elemento', () => {
  // shell() faz app.innerHTML a cada render e destroi listeners ligados a
  // elementos. A delegacao no document e registrada uma vez e sobrevive.
  assert.match(picker, /document\.addEventListener\('click'/);
  assert.match(picker, /\[data-agf-picker\]/);
  // impede que o clique suba e dispare troca de tela antes do seletor abrir
  assert.match(picker, /stopImmediatePropagation/);
  // a referencia ao input vive no DOM, nao numa closure
  assert.match(picker, /dataset\.agfTarget/);
  assert.doesNotMatch(picker, /button\.addEventListener\('click'/);
});

test('nenhum input de arquivo fica dentro de label', () => {
  // Um <label> ao redor do input dispara ativacao implicita, que sobe ate um
  // [data-view] e provoca render completo, destruindo o input antes de o
  // seletor abrir. Confirmado no navegador em 24/08/2026.
  const fontes = [
    'client-portal.js', 'elections-portal-return-ui.js', 'elections-rate-table-ui.js',
    'elections-tracking-ui.js', 'label-setup-ui.js', 'main.js',
  ];
  for (const nome of fontes) {
    const fonte = fs.readFileSync(new URL(`../src/${nome}`, import.meta.url), 'utf8');
    const dentroDeLabel = /<label[^>]*>(?:(?!<\/label>)[\s\S])*?type="file"/;
    assert.doesNotMatch(fonte, dentroDeLabel, `${nome} ainda tem input[type=file] dentro de <label>`);
  }
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
