import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../src/elections-cumulative-dashboard.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/elections-cumulative-dashboard.css", import.meta.url), "utf8");

test("área da agência carrega o dashboard acumulado", () => {
  assert.match(html, /elections-cumulative-dashboard\.js/);
  assert.match(js, /OPERAÇÃO ACUMULADA/);
  assert.match(js, /Resumo consolidado de tudo que está registrado na base/);
  assert.match(js, /operations\.list/);
  assert.match(js, /tracking\.summary/);
});

test("diário agrupa a operação por dia em PAC, SEDEX e total", () => {
  assert.match(js, /function dailyOperationRows/);
  assert.match(js, /LABEL_GENERATED/);
  assert.match(js, /POSTING_COMPLETED/);
  assert.match(js, /<th>PAC<\/th><th>SEDEX<\/th><th>Total<\/th>/);
  assert.match(js, /TOTAL GERAL/);
});

test("diário tem apresentação responsiva e totalizador destacado", () => {
  assert.match(css, /daily-diary-table/);
  assert.match(css, /tfoot/);
  assert.match(css, /@media\(max-width:760px\)/);
});
