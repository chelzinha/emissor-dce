import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';

const html = await readFile(new URL('../eleicoes.html', import.meta.url), 'utf8');
const picker = await readFile(new URL('../src/elections-file-picker-fix.js', import.meta.url), 'utf8');
const generator = await readFile(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/production-label-layout-v13.js', import.meta.url), 'utf8');
const spec = await import('../src/label-production.js');

test('o input de arquivo nativo fica visivel, sem truque de sobreposicao', () => {
  assert.match(html, /elections-file-picker-fix\.js/);
  assert.match(picker, /#portal-return-csv/);
  assert.match(picker, /#portal-return-pdfs/);
  assert.match(picker, /label-setup-modal \[data-stamp\]/);
  const semComentarios = picker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(picker, /agf-native-file-visible/);
  assert.match(picker, /pointer-events:auto!important/);
  assert.doesNotMatch(semComentarios, /input\.click\(\)/);
  assert.doesNotMatch(semComentarios, /\.showPicker\(\)/);
  assert.match(picker, /event\.stopPropagation\(\)/);
});

test('nenhum input de arquivo fica dentro de label', () => {
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

test('grade 10x15 preserva medidas do gerador local v13', () => {
  const format = spec.LABEL_FORMATS['10x15'];
  assert.equal(format.widthMm, 100);
  assert.equal(format.heightMm, 150);
  assert.equal(format.marginMm, 4);
  assert.equal(format.trackingBarcode.widthMm, 80);
  assert.equal(format.trackingBarcode.heightMm, 11.5);
  assert.equal(format.zipBarcode.widthMm, 19.7);
  assert.equal(format.zipBarcode.heightMm, 13);
  assert.equal(format.zipBarcode.xMm, 62);
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

test('etiqueta usa símbolos PAC e SEDEX e rótulos conferidos no Portal', () => {
  assert.match(generator, /renderUnifiedLabelV13/);
  assert.match(layout, /serviceFamily\(service\) === 'SEDEX'/);
  assert.match(layout, /s\.startsWith\('PAC'\)/);
  assert.match(layout, /modal: 'EXPRESSA'/);
  assert.match(layout, /modal: 'STANDARD'/);
  assert.match(layout, /drawRoutingSymbol/);
  assert.match(layout, /w: 19\.7, h: 13, x: 62/);
  assert.match(layout, /formatTracking\(tracking\)/);
});
