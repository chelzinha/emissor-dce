import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const matrix = fs.readFileSync(new URL("../src/matrix-engine.js", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../src/portal-return-service.js", import.meta.url), "utf8");

test("auditoria grande não retém imagens de todas as páginas por padrão", () => {
  assert.match(matrix, /const keepCrops = options\.keepCrops === true/);
  assert.match(matrix, /if \(keepCrops\) crops\.set/);
  assert.match(matrix, /releaseCanvas\(crop\)/);
  assert.match(matrix, /page\.cleanup\?\.\(\)/);
});

test("leitor processa o canvas diretamente sem converter cada página em base64", () => {
  assert.match(matrix, /decodeDataMatrixCanvas/);
  assert.match(matrix, /decodeCanvasAtScale/);
  assert.doesNotMatch(matrix, /let cropDataUrl = crop\.toDataURL/);
  assert.doesNotMatch(matrix, /for \(const scale of \[1, 3\]\)/);
});

test("PDFs são sondados e reabertos sob demanda, mantendo apenas um documento ativo", () => {
  assert.match(matrix, /function createLazyPdfDocument/);
  assert.match(matrix, /const probe = await pdfjsLib\.getDocument/);
  assert.match(matrix, /await destroyPdfDocument\(probe\)/);
  assert.match(matrix, /try \{ await item\.doc\.cleanup\?\.\(\); \}/);
  assert.match(matrix, /activeDocument = null/);
});

test("serviço libera os documentos e informa a consolidação final", () => {
  assert.match(service, /keepCrops: false/);
  assert.match(service, /releasePdfDocuments/);
  assert.match(service, /stage: "consolidating"/);
  assert.match(service, /stage: "complete"/);
});
