import test from "node:test";
import assert from "node:assert/strict";
import { parseAuthorizationResponse } from "../netlify/functions/_shared/soap.mjs";

test("chave de 44 dígitos e protocolo voltam como texto, sem virar número", () => {
  const key = "23261107260680000121990010000000101200510230";
  const soap = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><dceResultMsg xmlns="http://www.portalfiscal.inf.br/dce/wsdl/DCeRecepcao"><retDCe xmlns="http://www.portalfiscal.inf.br/dce" versao="1.00"><tpAmb>1</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protDCe versao="1.00"><infProt><tpAmb>1</tpAmb><chDCe>${key}</chDCe><dhRecbto>2026-11-09T08:53:57-03:00</dhRecbto><nProt>9232600003246378</nProt><cStat>100</cStat><xMotivo>Autorizado o uso do DCe</xMotivo></infProt></protDCe></retDCe></dceResultMsg></soap:Body></soap:Envelope>`;
  const response = parseAuthorizationResponse(soap);
  assert.equal(response.accessKey, key);
  assert.equal(String(response.protocolNumber || response.protocol || ""), "9232600003246378");
});
