import test from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedLabelModel, declarationDescriptor, DOCUMENT_MODES } from "../src/label-production.js";
import { batchGenerationGate } from "../src/production-workflow.js";
import { normalizeAuthorizationResults } from "../src/client-dce.js";

const key = "2".repeat(44);
const qrCode = `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${key}&tpAmb=2`;
const row = {
  trackingCode: "OY855182534BR",
  service: "SEDEX",
  matrix: { status: "VERIFIED", image: "data:image/png;base64,AAAA" },
  accessKey: key,
  protocol: "999999999999999",
  qrCode,
  authorizedAt: "2026-08-21T15:00:00-03:00",
  identification: { series: 3, number: 12, environment: "2", emissionDateTime: "2026-08-21T14:59:00-03:00" },
  issuer: { name: "EMITENTE", cnpj: "12345678000190", address: { street: "Rua A", number: "1", city: "Fortaleza", uf: "CE", zip: "60000000" } },
  recipient: { name: "DESTINATARIO", document: "12345678909", address: { street: "Rua B", number: "2", district: "Centro", city: "Fortaleza", uf: "CE", zip: "60000001" } },
  items: [{ description: "PANFLETOS", ncm: "49111090", quantity: 10, unitValue: 0.5, totalValue: 5 }],
  content: "PANFLETOS",
};

test("descriptor DACE preserva QR oficial e dados de identificacao", () => {
  const descriptor = declarationDescriptor(DOCUMENT_MODES.DCE, row);
  assert.equal(descriptor.authorized, true);
  assert.equal(descriptor.qrEligible, true);
  assert.equal(descriptor.qrCode, qrCode);
  assert.equal(descriptor.series, 3);
  assert.equal(descriptor.number, 12);
});

test("modelo 10x15 usa emitente fiscal como remetente na DC-e", () => {
  const model = buildUnifiedLabelModel(row, { documentMode: DOCUMENT_MODES.DCE, sender: { name: "NAO USAR" } });
  assert.equal(model.sender.name, "EMITENTE");
  assert.equal(model.items[0].quantity, 10);
  assert.equal(model.declaration.qrEligible, true);
});

test("gate bloqueia DC-e sem QR vinculado", () => {
  const rows = [{ ...row, qrCode: "" }];
  const crops = new Map([[row.trackingCode, "data:image/png;base64,AAAA"]]);
  const testModels = [{ trackingCode: row.trackingCode, service: { family: "SEDEX" }, declaration: { mode: DOCUMENT_MODES.DCE }, format: "10x15" }];
  const operations = [{ type: "LABEL_TEST_APPROVED", sourceId: "batch1", service: "SEDEX", metadata: { trackingCode: row.trackingCode, scanValidated: true } }];
  const gate = batchGenerationGate({ rows, crops, documentMode: DOCUMENT_MODES.DCE, sender: { name: "EMITENTE" }, testModels, operations, productionBatchId: "batch1" });
  assert.equal(gate.ready, false);
  assert.ok(gate.problems.includes("DCE_QRCODE_NAO_VALIDADO_100_PERCENT"));
});

test("resultado da autorizacao preserva QR Code para o backend", () => {
  const result = normalizeAuthorizationResults([{ reference: "x", trackingCode: row.trackingCode, status: "AUTHORIZED", accessKey: key, protocolNumber: "p", qrCode }]);
  assert.equal(result[0].qrCode, qrCode);
});
