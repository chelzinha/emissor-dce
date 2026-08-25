import test from "node:test";
import assert from "node:assert/strict";
import { mapRows } from "../src/importers.js";
import { parsePortalReturnCsv } from "../src/portal-return.js";
import { validateRemittance } from "../src/validation.js";

const mapping = {
  trackingCode: "OBJETO", service: "SERVICO", recipientName: "DESTINATARIO",
  recipientDocumentType: "TIPO_DOCUMENTO", recipientDocument: "DOCUMENTO",
  street: "ENDERECO", number: "NUMERO", district: "BAIRRO", city: "CIDADE",
  uf: "UF", zip: "CEP", cityCode: "IBGE", description: "CONTEUDO",
  quantity: "QTD", unitValue: "VALOR",
};

test("importacao preserva idOutros sem remover letras", () => {
  const [row] = mapRows([{
    OBJETO: "AA123456789BR", SERVICO: "PAC", DESTINATARIO: "DESTINATARIO TESTE",
    TIPO_DOCUMENTO: "idOutros", DOCUMENTO: "RG2002123456", ENDERECO: "RUA A",
    NUMERO: "10", BAIRRO: "CENTRO", CIDADE: "FORTALEZA", UF: "CE",
    CEP: "60000000", IBGE: "2304400", CONTEUDO: "IMPRESSO", QTD: "1", VALOR: "1,00",
  }], mapping);
  assert.equal(row.document.recipient.documentType, "idOutros");
  assert.equal(row.document.recipient.document, "RG2002123456");
  assert.deepEqual(validateRemittance(row), []);
});

test("retorno do Portal preserva tipo e valor de documento alternativo", () => {
  const parsed = parsePortalReturnCsv("OBJETO;SERVICO;DESTINATARIO;TIPO_DOCUMENTO;DOCUMENTO\nAA123456789BR;SEDEX;TESTE;OUTRO;PASSAPORTE123");
  assert.equal(parsed.rows[0].recipient.documentType, "idOutros");
  assert.equal(parsed.rows[0].recipient.document, "PASSAPORTE123");
});

test("idOutros invalido continua bloqueado na revisao", () => {
  const [row] = mapRows([{
    OBJETO: "AA123456789BR", SERVICO: "PAC", DESTINATARIO: "TESTE",
    TIPO_DOCUMENTO: "OUTRO", DOCUMENTO: "A", ENDERECO: "RUA A", NUMERO: "10",
    BAIRRO: "CENTRO", CIDADE: "FORTALEZA", UF: "CE", CEP: "60000000",
    IBGE: "2304400", CONTEUDO: "IMPRESSO", QTD: "1", VALOR: "1",
  }], mapping);
  assert.ok(validateRemittance(row).includes("documento"));
});
