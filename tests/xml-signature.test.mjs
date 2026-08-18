import assert from "node:assert/strict";
import test from "node:test";
import forge from "node-forge";
import { normalizeDceDocument } from "../netlify/functions/_shared/validation.mjs";
import { buildUnsignedDce } from "../netlify/functions/_shared/xml.mjs";
import { signDceXml } from "../netlify/functions/_shared/signature.mjs";
import { sampleInput } from "./fixtures.mjs";

test("normaliza emissão própria para Correios", () => {
  const result = normalizeDceDocument(sampleInput);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.document.identification.issuerType, "2");
  assert.equal(result.document.transport.mode, "0");
});

test("gera XML e assinatura envelopada", () => {
  const normalized = normalizeDceDocument(sampleInput).document;
  const built = buildUnsignedDce(normalized, { numericCode: "123456" });
  assert.match(built.xml, /<EmpEmisProp>/);
  assert.match(built.xml, /<modTrans>0<\/modTrans>/);
  assert.match(built.xml, /<qrCodDCe>https:\/\/www\.fazenda\.pr\.gov\.br\/dce\/qrcode\?chDCe=/);

  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z"); cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
  cert.setSubject([{ name: "commonName", value: "TESTE:11222333000181" }]); cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certificate = {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey), certificatePem: forge.pki.certificateToPem(cert),
    certificateBase64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
  };
  const signed = signDceXml(built.xml, certificate);
  assert.match(signed, /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  assert.match(signed, new RegExp(`<Reference URI="#DCe${built.accessKey}">`));
});
