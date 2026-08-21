import test from "node:test";
import assert from "node:assert/strict";
import { summarizePortalReturn } from "../src/portal-return.js";
import { DOCUMENT_MODES, buildUnifiedLabelModel, productionReadiness } from "../src/label-production.js";
import { buildUnifiedLabelLayout, validateUnifiedLabelForTest, validateZoneGeometry } from "../src/unified-label-layout.js";

const baseRow = {
  trackingCode: "OY855182534BR",
  service: "SEDEX",
  recipient: {
    name: "DESTINATARIO TESTE",
    document: "",
    address: {
      street: "RUA TESTE",
      number: "100",
      complement: "",
      district: "CENTRO",
      city: "FORTALEZA",
      uf: "CE",
      zip: "60110301",
    },
  },
  content: "MATERIAL PROMOCIONAL IMPRESSO",
};

test("retorno so fica pronto com 100 por cento do Data Matrix verificado", () => {
  const rows = [
    { ...baseRow, matrix: { status: "AUTO_VERIFIED" }, errors: [] },
    { ...baseRow, trackingCode: "OY855182548BR", matrix: { status: "TEXT_ONLY" }, errors: [] },
  ];
  const summary = summarizePortalReturn(rows);
  assert.equal(summary.matrixVerified, 1);
  assert.equal(summary.matrixPending, 1);
  assert.equal(summary.readyForProduction, false);
});

test("status VERIFIED tambem e aceito quando houve conferencia valida", () => {
  const rows = [
    { ...baseRow, matrix: { status: "AUTO_VERIFIED" }, errors: [] },
    { ...baseRow, trackingCode: "OY855182548BR", matrix: { status: "VERIFIED" }, errors: [] },
  ];
  const summary = summarizePortalReturn(rows);
  assert.equal(summary.matrixVerified, 2);
  assert.equal(summary.readyForProduction, true);
});

test("producao bloqueia TEXT_ONLY mesmo sem outros erros", () => {
  const row = { ...baseRow, matrix: { status: "TEXT_ONLY" } };
  const result = productionReadiness({
    row,
    documentMode: DOCUMENT_MODES.SIMPLIFIED,
    testLabelApproved: true,
  });
  assert.equal(result.ready, false);
  assert.ok(result.problems.includes("MATRIX_NAO_VALIDADO"));
});

test("grid 10x15 permanece dentro da pagina e fecha em 145.2 mm", () => {
  const result = validateZoneGeometry("10x15");
  assert.equal(result.valid, true);
  assert.equal(result.bottomMm, 145.2);
  assert.equal(result.maxBottomMm, 146);
});

test("layout simplificado nao exibe campos de autorizacao DC-e", () => {
  const model = buildUnifiedLabelModel({
    ...baseRow,
    matrix: { status: "AUTO_VERIFIED", dataUrl: "data:image/png;base64,AA==", stripe: "SIM" },
  }, {
    documentMode: DOCUMENT_MODES.SIMPLIFIED,
    sender: {
      name: "REMETENTE TESTE",
      document: "12345678000199",
      addressLine: "RUA DO REMETENTE, 10",
      cityLine: "FORTALEZA - CE",
    },
  });
  const layout = buildUnifiedLabelLayout(model);
  assert.equal(layout.declaration.kind, "SIMPLIFIED");
  assert.equal(layout.declaration.showDceAuthorization, false);
  assert.equal(layout.declaration.showQrCode, false);
  assert.equal(layout.requirements.originalDataMatrix, true);
});

test("etiqueta teste simplificada exige confirmacao explicita do modo", () => {
  const model = buildUnifiedLabelModel({
    ...baseRow,
    matrix: { status: "AUTO_VERIFIED", dataUrl: "data:image/png;base64,AA==" },
  }, {
    documentMode: DOCUMENT_MODES.SIMPLIFIED,
    sender: {
      name: "REMETENTE TESTE",
      document: "12345678000199",
      addressLine: "RUA DO REMETENTE, 10",
      cityLine: "FORTALEZA - CE",
    },
  });
  const pending = validateUnifiedLabelForTest(model);
  assert.equal(pending.ready, false);
  assert.ok(pending.problems.includes("CONFIRMACAO_DECLARACAO_SIMPLIFICADA_PENDENTE"));
  const ready = validateUnifiedLabelForTest(model, { allowSimplified: true });
  assert.equal(ready.ready, true);
});
