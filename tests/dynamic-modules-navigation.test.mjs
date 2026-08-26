import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const html = read('eleicoes.html');
const navigation = read('src/elections-navigation-stability.js');
const tracking = read('src/elections-tracking-ui.js');
const reports = read('src/elections-reports-ui.js');
const finance = read('src/elections-finance-ui.js');
const financeNav = read('src/elections-finance-nav-ui.js');

test('painel carrega acompanhamento, relatórios e financeiro', () => {
  assert.match(html, /elections-tracking-ui\.js/);
  assert.match(html, /elections-reports-ui\.js/);
  assert.match(html, /elections-finance-ui\.js/);
  assert.match(html, /elections-finance-nav-ui\.js/);
});

test('etapas 10 e 11 e botão financeiro usam a navegação dinâmica estável', () => {
  assert.match(navigation, /10:\s*'tracking'/);
  assert.match(navigation, /11:\s*'reports'/);
  assert.match(navigation, /finance:\s*'\.finance-page'/);
  assert.match(navigation, /agf:navigate-view/);
  assert.match(navigation, /nativeViewButton\(view\)\?\.click\(\)/);
  assert.match(financeNav, /data-operation-view/);
  assert.match(financeNav, /Financeiro/);
});

test('cada módulo ativa e desativa seu estado pela navegação central', () => {
  assert.match(tracking, /agf:navigate-view/);
  assert.match(tracking, /trackingActive=false/);
  assert.match(reports, /agf:navigate-view/);
  assert.match(reports, /reportsActive = false/);
  assert.match(finance, /agf:navigate-view/);
  assert.match(finance, /financeActive = false/);
});
