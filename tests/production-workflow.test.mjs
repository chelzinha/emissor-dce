import test from "node:test";
import assert from "node:assert/strict";
import {
  LABEL_TEST_EVENT,
  normalizeProductionObject,
  selectTestRows,
  attachVerifiedCrop,
  buildProductionModels,
  buildTestApprovalEvent,
  approvalStateFromOperations,
  batchGenerationGate,
} from "../src/production-workflow.js";
import { DOCUMENT_MODES } from "../src/label-production.js";

const sender = { name: "REMETENTE TESTE", document: "12345678000199", addressLine: "Rua A, 10", cityLine: "Fortaleza / CE" };
const crop = "data:image/png;base64,AAAA";

function row(sro, service) {
  return {
    trackingCode: sro,
    service,
    matrixStatus: "AUTO_VERIFIED",
    matrix: { status: "AUTO_VERIFIED", stripe: service === "SEDEX" ? "SIM" : "IMP" },
    recipient: { name: "DESTINATARIO", document: "", address: { street: "Rua B", number: "20", city: "Fortaleza", uf: "CE", zip: "60110301" } },
    content: "MATERIAL PROMOCIONAL",
  };
}

test("normaliza objeto vindo do backend e preserva status Matrix", () => {
  const result = normalizeProductionObject(row("oy855182534br", "sedex"));
  assert.equal(result.trackingCode, "OY855182534BR");
  assert.equal(result.service, "SEDEX");
  assert.equal(result.matrix.status, "AUTO_VERIFIED");
});

test("seleciona uma etiqueta teste por servico presente", () => {
  const rows = [row("OY855182534BR", "SEDEX"), row("AA123456789BR", "SEDEX"), row("BB123456789BR", "PAC")];
  const tests = selectTestRows(rows);
  assert.equal(tests.length, 2);
  assert.deepEqual(tests.map((item) => item.service), ["SEDEX", "PAC"]);
});

test("anexa somente o recorte verificado pelo SRO", () => {
  const rows = row("OY855182534BR", "SEDEX");
  const withCrop = attachVerifiedCrop(rows, new Map([["OY855182534BR", crop]]));
  assert.equal(withCrop.matrix.dataUrl, crop);
});

test("constroi modelo simplificado com recorte original", () => {
  const rows = [row("OY855182534BR", "SEDEX")];
  const models = buildProductionModels(rows, new Map([["OY855182534BR", crop]]), {
    documentMode: DOCUMENT_MODES.SIMPLIFIED,
    sender,
  });
  assert.equal(models.length, 1);
  assert.equal(models[0].dataMatrixImage, crop);
  assert.equal(models[0].declaration.mode, DOCUMENT_MODES.SIMPLIFIED);
});

test("evento de aprovacao e idempotente por lote, servico e SRO", () => {
  const model = buildProductionModels([row("OY855182534BR", "SEDEX")], new Map([["OY855182534BR", crop]]), {
    documentMode: DOCUMENT_MODES.SIMPLIFIED,
    sender,
  })[0];
  const event = buildTestApprovalEvent({ campaignId: "C1", productionBatchId: "B1", model });
  assert.equal(event.type, LABEL_TEST_EVENT);
  assert.equal(event.service, "SEDEX");
  assert.equal(event.metadata.scanValidated, true);
  assert.equal(event.idempotencyKey, "label-test-approved:B1:SEDEX:OY855182534BR");
});

test("lote continua bloqueado enquanto teste nao tiver evento de aprovacao", () => {
  const rows = [row("OY855182534BR", "SEDEX")];
  const crops = new Map([["OY855182534BR", crop]]);
  const testModels = buildProductionModels(rows, crops, { documentMode: DOCUMENT_MODES.SIMPLIFIED, sender });
  const blocked = batchGenerationGate({ rows, crops, documentMode: DOCUMENT_MODES.SIMPLIFIED, sender, testModels, operations: [], productionBatchId: "B1", allowSimplified: true });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.problems.includes("ETIQUETA_TESTE_NAO_APROVADA"));

  const event = buildTestApprovalEvent({ campaignId: "C1", productionBatchId: "B1", model: testModels[0] });
  const operations = [{ ...event, sourceId: event.sourceId, metadata: event.metadata, type: event.type, service: event.service }];
  const approval = approvalStateFromOperations(operations, "B1", testModels);
  assert.equal(approval.ready, true);
  const ready = batchGenerationGate({ rows, crops, documentMode: DOCUMENT_MODES.SIMPLIFIED, sender, testModels, operations, productionBatchId: "B1", allowSimplified: true });
  assert.equal(ready.ready, true);
});

test("Data Matrix TEXT_ONLY bloqueia lote mesmo com recorte", () => {
  const bad = row("OY855182534BR", "SEDEX");
  bad.matrixStatus = "TEXT_ONLY";
  bad.matrix.status = "TEXT_ONLY";
  const crops = new Map([["OY855182534BR", crop]]);
  const result = batchGenerationGate({ rows: [bad], crops, documentMode: DOCUMENT_MODES.SIMPLIFIED, sender, testModels: [], operations: [], productionBatchId: "B1", allowSimplified: true });
  assert.ok(result.problems.includes("MATRIX_NAO_VERIFICADO_100_PERCENT"));
});
