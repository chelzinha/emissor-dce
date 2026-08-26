import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const layout = fs.readFileSync(new URL('../src/production-label-layout-v13.js', import.meta.url), 'utf8');
const generator = fs.readFileSync(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const setup = fs.readFileSync(new URL('../src/label-setup.js', import.meta.url), 'utf8');
const setupUi = fs.readFileSync(new URL('../src/label-setup-ui.js', import.meta.url), 'utf8');

test('layout 10x15 mantém as medidas aprovadas no app local', () => {
  assert.match(layout, /barObj: Object\.freeze\(\{ w: 80, h: 11\.5 \}\)/);
  assert.match(layout, /barCep: Object\.freeze\(\{ w: 19\.7, h: 13, x: 62 \}\)/);
  assert.match(layout, /simb: Object\.freeze\(\{ w: 15, h: 17 \}\)/);
  assert.match(layout, /txt: 6\.0, bar: 7\.5, fs: 13/);
  assert.match(layout, /nome: 9\.8/);
  assert.match(layout, /cep: 21\.9/);
});

test('texto usa baseline fixo e escala sem alterar o grid', () => {
  assert.match(layout, /y: topY\(yBase\)/);
  assert.doesNotMatch(layout, /topY\(yBase\) - current/);
  assert.match(layout, /DEFAULT_LABEL_FONT_SCALE = 0\.8/);
  assert.match(layout, /Math\.min\(1\.1, Math\.max\(0\.8, base\)\)/);
});

test('geração de teste e volumes compartilham o motor v13', () => {
  assert.match(generator, /renderUnifiedLabelV13/);
  assert.match(generator, /normalizeUnifiedLabelFontScale\(assets\?\.labelSetup\?\.fontScale\)/);
  assert.match(generator, /production\.documents\.test/);
  assert.match(generator, /production\.documents\.volume/);
});

test('configuração oferece escala de 0,80 a 1,10', () => {
  assert.match(setup, /DEFAULT_LABEL_FONT_SCALE = 0\.8/);
  assert.match(setup, /fontScale: normalizeLabelFontScale\(source\.fontScale\)/);
  assert.match(setupUi, /data-font-scale/);
  assert.match(setupUi, /min="0\.80" max="1\.10"/);
});
