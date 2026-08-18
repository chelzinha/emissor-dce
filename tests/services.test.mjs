import assert from "node:assert/strict";
import test from "node:test";
import { buildCancellationXml, buildConsultationXml, buildStatusXml } from "../netlify/functions/_shared/services.mjs";
import { createAccessKey } from "../netlify/functions/_shared/access-key.mjs";

const accessKey = createAccessKey({
  identification: { cUF: "23", emissionDateTime: "2026-08-18T10:00:00-03:00", model: "99", series: "0", number: "1", issueMode: "1", issuerType: "2", authorizationSite: "0" },
  issuer: { cnpj: "11222333000181" },
}, "123456").key;

test("gera consultas do ambiente nacional", () => {
  assert.match(buildStatusXml("2"), /<xServ>STATUS<\/xServ>/);
  assert.match(buildConsultationXml("2", accessKey), new RegExp(`<chDCe>${accessKey}</chDCe>`));
});

test("gera evento de cancelamento de emissão própria", () => {
  const xml = buildCancellationXml({
    environment: "2", accessKey, issuerCnpj: "11222333000181",
    protocolNumber: "1234567890123456", reason: "Remessa não será mais enviada", organizationCode: "91",
  });
  assert.match(xml, new RegExp(`Id="ID110111${accessKey}001"`));
  assert.match(xml, /<tpEmit>2<\/tpEmit>/);
  assert.match(xml, /<CNPJAutor>11222333000181<\/CNPJAutor><CNPJUsEmit>11222333000181<\/CNPJUsEmit>/);
  assert.match(xml, /<descEvento>Cancelamento<\/descEvento>/);
});
