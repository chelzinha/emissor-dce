import assert from "node:assert/strict";
import test from "node:test";

import { validateReturnPackageCounts } from "../src/portal-return-service.js";

function docs(...pages) {
  return pages.map((numPages) => ({ doc: { numPages } }));
}

test("aceita quando CSV e PDFs possuem a mesma quantidade", () => {
  assert.deepEqual(validateReturnPackageCounts(new Array(1048), docs(500, 548)), {
    csvCount: 1048,
    pdfPageCount: 1048,
  });
});

test("interrompe antes da auditoria quando faltam páginas de etiquetas", () => {
  assert.throws(
    () => validateReturnPackageCounts(new Array(1048), docs(500), [{ name: "PAC_500_26.08.pdf" }]),
    /CSV contém 1\.048 objetos.*PDFs selecionados somam 500 páginas.*Faltam 548 etiquetas.*PAC_500_26\.08\.pdf/s,
  );
});

test("interrompe quando há páginas de PDF a mais", () => {
  assert.throws(
    () => validateReturnPackageCounts(new Array(500), docs(500, 548)),
    /CSV contém 500 objetos.*PDFs selecionados somam 1\.048 páginas.*Há 548 páginas a mais/s,
  );
});
