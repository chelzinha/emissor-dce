import test from "node:test";
import assert from "node:assert/strict";
import { buildContingencyManifest, parseContingencyManifest, serializeContingencyManifest, validateContingencyManifest } from "../src/local-contingency.js";
import { planVolumes } from "../src/portal-return.js";

function makeRows(service, count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    trackingCode: `${prefix}${String(index + 1).padStart(9, "0")}BR`,
    service,
    matrix: { status: "AUTO_VERIFIED", origin: "codigo", stripe: service === "PAC" ? "IMP" : "SIM" },
  }));
}

test("gera e relê manifesto de contingencia valido", () => {
  const rows = [...makeRows("SEDEX", 10, "SX"), ...makeRows("PAC", 3, "PX")];
  const manifest = buildContingencyManifest({
    batchId: "ETQ-20260820-001",
    campaignReference: "CAMP-001",
    documentMode: "SIMPLIFIED_DECLARATION",
    rows,
    volumes: planVolumes(rows),
    sourceFiles: [{ name: "portal.csv", size: 100, sha256: "a".repeat(64) }],
  });
  const text = serializeContingencyManifest(manifest);
  const parsed = parseContingencyManifest(text);
  assert.equal(parsed.summary.total, 13);
  assert.equal(parsed.summary.sedex, 10);
  assert.equal(parsed.summary.pac, 3);
});

test("rejeita volume acima de 250", () => {
  const rows = makeRows("SEDEX", 251, "SX");
  const manifest = buildContingencyManifest({
    batchId: "ETQ-1", documentMode: "SIMPLIFIED_DECLARATION", rows,
    volumes: [{ number: 1, totalVolumes: 1, service: "SEDEX", quantity: 251, trackingCodes: rows.map((row) => row.trackingCode) }],
  });
  const result = validateContingencyManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("VOLUME_ACIMA_250:1"));
});

test("rejeita mistura de PAC e SEDEX no mesmo volume", () => {
  const rows = [...makeRows("SEDEX", 1, "SX"), ...makeRows("PAC", 1, "PX")];
  const manifest = buildContingencyManifest({
    batchId: "ETQ-2", documentMode: "SIMPLIFIED_DECLARATION", rows,
    volumes: [{ number: 1, totalVolumes: 1, service: "SEDEX", quantity: 2, trackingCodes: rows.map((row) => row.trackingCode) }],
  });
  const result = validateContingencyManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("VOLUME_MISTURA_SERVICO:")));
});
