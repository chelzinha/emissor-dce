import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import forge from "node-forge";
import { normalizeDceDocument } from "../netlify/functions/_shared/validation.mjs";
import { buildUnsignedDce } from "../netlify/functions/_shared/xml.mjs";
import { signDceXml } from "../netlify/functions/_shared/signature.mjs";

// XSD público da DC-e v1.00 (pacote usado por ACBr, Unimake e outros). Valida o
// XML assinado de produção como a SEFAZ faz na regra D02 (rejeição 215).
const SCHEMA = new URL("./schemas/dce/dce_v1.00.xsd", import.meta.url).pathname;
let hasXmllint = true;
try { execFileSync("xmllint", ["--version"], { stdio: "ignore" }); } catch { hasXmllint = false; }

function testCertificate() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z"); cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
  cert.setSubject([{ name: "commonName", value: "AABNB:07260680000121" }]); cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey), certificatePem: forge.pki.certificateToPem(cert), certificateBase64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()) };
}

test("DC-e de produção assinada passa no XSD oficial (sem EmpEmisProp)", { skip: !hasXmllint && "xmllint indisponível" }, () => {
  const certificate = testCertificate();
  const cases = [
    { documentType: "idOutros", document: "", complement: "" },
    { documentType: "CPF", document: "52998224725", complement: "APTO 1203 BLOCO B" },
  ];
  cases.forEach((recipientCase, index) => {
    const source = {
      service: "MDPB LOCAL", identification: { series: 1, number: index + 1, environment: "1" },
      issuer: { cnpj: 7260680000121, name: "ASSOCIACAO DOS FUNCIONARIOS APOSENTADOS DO BANCO DO NORDESTE DO BRASIL - AABNB", address: { street: "RUA PERBOYRE E SILVA", number: "111", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60030200" } },
      recipient: { documentType: recipientCase.documentType, document: recipientCase.document, name: "FABIOLA MAGALHÃES MESQUITA", address: { street: "RUA AGAPITO DOS SANTOS", number: "724", complement: recipientCase.complement, district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60010250" } },
      items: [{ description: "BRINDE DE NATAL", quantity: 1, unitValue: 35 }],
    };
    const normalized = normalizeDceDocument(source);
    assert.deepEqual(normalized.errors, []);
    const built = buildUnsignedDce(normalized.document, { numericCode: "123456" });
    const signed = signDceXml(built.xml, certificate);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dce-xsd-")), "dce.xml");
    fs.writeFileSync(file, signed);
    let output = "";
    try { output = execFileSync("xmllint", ["--noout", "--schema", SCHEMA, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { assert.fail(`XSD recusou o XML:\n${error.stderr || error.message}`); }
    assert.doesNotMatch(output, /fails/);
  });
});

test("consultas de status e de protocolo passam no XSD oficial", { skip: !hasXmllint && "xmllint indisponível" }, async () => {
  const { buildStatusXml, buildConsultationXml } = await import("../netlify/functions/_shared/services.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dce-cons-"));
  const check = (xml, schema) => {
    const file = path.join(dir, `${schema}.xml`);
    fs.writeFileSync(file, xml);
    try { execFileSync("xmllint", ["--noout", "--schema", new URL(`./schemas/dce/${schema}`, import.meta.url).pathname, file], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { assert.fail(`${schema}:\n${error.stderr}`); }
  };
  check(buildStatusXml("1", "23"), "consStatServDCe_v1.00.xsd");
  check(buildStatusXml("2"), "consStatServDCe_v1.00.xsd");
  check(buildConsultationXml("1", "23261107260680000121990010000000011000000016"), "consSitDCe_v1.00.xsd");
});
