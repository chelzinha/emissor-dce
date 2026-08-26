import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const code = fs.readFileSync(new URL("../src/elections-portal-return-package-ui.js", import.meta.url), "utf8");

test("área da agência carrega a conferência do pacote de retorno", () => {
  assert.match(html, /elections-portal-return-package-ui\.js/);
});

test("interface mostra quantidade do CSV e todos os PDFs selecionados", () => {
  assert.match(code, /objetos no CSV/);
  assert.match(code, /PDF.*selecionado/s);
  assert.match(code, /escolha todos de uma vez neste campo/);
  assert.match(code, /clearStaleAnalysis/);
});
