import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  ambitoOf, buildLabelEntries, cepnetBars, cepnetCheckDigit, CEPNET, chancelaContractLine, conferenceCsv, createLabelsPdf,
  createPostingListPdf, defaultChancelaConfig, formatAccessKey, formatDceNumber, formatEmissionDate, formatRecipientDocument,
  groupByAmbito, LABEL_SIZE, postingListPlan, qrCodeUrl, splitParts, validateChancelaConfig,
  A4_CELL, A4_PER_FILE, a4Slot, createA4LabelsPdf, daceRows,
} from "../src/mdpb-label.js";

const logo = fs.readFileSync(new URL("../public/correios-traco-positiva.png", import.meta.url));
const issuer = { cnpj: "07260680000121", name: "ASSOCIAÇÃO DOS APOSENTADOS DO BANCO DO NORDESTE DO BRASIL", address: { street: "RUA PERBOYRE E SILVA", number: "111", complement: "SALA 801", district: "CENTRO", city: "FORTALEZA", uf: "CE", zip: "60030200" } };
const key = (n) => `2311070726068000012199001000000${String(n).padStart(4, "0")}123456789`.slice(0, 44);

function fixture() {
  const docs = [
    { reference: "R1", service: "MDPB NACIONAL", zip: "70000000", name: "ANA" },
    { reference: "R2", service: "MDPB LOCAL", zip: "60020000", name: "BRUNO" },
    { reference: "R3", service: "MDPB LOCAL", zip: "60010250", name: "FABIOLA MAGALHÃES – MESQUITA" },
    { reference: "R4", service: "PAC", zip: "60010250", name: "CARLA" },
    { reference: "R5", service: "MDPB ESTADUAL", zip: "62000000", name: "DIEGO" },
    { reference: "R6", service: "MDPB LOCAL", zip: "60010", name: "CEP RUIM" },
    { reference: "R7", service: "MDPB LOCAL", zip: "60030000", name: "NAO AUTORIZADA" },
  ].map((d, i) => ({ reference: d.reference, service: d.service, status: "AUTHORIZED", identification: { number: i + 1, series: 1 }, issuer,
    recipient: { documentType: "idOutros", document: "NAO-INFORMADO", name: d.name, address: { street: "RUA A", number: "10", complement: "", district: "CENTRO", city: "FORTALEZA", uf: "CE", zip: d.zip } } }));
  const dceRows = docs.map((d, i) => ({ BATCH_ID: "B1", REMITTANCE_ID: d.reference, STATUS: d.reference === "R7" ? "REJECTED" : "AUTHORIZED", ACCESS_KEY: key(i + 1), PROTOCOL: "123260000012345", AUTHORIZED_AT: "2026-11-03T16:10:01-03:00", NUMBER: i + 1, SERIES: 1 }));
  return { batches: [{ ID: "B1", ENVIRONMENT: "1" }], documentsByBatch: { B1: docs }, dceRows };
}

test("CEPNet tem 47 barras, DV correto e extensão dentro do guia", () => {
  assert.equal(cepnetCheckDigit("60010250"), 6);
  const bars = cepnetBars("60010250");
  assert.equal(bars.length, 47);
  assert.equal(bars[0], "1"); assert.equal(bars[46], "1");
  assert.equal(bars.slice(1, 46).split("").filter((b) => b === "1").length, 18); // 2 barras longas por dígito
  const span = 46 * CEPNET.pitch + CEPNET.barWidth;
  assert.ok(span >= 47.75 && span <= 60.33);
  assert.ok(CEPNET.tall >= 2.9 && CEPNET.tall <= 3.4 && CEPNET.short >= 1.0 && CEPNET.short <= 1.5);
  assert.throws(() => cepnetBars("6001"), /CEP inválido/);
});

test("só MDPB autorizada entra, ordenada por âmbito e CEP crescente", () => {
  const { entries, skipped } = buildLabelEntries(fixture());
  assert.deepEqual(entries.map((e) => e.reference), ["R3", "R2", "R5", "R1"]);
  assert.deepEqual(skipped, { notAuthorized: 1, notMdpb: 1, duplicated: 0, invalidZip: 1 });
  assert.deepEqual(groupByAmbito(entries).map((g) => [g.ambito, g.entries.length]), [["LOCAL", 2], ["ESTADUAL", 1], ["NACIONAL", 1]]);
});

test("chave repetida em outro lote não gera etiqueta duplicada", () => {
  const data = fixture();
  data.batches.push({ ID: "B2", ENVIRONMENT: "1" });
  data.documentsByBatch.B2 = [data.documentsByBatch.B1[1]];
  data.dceRows.push({ ...data.dceRows[1], BATCH_ID: "B2" });
  const { entries, skipped } = buildLabelEntries(data);
  assert.equal(entries.length, 4);
  assert.equal(skipped.duplicated, 1);
});

test("formatações da DACE resumida", () => {
  assert.equal(ambitoOf("MDPB ESTADUAL"), "ESTADUAL");
  assert.equal(ambitoOf("PAC"), "");
  assert.equal(formatDceNumber(1), "000.000.001");
  assert.equal(formatEmissionDate("2026-11-03T16:10:01-03:00"), "03/11/2026");
  assert.equal(formatRecipientDocument({ documentType: "idOutros", document: "NAO-INFORMADO" }), "NÃO INFORMADO");
  assert.equal(formatRecipientDocument({ documentType: "CPF", document: "52998224725" }), "529.982.247-25");
  assert.equal(formatAccessKey(key(1)).split(" ").length, 11);
  assert.equal(qrCodeUrl(key(1), "1"), `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${key(1)}&tpAmb=1`);
});

