import test from "node:test";
import assert from "node:assert/strict";
import { dceLabelContextReadiness, dceLabelRowProblems, senderFromDceIssuer } from "../src/dce-label-data.js";

const key = "1".repeat(44);
const row = {
  trackingCode: "OY855182534BR",
  service: "SEDEX",
  status: "AUTHORIZED",
  matrixStatus: "AUTO_VERIFIED",
  accessKey: key,
  protocol: "123456789012345",
  qrCode: `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${key}&tpAmb=2`,
  authorizedAt: "2026-08-21T15:00:00-03:00",
  identification: { series: 0, number: 42, environment: "2", emissionDateTime: "2026-08-21T14:58:00-03:00" },
  issuer: { name: "COMITE TESTE", cnpj: "12345678000190", address: { street: "Rua A", number: "1", city: "Fortaleza", uf: "CE", zip: "60000000" } },
  recipient: { name: "DESTINATARIO", document: "12345678909", address: { street: "Rua B", number: "2", district: "Centro", city: "Fortaleza", uf: "CE", zip: "60000001" } },
  items: [{ description: "MATERIAL IMPRESSO", quantity: 2, unitValue: 3.5, totalValue: 7 }],
};

test("DC-e autorizada com QR vinculado fica pronta para etiqueta", () => {
  assert.deepEqual(dceLabelRowProblems(row), []);
  const result = dceLabelContextReadiness({
    package: { status: "AUTHORIZED", total: 1 },
    batch: { status: "READY_FOR_LABEL_TEST", total: 1 },
    rows: [row],
  });
  assert.equal(result.ready, true);
  assert.equal(result.counts.qrReady, 1);
});

test("QR divergente bloqueia a etiqueta", () => {
  const problems = dceLabelRowProblems({ ...row, qrCode: "https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=999" });
  assert.ok(problems.includes("QRCODE_DCE_DIVERGENTE"));
});

test("remetente da DACE vem do emitente fiscal", () => {
  const sender = senderFromDceIssuer(row.issuer);
  assert.equal(sender.name, "COMITE TESTE");
  assert.equal(sender.document, "12345678000190");
  assert.match(sender.addressLine, /Rua A/);
  assert.match(sender.cityLine, /Fortaleza/);
});
