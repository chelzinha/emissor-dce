import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const code = fs.readFileSync(new URL("../src/elections-portal-return-package-ui.js", import.meta.url), "utf8");

test("área da agência carrega a conferência do pacote de retorno", () => {
  assert.match(html, /elections-portal-return-package-ui\.js/);
  assert.match(html, /elections-portal-return-multi-pdf\.js/);
});

test("interface mostra quantidade do CSV e todos os PDFs acumulados", () => {
  assert.match(code, /objetos no CSV/);
  assert.match(code, /PDF.*acumulado/s);
  assert.match(code, /seleções sucessivas/);
  assert.match(code, /portal-return:pdf-selection/);
  assert.match(code, /clearStaleAnalysis/);
});
