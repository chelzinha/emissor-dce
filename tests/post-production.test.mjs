import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHandoffRecord,
  buildVolumeLabelModels,
  derivePostProductionStatus,
  handoffReadiness,
  planPhysicalVolumes,
  serviceTotals,
  summarizeLabelTestApprovals,
  summarizePrintConfirmations,
  validateObjectsForVolumes,
  validateVolumePlan,
} from "../src/post-production.js";

function sro(n) { return `AA${String(n).padStart(9, "0")}BR`; }
function objects(count, service, start = 1) { return Array.from({ length: count }, (_, i) => ({ trackingCode: sro(start + i), service })); }

test("real lot 1000 SEDEX + 183 PAC becomes 5 volumes", () => {
  const rows = [...objects(1000, "SEDEX"), ...objects(183, "PAC", 2001)];
  const volumes = planPhysicalVolumes(rows);
  assert.equal(volumes.length, 5);
  assert.deepEqual(volumes.map((v) => [v.service, v.quantity]), [["SEDEX",250],["SEDEX",250],["SEDEX",250],["SEDEX",250],["PAC",183]]);
});

test("volume capacity never exceeds 250", () => {
  const volumes = planPhysicalVolumes(objects(751, "SEDEX"));
  assert.deepEqual(volumes.map((v) => v.quantity), [250,250,250,1]);
});

test("PAC and SEDEX never mix in a volume", () => {
  const rows = [...objects(3, "PAC"), ...objects(3, "SEDEX", 20)];
  const volumes = planPhysicalVolumes(rows, { capacity: 2 });
  assert.ok(volumes.every((v) => new Set(v.trackingCodes.map((s) => rows.find((r) => r.trackingCode === s)?.service)).size === 1));
});

test("duplicate SRO blocks volume planning", () => {
  assert.throws(() => planPhysicalVolumes([{ trackingCode: sro(1), service: "PAC" }, { trackingCode: sro(1), service: "PAC" }]), /SRO_DUPLICADO/);
});

test("invalid service is rejected", () => {
  assert.ok(validateObjectsForVolumes([{ trackingCode: sro(1), service: "MINI" }]).some((e) => e.includes("SERVICO_INVALIDO")));
});

test("volume validation detects missing SRO", () => {
  const rows = objects(3, "PAC");
  const volumes = planPhysicalVolumes(rows);
  volumes[0].trackingCodes.pop(); volumes[0].quantity -= 1;
  const check = validateVolumePlan(volumes, rows);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes("VOLUME_SRO_AUSENTE")));
});

test("volume validation detects service mismatch", () => {
  const rows = objects(2, "PAC");
  const volumes = planPhysicalVolumes(rows);
  volumes[0].service = "SEDEX";
  const check = validateVolumePlan(volumes, rows);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes("VOLUME_SERVICO_DIVERGENTE")));
});

test("label test approval required once per present service", () => {
  const rows = [...objects(2, "PAC"), ...objects(2, "SEDEX", 20)];
  const first = summarizeLabelTestApprovals(rows, [{ service: "PAC" }]);
  assert.equal(first.ready, false);
  assert.deepEqual(first.missingServices, ["SEDEX"]);
  const second = summarizeLabelTestApprovals(rows, [{ service: "PAC" }, { service: "SEDEX" }]);
  assert.equal(second.ready, true);
});

test("PDF generation does not count as printing", () => {
  const rows = objects(10, "PAC");
  const print = summarizePrintConfirmations(rows, []);
  assert.equal(print.ready, false);
  assert.equal(print.byService.PAC.confirmed, 0);
});

test("partial physical print does not release handoff", () => {
  const rows = objects(10, "PAC");
  const volumes = planPhysicalVolumes(rows);
  const check = handoffReadiness({ objects: rows, volumes, approvals: [{ service: "PAC" }], printConfirmations: [{ service: "PAC", quantity: 9 }], receiver: "Equipe" });
  assert.equal(check.ready, false);
  assert.ok(check.reasons.some((e) => e.includes("IMPRESSAO_PENDENTE")));
});

test("receiver is mandatory for handoff", () => {
  const rows = objects(10, "PAC");
  const volumes = planPhysicalVolumes(rows);
  const check = handoffReadiness({ objects: rows, volumes, approvals: [{ service: "PAC" }], printConfirmations: [{ service: "PAC", quantity: 10 }] });
  assert.equal(check.ready, false);
  assert.ok(check.reasons.includes("RECEBEDOR_OBRIGATORIO"));
});

test("complete print and approved test release handoff", () => {
  const rows = [...objects(10, "SEDEX"), ...objects(5, "PAC", 100)];
  const volumes = planPhysicalVolumes(rows);
  const check = handoffReadiness({ objects: rows, volumes, approvals: [{ service: "SEDEX" }, { service: "PAC" }], printConfirmations: [{ service: "SEDEX", quantity: 10 }, { service: "PAC", quantity: 5 }], receiver: "Maria Silva" });
  assert.equal(check.ready, true);
});

test("handoff record uses one idempotency key per production batch", () => {
  const rows = objects(2, "PAC");
  const volumes = planPhysicalVolumes(rows);
  const record = buildHandoffRecord({ campaignId: "op1", productionBatchId: "prod1", objects: rows, volumes, approvals: [{ service: "PAC" }], printConfirmations: [{ service: "PAC", quantity: 2 }], receiver: "  Equipe   Recebedora " });
  assert.equal(record.idempotencyKey, "label-handoff:prod1");
  assert.equal(record.receiver, "Equipe Recebedora");
  assert.equal(record.quantity, 2);
});

test("state progression separates test, print and handoff", () => {
  const rows = objects(2, "PAC");
  assert.equal(derivePostProductionStatus({ objects: rows }), "READY_FOR_LABEL_TEST");
  assert.equal(derivePostProductionStatus({ objects: rows, approvals: [{ service: "PAC" }] }), "READY_FOR_PRINT");
  assert.equal(derivePostProductionStatus({ objects: rows, approvals: [{ service: "PAC" }], printConfirmations: [{ service: "PAC", quantity: 1 }] }), "PRINTING");
  assert.equal(derivePostProductionStatus({ objects: rows, approvals: [{ service: "PAC" }], printConfirmations: [{ service: "PAC", quantity: 2 }] }), "PRINTED");
  assert.equal(derivePostProductionStatus({ objects: rows, approvals: [{ service: "PAC" }], printConfirmations: [{ service: "PAC", quantity: 2 }], handedOff: true }), "HANDED_OFF");
});

test("service totals are separated", () => {
  const rows = [...objects(3, "PAC"), ...objects(7, "SEDEX", 30)];
  assert.deepEqual(serviceTotals(rows), { PAC: 3, SEDEX: 7, total: 10 });
});

test("volume label model shows actual volume contents", () => {
  const rows = objects(260, "SEDEX");
  const volumes = planPhysicalVolumes(rows);
  const labels = buildVolumeLabelModels(volumes, { operationName: "Operacao X", productionBatchId: "prod" });
  assert.equal(labels[0].quantity, 250);
  assert.equal(labels[1].quantity, 10);
  assert.equal(labels[0].trackingCodes.length, 250);
});
