import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { ICP_BRASIL_ROOT_V10, SEFAZ_TRUSTED_CAS } from "../netlify/functions/_shared/icp-brasil-roots.mjs";

test("raiz ICP-Brasil v10 confere com a impressão digital publicada", () => {
  const cert = new crypto.X509Certificate(ICP_BRASIL_ROOT_V10);
  assert.equal(cert.fingerprint256, "6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6");
  assert.match(cert.subject, /Raiz Brasileira v10/);
  assert.ok(new Date(cert.validTo) > new Date());
});

test("chamadas SOAP confiam nas raízes públicas e na ICP-Brasil, com verificação ligada", () => {
  assert.ok(SEFAZ_TRUSTED_CAS.length > 100);
  assert.ok(SEFAZ_TRUSTED_CAS.includes(ICP_BRASIL_ROOT_V10));
  const soap = fs.readFileSync(new URL("../netlify/functions/_shared/soap.mjs", import.meta.url), "utf8");
  assert.match(soap, /rejectUnauthorized: true,\s*ca: SEFAZ_TRUSTED_CAS/);
});
