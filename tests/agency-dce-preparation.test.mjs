import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkPreparedDocuments,
  fiscalEnrichmentTemplate,
  isValidCnpj,
  isValidCpf,
  parseFiscalEnrichmentCsv,
  preflightDcePreparation,
} from "../src/agency-dce-preparation.js";

const issuer = {
  cnpj: "11222333000181", name: "OPERACAO POSTAL LTDA", series: 1, nextNumber: 10, status: "ACTIVE",
  nonIcmsContributor: true, operationWithoutInvoice: true, confirmedAt: "2026-08-21T12:00:00-03:00",
  address: { street:"Rua A",number:"10",district:"Centro",city:"Fortaleza",uf:"CE",zip:"60000000",cityCode:"2304400",countryCode:"1058",country:"BRASIL" }
};
const object = {
  id:"obj-1", trackingCode:"AB123456789BR", service:"PAC", status:"READY", matrixStatus:"AUTO_VERIFIED",
  content:"MATERIAL IMPRESSO", reference:"REF-1",
  recipient:{ name:"DESTINATARIO TESTE", document:"52998224725", address:{street:"Rua B",number:"20",district:"Aldeota",city:"Fortaleza",uf:"CE",zip:"60100000",cityCode:"2304400"} }
};

test("validadores CPF e CNPJ rejeitam sequencias e aceitam exemplos validos", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("11111111111"), false);
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("11111111111111"), false);
});

test("preflight so libera com emitente confirmado e dados fiscais completos", () => {
  const result = preflightDcePreparation({ objects:[object], issuerProfile:issuer, defaults:{quantity:1,unitValue:0.25} });
  assert.equal(result.ready, true);
  assert.equal(result.readyCount, 1);
  assert.equal(result.documents[0].recipient.documentType, "CPF");
  assert.equal(result.documents[0].items[0].unitValue, 0.25);
});

test("preflight nao inventa quantidade nem valor", () => {
  const result = preflightDcePreparation({ objects:[object], issuerProfile:issuer });
  assert.equal(result.ready, false);
  assert.ok(result.rows[0].errors.some((e)=>e.code === "ITEM_QUANTITY_REQUIRED"));
  assert.ok(result.rows[0].errors.some((e)=>e.code === "ITEM_UNIT_VALUE_REQUIRED"));
});

test("preflight exige Data Matrix realmente verificado", () => {
  const result = preflightDcePreparation({ objects:[{...object,matrixStatus:"TEXT_ONLY"}], issuerProfile:issuer, defaults:{quantity:1,unitValue:1} });
  assert.equal(result.ready, false);
  assert.ok(result.rows[0].errors.some((e)=>e.code === "MATRIX_NOT_VERIFIED"));
});

test("perfil fiscal sem confirmacoes do cliente bloqueia todo o lote", () => {
  const result = preflightDcePreparation({ objects:[object], issuerProfile:{...issuer,nonIcmsContributor:false}, defaults:{quantity:1,unitValue:1} });
  assert.equal(result.ready, false);
  assert.ok(result.issuerErrors.some((e)=>e.code === "ISSUER_NON_ICMS_NOT_CONFIRMED"));
});

test("CSV complementar usa SRO como chave e aceita decimal brasileiro", () => {
  const csv = `${fiscalEnrichmentTemplate()}AB123456789BR;52998224725;2304400;2;1.234,56;49019900;PANFLETOS\r\n`;
  const parsed = parseFiscalEnrichmentCsv(csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].unitValue, 1234.56);
  assert.equal(parsed.rows[0].quantity, 2);
});

test("CSV complementar aceita decimal com ponto sem multiplicar por 100", () => {
  const parsed = parseFiscalEnrichmentCsv("SRO;VALOR_UNITARIO\nAB123456789BR;25.50\n");
  assert.equal(parsed.rows[0].unitValue, 25.5);
});

test("enriquecimento completa documento e codigo IBGE ausentes sem alterar endereco postal", () => {
  const source = structuredClone(object); source.recipient.document=""; source.recipient.address.cityCode="";
  const result = preflightDcePreparation({
    objects:[source], issuerProfile:issuer, defaults:{quantity:1,unitValue:1},
    enrichments:[{trackingCode:"AB123456789BR",recipientDocument:"52998224725",cityCode:"2304400"}]
  });
  assert.equal(result.ready, true);
  assert.equal(result.documents[0].recipient.address.street, "Rua B");
  assert.equal(result.documents[0].recipient.address.cityCode, "2304400");
});

test("SRO duplicado bloqueia lote", () => {
  const result = preflightDcePreparation({ objects:[object,{...object,id:"obj-2"}], issuerProfile:issuer, defaults:{quantity:1,unitValue:1} });
  assert.equal(result.ready, false);
  assert.ok(result.rows[1].errors.some((e)=>e.code === "SRO_DUPLICATE"));
});

test("chunk de preparo respeita limite 100", () => {
  const docs = Array.from({length:205},(_,i)=>({trackingCode:`X${i}`}));
  assert.deepEqual(chunkPreparedDocuments(docs,100).map((x)=>x.length),[100,100,5]);
});
