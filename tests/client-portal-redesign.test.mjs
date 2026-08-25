import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/client-cnpj-temp.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/client-cnpj-temp-redesign.css', import.meta.url), 'utf8');

test('portal temporário mantém a função real de validação de CNPJ', () => {
  assert.match(html, /client-cnpj-temp\.js/);
  assert.match(js, /api\('\/api\/cnpj\/certificate'/);
  assert.match(js, /validCnpj/);
  assert.match(js, /fileToBase64/);
  assert.match(js, /Esta versão não autoriza DC-e/);
});

test('redesign preserva o CSS compartilhado da versão final', () => {
  assert.match(js, /import '\.\/client-portal\.css'/);
  assert.match(js, /import '\.\/client-cnpj-temp-redesign\.css'/);
  assert.match(js, /temp-client/);
});

test('dashboard demonstrativo recebe hero, cards coloridos e ícones vetoriais', () => {
  assert.match(js, /hero-dashboard/);
  assert.match(js, /service-\$\{tone\}/);
  assert.match(js, /Panorama da operação/);
  assert.match(js, /<svg class="app-icon/);
  assert.match(css, /service-pac/);
  assert.match(css, /service-sedex/);
  assert.match(css, /hero-dashboard/);
});

test('tela de validação segue o mockup sem remover os campos reais', () => {
  for (const marker of ['Validar e-CNPJ A1', 'Lote DC-e 000184', 'target-cnpj', 'temp-cert', 'temp-pass', 'validate-cnpj']) {
    assert.match(js, new RegExp(marker));
  }
  assert.match(js, /certificate-fields/);
  assert.match(js, /file-picker/);
  assert.match(js, /toggle-pass/);
});

test('redesign é mobile-first e mantém navegação inferior', () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /mobile-tabs/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(js, /aria-label="Navegação principal"/);
});
