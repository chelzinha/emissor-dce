import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_MODES,
  LABEL_FORMATS,
  buildUnifiedLabelModel,
  declarationDescriptor,
  formatTrackingCode,
  productionReadiness,
  productionSummary,
  servicePresentation,
} from "../src/label-production.js";

const accessKey = "1".repeat(44);
const qrCode = `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${accessKey}&tpAmb=2`;

test("preserva as medidas do formato 10x15 do gerador local", () => {
  const format = LABEL_FORMATS["10x15"];
  assert.equal(format.widthMm, 100);
  assert.equal(format.heightMm, 150);
  assert.equal(format.trackingBarcode.widthMm, 80);
  assert.equal(format.trackingBarcode.heightMm, 11.5);
  assert.equal(format.dataMatrix.widthMm, 25);
  assert.equal(format.dataMatrix.heightMm, 25);
});

test("aplica apresentacao PAC e SEDEX e deixa tarja lida no PDF vencer o fallback", () => {
  assert.deepEqual(servicePresentation("PAC"), { family: "PAC", routingClass: "STANDARD", stripe: "IMP" });
  assert.deepEqual(servicePresentation("SEDEX"), { family: "SEDEX", routingClass: "EXPRESSA", stripe: "SIM" });
  assert.equal(servicePresentation("PAC", "PTG").stripe, "PTG");
});

test("formata codigo de rastreio para leitura humana", () => {
  assert.equal(formatTrackingCode("OY855182534BR"), "OY 855 182 534 BR");
});

test("declaracao simplificada nao exige chave ou protocolo de DC-e", () => {
  const descriptor = declarationDescriptor(DOCUMENT_MODES.SIMPLIFIED, {});
  assert.equal(descriptor.authorized, false);
  assert.equal(descriptor.qrEligible, false);
  assert.equal(descriptor.accessKey, "");
});

test("modo DC-e separa autorizacao fiscal da elegibilidade do QR Code", () => {
  const pending = declarationDescriptor(DOCUMENT_MODES.DCE, { accessKey });
  assert.equal(pending.authorized, false);
  const authorizedWithoutQr = declarationDescriptor(DOCUMENT_MODES.DCE, { accessKey, protocol: "123456789" });
  assert.equal(authorizedWithoutQr.authorized, true);
  assert.equal(authorizedWithoutQr.qrEligible, false);
  const ready = declarationDescriptor(DOCUMENT_MODES.DCE, { accessKey, protocol: "123456789", qrCode });
  assert.equal(ready.authorized, true);
  assert.equal(ready.qrEligible, true);
});

test("producao simplificada exige Data Matrix valido e etiqueta teste aprovada", () => {
  const row = { trackingCode: "OY855182534BR", service: "SEDEX", matrix: { status: "AUTO_VERIFIED" } };
  const blocked = productionReadiness({ row, documentMode: DOCUMENT_MODES.SIMPLIFIED, testLabelApproved: false });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.problems.includes("ETIQUETA_TESTE_NAO_APROVADA"));
  const ready = productionReadiness({ row, documentMode: DOCUMENT_MODES.SIMPLIFIED, testLabelApproved: true });
  assert.equal(ready.ready, true);
});

test("producao DC-e bloqueia objeto ainda sem autorizacao", () => {
  const row = {
    trackingCode: "OY855182534BR", service: "SEDEX", matrix: { status: "AUTO_VERIFIED" },
    accessKey, protocol: "",
  };
  const result = productionReadiness({ row, documentMode: DOCUMENT_MODES.DCE, testLabelApproved: true });
  assert.equal(result.ready, false);
  assert.ok(result.problems.includes("DCE_NAO_AUTORIZADA"));
});

test("modelo unificado preserva Data Matrix, destinatario e modalidade documental", () => {
  const model = buildUnifiedLabelModel({
    trackingCode: "OY855182534BR",
    service: "SEDEX",
    matrix: { status: "AUTO_VERIFIED", dataUrl: "data:image/png;base64,abc", stripe: "SIM" },
    recipient: {
      name: "ELEITOR TESTE",
      document: "",
      address: { street: "Rua A", number: "10", district: "Centro", city: "Fortaleza", uf: "CE", zip: "60110301" },
    },
    content: "PANFLETOS",
  }, {
    documentMode: DOCUMENT_MODES.SIMPLIFIED,
    sender: { name: "CANDIDATO", document: "12345678000199", addressLine: "Rua B, 20", cityLine: "Fortaleza/CE" },
  });
  assert.equal(model.trackingCodeFormatted, "OY 855 182 534 BR");
  assert.equal(model.dataMatrixStatus, "AUTO_VERIFIED");
  assert.equal(model.recipient.zip, "60110-301");
  assert.equal(model.declaration.mode, DOCUMENT_MODES.SIMPLIFIED);
});

test("resumo distingue documentos simplificados de DC-es prontas para DACE", () => {
  const rows = [
    { service: "PAC", matrix: { status: "AUTO_VERIFIED" } },
    { service: "SEDEX", matrix: { status: "AUTO_VERIFIED" }, accessKey, protocol: "123", qrCode },
  ];
  const simple = productionSummary(rows, DOCUMENT_MODES.SIMPLIFIED);
  assert.equal(simple.documentsReady, 2);
  const dce = productionSummary(rows, DOCUMENT_MODES.DCE);
  assert.equal(dce.documentsReady, 1);
});
