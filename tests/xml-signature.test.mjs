import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
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
  // ZX02-10: o QR-Code vai em CDATA para preservar o e-comercial.
  assert.match(built.xml, /<qrCodDCe><!\[CDATA\[https:\/\/www\.fazenda\.pr\.gov\.br\/dce\/qrcode\?chDCe=/);

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

test('homologacao substitui o nome do destinatario pela literal da regra E04-20', () => {
  const base = {
    identification: { series: '900', number: '1', environment: '2', emissionDateTime: '2026-08-24T10:00:00-03:00' },
    issuer: { cnpj: '68403698000120', name: 'CLIENTE TESTE', address: { street: 'RUA A', number: '1', district: 'CENTRO', cityCode: '2304400', city: 'FORTALEZA', uf: 'CE', zip: '60110301' } },
    recipient: { documentType: 'CPF', document: '37522332818', name: 'ITALO ROGERIO', address: { street: 'RUA B', number: '2', district: 'CENTRO', cityCode: '2304400', city: 'FORTALEZA', uf: 'CE', zip: '60335560' } },
    items: [{ description: 'PANFLETOS', quantity: 1, unitValue: 15 }],
  };
  const homolog = normalizeDceDocument(base);
  assert.equal(homolog.valid, true);
  assert.equal(homolog.document.recipient.name, 'DCE EMITIDA EM AMBIENTE DE HOMOLOGACAO');
  assert.equal(homolog.document.recipient.realName, 'ITALO ROGERIO');

  const producao = normalizeDceDocument({ ...base, identification: { ...base.identification, environment: '1' } });
  assert.equal(producao.document.recipient.name, 'ITALO ROGERIO');
});

test('destinatario aceita CPF, CNPJ e idOutros como choice do grupo E', () => {
  const address = { street: 'RUA B', number: '2', district: 'CENTRO', cityCode: '2304400', city: 'FORTALEZA', uf: 'CE', zip: '60335560' };
  const build = (recipient) => normalizeDceDocument({
    identification: { series: '900', number: '1', environment: '1', emissionDateTime: '2026-08-24T10:00:00-03:00' },
    issuer: { cnpj: '68403698000120', name: 'CLIENTE TESTE', address: { street: 'RUA A', number: '1', district: 'CENTRO', cityCode: '2304400', city: 'FORTALEZA', uf: 'CE', zip: '60110301' } },
    recipient, items: [{ description: 'PANFLETOS', quantity: 1, unitValue: 15 }],
  });
  assert.equal(build({ documentType: 'CPF', document: '37522332818', name: 'ITALO', address }).valid, true);
  assert.equal(build({ documentType: 'CNPJ', document: '68403698000120', name: 'EMPRESA', address }).valid, true);

  const outros = build({ documentType: 'idOutros', document: 'RG2002123456', name: 'ITALO', address });
  assert.equal(outros.valid, true);
  assert.equal(outros.document.recipient.documentType, 'idOutros');

  // E03a-60 nao admite espaco nem menos de 2 caracteres
  assert.equal(build({ documentType: 'idOutros', document: 'RG 2002123456', name: 'ITALO', address }).valid, false);
  assert.equal(build({ documentType: 'idOutros', document: 'A', name: 'ITALO', address }).valid, false);
});

test('qrCodDCe usa CDATA e preserva o e-comercial (regra ZX02-10)', () => {
  // Passar a URL por escapeXml gera &amp; dentro de qrCodDCe, o que a regra
  // ZX02-10 do Anexo I rejeita com o codigo 813. A nota da propria regra diz
  // "Deve-se usar o CDATA".
  const address = { street: 'RUA B', number: '2', district: 'CENTRO', cityCode: '2304400', city: 'FORTALEZA', uf: 'CE', zip: '60335560' };
  const validation = normalizeDceDocument({
    identification: { series: '900', number: '1', environment: '1', emissionDateTime: '2026-08-24T10:00:00-03:00' },
    issuer: { cnpj: '68403698000120', name: 'CLIENTE TESTE', address },
    recipient: { documentType: 'CPF', document: '37522332818', name: 'ITALO', address },
    items: [{ description: 'PANFLETOS', quantity: 1, unitValue: 15 }],
  });
  assert.equal(validation.valid, true);
  const built = buildUnsignedDce(validation.document, { numericCode: '435042' });
  const trecho = built.xml.match(/<qrCodDCe>[\s\S]*?<\/qrCodDCe>/)[0];
  assert.match(trecho, /<!\[CDATA\[/);
  assert.doesNotMatch(trecho, /&amp;/);
  assert.match(trecho, /&tpAmb=1/);
});

test('dhEmi e gerado por documento, nao congelado no lote (regra B07-20)', async () => {
  // Congelar dhEmi na reserva faz os primeiros documentos de um lote grande
  // chegarem atrasados na SEFAZ, gerando rejeicao 704.
  const address = { street: 'RUA B', number: '2', district: 'CENTRO', cityCode: '2304400', city: 'FORTALEZA', uf: 'CE', zip: '60335560' };
  const semData = () => normalizeDceDocument({
    identification: { series: '900', number: '1', environment: '1', emissionDateTime: null },
    issuer: { cnpj: '68403698000120', name: 'CLIENTE TESTE', address },
    recipient: { documentType: 'CPF', document: '37522332818', name: 'ITALO', address },
    items: [{ description: 'PANFLETOS', quantity: 1, unitValue: 15 }],
  });
  const primeiro = semData();
  assert.equal(primeiro.valid, true);
  assert.match(primeiro.document.identification.emissionDateTime,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const segundo = semData();
  assert.notEqual(primeiro.document.identification.emissionDateTime,
                  segundo.document.identification.emissionDateTime);
});

test('Apps Script nao congela dhEmi na reserva do lote', () => {
  const batches = fs.readFileSync(new URL('../apps-script/Batches.gs', import.meta.url), 'utf8');
  assert.match(batches, /emissionDateTime: null/);
  assert.match(batches, /reservedAt: now/);
  assert.doesNotMatch(batches, /emissionDateTime: now/);
});
