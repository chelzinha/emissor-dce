import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../src/elections-manual-preparation-ui.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/elections-manual-preparation-ui.css", import.meta.url), "utf8");

test("Etapa 1 carrega o controle manual de preparação", () => {
  assert.match(html, /elections-manual-preparation-ui\.js/);
  assert.match(js, /Quantidade higienizada/);
  assert.match(js, /addressCleaned/);
  assert.match(js, /campaign\.upsert/);
});

test("ação visível de higienização é removida da tabela", () => {
  assert.match(js, /\[data-clean\]/);
  assert.match(js, /stopImmediatePropagation/);
  assert.match(css, /\[data-clean\]\{display:none!important\}/);
  assert.match(css, /manual-preparation-hidden-column/);
});

test("arquivo continua sendo preparado internamente em blocos pequenos", () => {
  assert.match(js, /INTERNAL_CHUNK = 25/);
  assert.match(js, /MIN_CHUNK = 5/);
  assert.match(js, /addressRows\.list/);
  assert.match(js, /cleaning\.process/);
  assert.match(js, /504\|timeout\|tempo/);
});
