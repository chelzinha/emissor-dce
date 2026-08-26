import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../src/elections-manual-preparation-ui.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/elections-manual-preparation-ui.css", import.meta.url), "utf8");

test("Etapa 1 carrega um único controle manual de preparação", () => {
  assert.match(html, /elections-manual-preparation-ui\.js/);
  assert.match(js, /Quantidade higienizada/);
  assert.match(js, /addressCleaned/);
  assert.match(js, /campaign\.upsert/);
  assert.match(js, /existing\.slice\(1\)\.forEach/);
  assert.match(js, /panel\.dataset\.manualPreparationPanel/);
});

test("ação visível de higienização é removida da tabela", () => {
  assert.match(js, /\[data-clean\]/);
  assert.match(js, /stopImmediatePropagation/);
  assert.match(css, /\[data-clean\]\{display:none!important\}/);
  assert.match(css, /manual-preparation-hidden-column/);
});

test("a tela não dispara processamento automático do CSV", () => {
  assert.doesNotMatch(js, /cleaning\.process/);
  assert.doesNotMatch(js, /addressRows\.list/);
  assert.doesNotMatch(js, /preparePendingBases/);
  assert.match(js, /Nenhuma higienização automática é executada nesta tela/);
});
