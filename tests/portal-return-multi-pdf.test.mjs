import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { mergePortalPdfFiles, portalPdfFileKey } from "../src/elections-portal-return-multi-pdf.js";

const html = fs.readFileSync(new URL("../eleicoes.html", import.meta.url), "utf8");
const source = fs.readFileSync(new URL("../src/elections-portal-return-multi-pdf.js", import.meta.url), "utf8");

function pdf(name, size, lastModified = 1) {
  return { name, size, lastModified, type: "application/pdf" };
}

test("acumula PDFs escolhidos em seleções sucessivas sem duplicar", () => {
  const first = pdf("PAC_500_26.08.pdf", 1000, 10);
  const second = pdf("SEDEX_548_26.08.pdf", 1200, 20);
  const merged = mergePortalPdfFiles([first], [second, first]);
  assert.deepEqual(merged.map((file) => file.name), [first.name, second.name]);
  assert.equal(portalPdfFileKey(first), "PAC_500_26.08.pdf::1000::10");
});

test("ignora arquivos que não são PDF", () => {
  const merged = mergePortalPdfFiles([], [pdf("etiquetas.pdf", 10), { name: "retorno.csv", size: 20, type: "text/csv" }]);
  assert.deepEqual(merged.map((file) => file.name), ["etiquetas.pdf"]);
});

test("integra acumulador ao formulário real e intercepta a troca antes dos listeners antigos", () => {
  assert.match(html, /elections-portal-return-multi-pdf\.js/);
  assert.match(source, /new DataTransfer\(\)/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /addEventListener\("change", handleSelection, \{ capture: true \}\)/);
  assert.match(source, /seleções sucessivas/);
});
