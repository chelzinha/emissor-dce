import assert from "node:assert/strict";
import test from "node:test";
import { createDacePdf } from "../netlify/functions/_shared/dace.mjs";
import { normalizeDceDocument } from "../netlify/functions/_shared/validation.mjs";
import { buildUnsignedDce } from "../netlify/functions/_shared/xml.mjs";
import { sampleInput } from "./fixtures.mjs";

test("gera DACE em PDF para documento autorizado", async () => {
  const document = normalizeDceDocument(sampleInput).document;
  const built = buildUnsignedDce(document, { numericCode: "123456" });
  const bytes = await createDacePdf([{ document, result: { status: "AUTHORIZED", accessKey: built.accessKey, protocolNumber: "1234567890123456", total: built.total, qrCode: built.qrCode } }]);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
  assert.ok(bytes.length > 5_000);
});
