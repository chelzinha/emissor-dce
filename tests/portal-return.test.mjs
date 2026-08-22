import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortalReturnBackendRows,
  chunkRows,
  mergePortalRowsWithMatrix,
  parsePortalReturnCsv,
  planVolumes,
  summarizePortalReturn,
  VOLUME_CAPACITY,
} from "../src/portal-return.js";

const csv = [
  "OBJETO;SERVICO;DESTINATARIO;ENDERECO;NUM;BAIRRO;CIDADE;UF;CEP;CONTEUDO;CODIGO_PP",
  "OY855189152BR;SEDEX;CECILIA;RUA A;10;CENTRO;FORTALEZA;CE;60441685;PANFLETOS;REF1",
  "QN909519897BR;PAC;PAULO;RUA B;20;CENTRO;ARACATI;CE;62882466;PANFLETOS;REF2",
].join("\r\n");

test("le o CSV de retorno e normaliza PAC/SEDEX", () => {
  const parsed = parsePortalReturnCsv(csv);
  assert.equal(parsed.delimiter, ";");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].trackingCode, "OY855189152BR");
  assert.equal(parsed.rows[0].service, "SEDEX");
  assert.equal(parsed.rows[1].service, "PAC");
  assert.deepEqual(parsed.errors, []);
});

test("marca objeto duplicado e SRO invalido", () => {
  const parsed = parsePortalReturnCsv([
    "OBJETO;SERVICO",
    "OY855189152BR;SEDEX",
    "OY855189152BR;SEDEX",
    "INVALIDO;PAC",
  ].join("\n"));
  assert.ok(parsed.rows[0].errors.includes("SRO_DUPLICADO"));
  assert.ok(parsed.rows[1].errors.includes("SRO_DUPLICADO"));
  assert.ok(parsed.rows[2].errors.includes("SRO_INVALIDO"));
});

test("casa Data Matrix pelo proprio SRO decodificado", () => {
  const parsed = parsePortalReturnCsv(csv);
  const merged = mergePortalRowsWithMatrix(parsed.rows, [
    { objeto: "OY855189152BR", origem: "codigo", payload: "ABC-OY855189152BR-XYZ", arquivo: "sedex.pdf", pagina: 1 },
    { objeto: "QN909519897BR", origem: "codigo", payload: "ABC-QN909519897BR-XYZ", arquivo: "pac.pdf", pagina: 2 },
  ]);
  assert.equal(merged[0].matrix.status, "AUTO_VERIFIED");
  assert.equal(merged[1].matrix.status, "AUTO_VERIFIED");
  const summary = summarizePortalReturn(merged);
  assert.equal(summary.total, 2);
  assert.equal(summary.pac, 1);
  assert.equal(summary.sedex, 1);
  assert.equal(summary.autoVerified, 2);
  assert.equal(summary.readyForProduction, true);
  assert.equal(summary.fullyAutoVerified, true);
});

test("bloqueia prontidao quando falta ou diverge Data Matrix", () => {
  const parsed = parsePortalReturnCsv(csv);
  const merged = mergePortalRowsWithMatrix(parsed.rows, [
    { objeto: "OY855189152BR", origem: "codigo", payload: "ABC-OUTRO-OBJETO" },
  ]);
  const summary = summarizePortalReturn(merged);
  assert.equal(summary.divergent, 1);
  assert.equal(summary.missing, 1);
  assert.equal(summary.readyForProduction, false);
});

test("planeja volumes de ate 250 sem misturar PAC e SEDEX", () => {
  assert.equal(VOLUME_CAPACITY, 250);
  const rows = [];
  for (let i = 0; i < 1000; i += 1) rows.push({ service: "SEDEX", trackingCode: `S${i}` });
  for (let i = 0; i < 183; i += 1) rows.push({ service: "PAC", trackingCode: `P${i}` });
  const volumes = planVolumes(rows);
  assert.equal(volumes.length, 5);
  assert.deepEqual(volumes.map((v) => [v.service, v.quantity]), [
    ["SEDEX", 250], ["SEDEX", 250], ["SEDEX", 250], ["SEDEX", 250], ["PAC", 183],
  ]);
  assert.deepEqual(volumes.map((v) => `${v.number}/${v.totalVolumes}`), ["1/5", "2/5", "3/5", "4/5", "5/5"]);
});

test("monta payload para backend e divide em blocos", () => {
  const parsed = parsePortalReturnCsv(csv);
  const merged = mergePortalRowsWithMatrix(parsed.rows, []);
  const backend = buildPortalReturnBackendRows(merged);
  assert.equal(backend.length, 2);
  assert.equal(backend[0].postal.OBJETO, "OY855189152BR");
  assert.deepEqual(chunkRows(Array.from({ length: 401 }), 200).map((part) => part.length), [200, 200, 1]);
});
