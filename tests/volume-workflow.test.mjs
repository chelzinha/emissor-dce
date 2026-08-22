import test from "node:test";
import assert from "node:assert/strict";
import {
  VOLUME_CAPACITY,
  buildHandoffRequest,
  buildPrintEvents,
  buildVolumeLabelModels,
  printStateFromOperations,
  validateVolumePlan,
  volumeSummary,
} from "../src/volume-workflow.js";

const sro = (prefix, n) => `${prefix}${String(n).padStart(9, "0")}BR`;

function sampleVolumes() {
  const sedex1 = Array.from({ length: 250 }, (_, i) => sro("AA", i + 1));
  const sedex2 = Array.from({ length: 250 }, (_, i) => sro("AB", i + 1));
  const pac = Array.from({ length: 183 }, (_, i) => sro("AC", i + 1));
  return [
    { id: "v1", service: "SEDEX", number: 1, totalVolumes: 3, quantity: 250, trackingCodes: sedex1, status: "PLANNED" },
    { id: "v2", service: "SEDEX", number: 2, totalVolumes: 3, quantity: 250, trackingCodes: sedex2, status: "PLANNED" },
    { id: "v3", service: "PAC", number: 3, totalVolumes: 3, quantity: 183, trackingCodes: pac, status: "PLANNED" },
  ];
}

test("capacidade fisica permanece em 250 etiquetas", () => {
  assert.equal(VOLUME_CAPACITY, 250);
  const volumes = sampleVolumes();
  assert.equal(validateVolumePlan(volumes).ready, true);
});

test("bloqueia volume acima de 250", () => {
  const codes = Array.from({ length: 251 }, (_, i) => sro("AD", i + 1));
  const result = validateVolumePlan([{ id: "x", service: "PAC", number: 1, totalVolumes: 1, quantity: 251, trackingCodes: codes }]);
  assert.equal(result.ready, false);
  assert.ok(result.problems.some((item) => item.includes("QUANTIDADE_INVALIDA")));
});

test("bloqueia SRO duplicado entre volumes", () => {
  const duplicate = sro("AE", 1);
  const result = validateVolumePlan([
    { id: "a", service: "SEDEX", number: 1, totalVolumes: 2, quantity: 1, trackingCodes: [duplicate] },
    { id: "b", service: "PAC", number: 2, totalVolumes: 2, quantity: 1, trackingCodes: [duplicate] },
  ]);
  assert.equal(result.ready, false);
  assert.ok(result.problems.includes(`SRO_DUPLICADO:${duplicate}`));
});

test("resumo separa volumes e etiquetas por PAC e SEDEX", () => {
  const summary = volumeSummary(sampleVolumes());
  assert.equal(summary.totalVolumes, 3);
  assert.equal(summary.totalLabels, 683);
  assert.deepEqual(summary.SEDEX, { volumes: 2, labels: 500 });
  assert.deepEqual(summary.PAC, { volumes: 1, labels: 183 });
});

test("modelos de etiqueta de volume carregam conteudo real do volume", () => {
  const models = buildVolumeLabelModels({ productionBatchId: "batch-abcdef123", volumes: sampleVolumes(), operationName: "Operacao Interior" });
  assert.equal(models[0].quantity, 250);
  assert.equal(models[2].quantity, 183);
  assert.equal(models[0].trackingCodes.length, 250);
  assert.match(models[0].reference, /^VOL-/);
});

test("impressao gera eventos separados por servico", () => {
  const events = buildPrintEvents({ campaignId: "c1", productionBatchId: "b1", volumes: sampleVolumes() });
  assert.equal(events.length, 2);
  assert.equal(events.find((event) => event.service === "SEDEX").quantity, 500);
  assert.equal(events.find((event) => event.service === "PAC").quantity, 183);
});

test("estado de impressao so fica pronto com os dois servicos registrados", () => {
  const volumes = sampleVolumes();
  const partial = printStateFromOperations([{ type: "LABEL_PRINTED", sourceId: "b1", service: "SEDEX", quantity: 500 }], "b1", volumes);
  assert.equal(partial.ready, false);
  const complete = printStateFromOperations([
    { type: "LABEL_PRINTED", sourceId: "b1", service: "SEDEX", quantity: 500 },
    { type: "LABEL_PRINTED", sourceId: "b1", service: "PAC", quantity: 183 },
  ], "b1", volumes);
  assert.equal(complete.ready, true);
});

test("handoff exige nome de quem recebeu", () => {
  assert.throws(() => buildHandoffRequest({ campaignId: "c1", productionBatchId: "b1", volumes: sampleVolumes(), receivedBy: "" }), /Informe quem recebeu/);
  const request = buildHandoffRequest({ campaignId: "c1", productionBatchId: "b1", volumes: sampleVolumes(), receivedBy: "JULIO" });
  assert.equal(request.volumeIds.length, 3);
});
