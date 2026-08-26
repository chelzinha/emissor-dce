import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../src/elections-admin.js", import.meta.url), "utf8");
const navigation = fs.readFileSync(new URL("../src/elections-navigation-stability.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/elections-cumulative-dashboard.css", import.meta.url), "utf8");

test("dashboard acumulado é renderizado nativamente sem painel diário intermediário", () => {
  assert.doesNotMatch(html, /elections-cumulative-dashboard\.js/);
  assert.match(admin, /OPERAÇÃO ACUMULADA/);
  assert.match(admin, /Resumo consolidado de tudo que está registrado na base/);
  assert.match(admin, /operations\.list/);
  assert.match(admin, /tracking\.summary/);
  assert.doesNotMatch(admin, /dashboard\.daily/);
});

test("diário agrupa a operação por dia em PAC, SEDEX e total", () => {
  assert.match(admin, /function dailyOperationRows/);
  assert.match(admin, /LABEL_GENERATED/);
  assert.match(admin, /POSTING_COMPLETED/);
  assert.match(admin, /<th>PAC<\/th><th>SEDEX<\/th><th>Total<\/th>/);
  assert.match(admin, /TOTAL GERAL/);
});

test("dashboard mantém indicadores manuais e dados automáticos acumulados", () => {
  assert.match(admin, /function manualMetrics/);
  assert.match(admin, /campaign\.get/);
  assert.match(admin, /campaign\.upsert/);
  assert.match(admin, /Base recebida/);
  assert.match(admin, /Higienizados/);
  assert.match(admin, /Informado manualmente/);
  assert.match(admin, /Acumulado automático/);
});

test("menu lateral encaminha o clique ao botão nativo sem propagação recursiva", () => {
  assert.match(html, /elections-navigation-stability\.js/);
  assert.match(navigation, /data-operation-view/);
  assert.match(navigation, /stopImmediatePropagation/);
  assert.match(navigation, /bubbles: false/);
  assert.match(navigation, /AGF_OPERATION_STAGE_FULL_1_11/);
});

test("editor manual e diário têm apresentação responsiva", () => {
  assert.match(css, /manual-metrics-panel/);
  assert.match(css, /metric-card\.is-manual/);
  assert.match(css, /daily-diary-table/);
  assert.match(css, /tfoot/);
  assert.match(css, /@media\(max-width:760px\)/);
});
