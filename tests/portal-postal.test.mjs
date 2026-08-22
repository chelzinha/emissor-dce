import test from "node:test";
import assert from "node:assert/strict";
import { buildPortalCsv, normalizePortalRow, PORTAL_POSTAL_HEADERS, portalValues, validatePortalRow } from "../src/portal-postal.js";

test("layout do Portal Postal preserva as 28 colunas na ordem oficial", () => {
  assert.equal(PORTAL_POSTAL_HEADERS.length, 28);
  assert.deepEqual(PORTAL_POSTAL_HEADERS.slice(0, 5), ["NOME", "EMPRESA", "CPF", "CEP", "ENDEREÇO"]);
  assert.equal(PORTAL_POSTAL_HEADERS.at(-1), "CHAVE_NOTA_FISCAL");
});

test("normaliza uma linha pronta para PAC", () => {
  const row = normalizePortalRow({
    NOME: "  MARIA   DA SILVA ", CEP: "60.110-301", "ENDEREÇO": "Rua A", NUMERO: "123",
    BAIRRO: "Centro", CIDADE: "Fortaleza", UF: "ce", SERVICO: "pac", CONTEUDO: "Panfletos",
  });
  assert.equal(row.name, "MARIA DA SILVA");
  assert.equal(row.zip, "60110301");
  assert.equal(row.uf, "CE");
  assert.equal(row.service, "PAC");
  assert.deepEqual(validatePortalRow(row), []);
});

test("sinaliza CEP curto, logradouro vazio e numero suspeito", () => {
  const row = normalizePortalRow({
    NOME: "Teste", CEP: "7130080", NUMERO: "88993635038", BAIRRO: "Centro", CIDADE: "Guarulhos",
    UF: "SP", SERVICO: "PAC", CONTEUDO: "Material",
  });
  const codes = validatePortalRow(row).map((issue) => issue.code);
  assert.ok(codes.includes("INVALID_CEP"));
  assert.ok(codes.includes("REQUIRED"));
  assert.ok(codes.includes("SUSPICIOUS_NUMBER"));
});

test("gera CSV com ponto e virgula e 28 posicoes por registro", () => {
  const row = normalizePortalRow({
    NOME: "JOAO", CEP: "60110301", "ENDEREÇO": "RUA A", NUMERO: "10", BAIRRO: "CENTRO",
    CIDADE: "FORTALEZA", UF: "CE", SERVICO: "SEDEX", CONTEUDO: "PANFLETOS; ADESIVOS",
  });
  assert.equal(portalValues(row).length, 28);
  const csv = buildPortalCsv([row]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^NOME;EMPRESA;CPF;CEP;/);
  assert.match(lines[1], /"PANFLETOS; ADESIVOS"/);
});