test("configuração da chancela do AABNB vem pronta e é validada", () => {
  const config = defaultChancelaConfig(issuer);
  assert.deepEqual(validateChancelaConfig(config), []);
  assert.equal(chancelaContractLine(config), "9912398647/2016 - DR/CE");
  assert.ok(validateChancelaConfig({ ...config, contractYear: "16" }).length);
  assert.ok(validateChancelaConfig({ ...config, sigla: "" }).length);
});

test("PDF de etiquetas: uma página 100 x 150 mm por objeto, com acentos e traço longo", async () => {
  const { entries } = buildLabelEntries(fixture());
  const { bytes } = await createLabelsPdf(entries, defaultChancelaConfig(issuer), logo);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 4);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - LABEL_SIZE[0]) < 0.01 && Math.abs(height - LABEL_SIZE[1]) < 0.01);
  assert.ok(Math.abs(width - 283.46) < 0.1);
});

test("PDF recusa configuração incompleta", async () => {
  const { entries } = buildLabelEntries(fixture());
  await assert.rejects(createLabelsPdf(entries, { ...defaultChancelaConfig(issuer), contract: "" }, logo), /contrato/);
});

test("arquivos de etiquetas divididos em partes de até 500", () => {
  const parts = splitParts(Array.from({ length: 1040 }, (_, i) => i));
  assert.deepEqual(parts.map((p) => [p.index, p.total, p.start, p.entries.length]), [[1, 3, 0, 500], [2, 3, 500, 500], [3, 3, 1000, 40]]);
});

test("lista de postagem reserva espaço para total e assinaturas", async () => {
  assert.deepEqual(postingListPlan(43, 49, 55, 7), [42, 1]);
  assert.deepEqual(postingListPlan(10, 49, 55, 7), [10]);
  assert.equal(postingListPlan(1882, 49, 55, 7).reduce((a, b) => a + b, 0), 1882);
  const { entries } = buildLabelEntries(fixture());
  const bytes = await createPostingListPdf(entries.filter((e) => e.ambito === "LOCAL"), defaultChancelaConfig(issuer));
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("CSV de conferência numera por âmbito", () => {
  const { entries } = buildLabelEntries(fixture());
  const lines = conferenceCsv(entries).trim().split("\r\n");
  assert.equal(lines.length, 5);
  assert.match(lines[1], /^"1";"LOCAL"/);
  assert.match(lines[3], /^"1";"ESTADUAL"/);
});

test("tela Etiquetas está no menu e a marca dos Correios está publicada", () => {
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /\["labels", "Etiquetas"\]/);
  assert.match(main, /labelsView\.open\(\)/);
  assert.ok(fs.statSync(new URL("../public/correios-traco-positiva.png", import.meta.url)).size > 1000);
});

test("A4: 6 etiquetas por folha, área útil dentro da célula e da margem de impressão", async () => {
  const { entries } = buildLabelEntries(fixture());
  const seven = [...entries, ...entries.slice(0, 3)];
  const { bytes, sheets, report } = await createA4LabelsPdf(seven);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(sheets, 2);
  assert.equal(report.overflow, 0);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1);
  const mmPt = 72 / 25.4;
  const slots = [0, 1, 2, 3, 4, 5].map(a4Slot);
  assert.deepEqual(slots.map((s) => [s.col, s.row]), [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]);
  slots.forEach(({ x, y, col, row }) => {
    assert.ok(x >= (col * A4_CELL.width + 4.5) * mmPt);
    assert.ok(x + (A4_CELL.width - 2 * A4_CELL.insetX) * mmPt <= ((col + 1) * A4_CELL.width - 4.5) * mmPt + 0.01);
    assert.ok(y >= 4 * mmPt && y + (A4_CELL.height - 2 * A4_CELL.insetY) * mmPt <= 841.89 - 4 * mmPt);
  });
  assert.equal(A4_PER_FILE % 6, 0);
});

test("A4 e 10x15 usam os mesmos campos da DACE resumida", () => {
  const { entries } = buildLabelEntries(fixture());
  const rows = daceRows(entries[0]).filter(Boolean);
  assert.equal(rows.length, 12);
  assert.match(rows[9], /NOME DESTINATÁRIO/);
});

test("lista de postagem do formato A4 não exige contrato", async () => {
  const { entries } = buildLabelEntries(fixture());
  const bytes = await createPostingListPdf(entries.filter((e) => e.ambito === "LOCAL"), { format: "A4_6", weightGrams: "100" });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await assert.rejects(createPostingListPdf(entries, { format: "A4_6", weightGrams: "0" }), /Peso/);
});

test("10 x 15 sem chancela: uma página 100 x 150 mm por objeto, sem exigir contrato", async () => {
  const { createThermalFrankingLabelsPdf, FRANKING_FORMATS } = await import("../src/mdpb-label.js");
  const { entries } = buildLabelEntries(fixture());
  const { bytes, report } = await createThermalFrankingLabelsPdf(entries);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), entries.length);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - LABEL_SIZE[0]) < 0.01 && Math.abs(height - LABEL_SIZE[1]) < 0.01);
  assert.equal(report.overflow, 0);
  assert.ok(FRANKING_FORMATS.includes("10x15_SC"));
  const list = await createPostingListPdf(entries.filter((e) => e.ambito === "LOCAL"), { format: "10x15_SC", weightGrams: "100" });
  assert.equal((await PDFDocument.load(list)).getPageCount(), 1);
});
