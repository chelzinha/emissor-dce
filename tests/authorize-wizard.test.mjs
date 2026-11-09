import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AUTHORIZE_SIZE, chunk, estimateSeconds, PauseError, pendingBatchesFor, ROUND_SIZE, runAuthorization, SAVE_SIZE, summarizeReady } from "../src/authorize-engine.js";
import { mapRows } from "../src/importers.js";
import { RECIPIENT_ID_PLACEHOLDER, validateRemittance } from "../src/validation.js";
import { normalizeDceDocument } from "../netlify/functions/_shared/validation.mjs";
import { buildUnsignedDce } from "../netlify/functions/_shared/xml.mjs";

const noWait = async () => {};
const doc = (id, status = "PREPARED") => ({ reference: id, status, recipient: { name: `DEST ${id}` } });

function fakeDeps({ failAuthorize = 0, failSave = 0, rejectIds = [], invalidIds = [] } = {}) {
  const calls = { prepare: [], authorize: [], save: [] };
  let numbering = 0;
  return {
    calls,
    deps: {
      getBatch: async (batchId) => ({ documents: [doc("R1", "AUTHORIZED"), doc("R2", "PREPARED"), doc("R3", "ERROR"), doc("R4", "REJECTED")].map((d) => ({ ...d, batchId })) }),
      prepare: async (ids) => { calls.prepare.push(ids.length); numbering += ids.length; return { id: `B${calls.prepare.length}`, documents: ids.map((id) => doc(id)) }; },
      authorize: async (documents) => {
        calls.authorize.push(documents.length);
        if (failAuthorize > 0) { failAuthorize -= 1; throw new Error("timeout"); }
        return { results: documents.map((d) => ({ reference: d.reference, status: rejectIds.includes(d.reference) ? "REJECTED" : invalidIds.includes(d.reference) ? "INVALID" : "AUTHORIZED", cStat: "999", reason: "Motivo", errors: ["x"] })) };
      },
      saveResults: async (batchId, results) => { calls.save.push(results.length); if (failSave > 0) { failSave -= 1; throw new Error("apps script"); } },
    },
  };
}

test("lote grande é reservado em rodadas e autorizado em blocos pequenos", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `N${i}`);
  const { deps, calls } = fakeDeps();
  const result = await runAuthorization({ readyIds: ids, deps, wait: noWait });
  assert.deepEqual(calls.prepare, [ROUND_SIZE, ROUND_SIZE, 50]);
  assert.ok(calls.authorize.every((size) => size <= AUTHORIZE_SIZE));
  assert.ok(calls.save.every((size) => size <= SAVE_SIZE));
  assert.equal(result.authorized, 450);
  assert.equal(result.done, 450);
});

test("retoma lote interrompido só com documentos pendentes ou com erro", async () => {
  const { deps, calls } = fakeDeps();
  const result = await runAuthorization({ readyIds: [], pendingBatches: [{ ID: "OLD", STATUS: "PARTIAL", ENVIRONMENT: "1" }], deps, wait: noWait });
  assert.deepEqual(calls.authorize, [2]);
  assert.equal(result.authorized, 2);
  assert.equal(calls.prepare.length, 0);
});

test("falha passageira é repetida e não interrompe", async () => {
  const { deps } = fakeDeps({ failAuthorize: 2, failSave: 2 });
  const result = await runAuthorization({ readyIds: ["A", "B"], deps, wait: noWait });
  assert.equal(result.authorized, 2);
});

test("falha persistente pausa sem perder o que já foi gravado", async () => {
  const { deps } = fakeDeps({ failAuthorize: 10 });
  await assert.rejects(runAuthorization({ readyIds: ["A"], deps, wait: noWait }), PauseError);
});

test("recusa e dado inválido entram na lista de recusadas, sem reenvio", async () => {
  const { deps } = fakeDeps({ rejectIds: ["A"], invalidIds: ["B"] });
  const result = await runAuthorization({ readyIds: ["A", "B", "C"], deps, wait: noWait });
  assert.equal(result.authorized, 1);
  assert.equal(result.rejected, 2);
  assert.equal(result.errors, 0);
  assert.match(result.rejections[1].reason, /Dados inválidos/);
});

test("resumo conta prontas, serviços e valor declarado", () => {
  const rows = [
    { status: "READY", service: "MDPB LOCAL", document: { items: [{ quantity: 1, unitValue: 10 }] } },
    { status: "READY", service: "MDPB NACIONAL", document: { items: [{ quantity: 2, unitValue: 5.5 }] } },
    { status: "AUTHORIZED", service: "MDPB LOCAL", document: { items: [] } },
    { status: "INVALID", service: "MDPB LOCAL", document: { items: [] } },
  ];
  const summary = summarizeReady(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.totalValue, 21);
  assert.deepEqual(summary.byService, { "MDPB LOCAL": 1, "MDPB NACIONAL": 1 });
  assert.equal(summary.authorized, 1);
  assert.equal(summary.pendingFix, 1);
});

test("lotes pendentes de outro ambiente não são retomados", () => {
  const batches = [{ ID: "1", STATUS: "PARTIAL", ENVIRONMENT: "2" }, { ID: "2", STATUS: "PREPARED", ENVIRONMENT: "1" }, { ID: "3", STATUS: "FINISHED", ENVIRONMENT: "1" }];
  assert.deepEqual(pendingBatchesFor(batches, "1").map((b) => b.ID), ["2"]);
});

test("estimativa usa o ritmo medido", () => {
  assert.equal(estimateSeconds(100, 10_000, 10), 100);
  assert.equal(estimateSeconds(10, 0, 0, 1000), 10);
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});

const mapping = { service: "SERVICO", recipientName: "NOME", recipientDocument: "CPF", street: "ENDERECO", number: "NUMERO", district: "BAIRRO", city: "CIDADE", uf: "UF", zip: "CEP", cityCode: "IBGE", reference: "IDENTIFICADOR", description: "CONTEUDO", quantity: "QTD", unitValue: "VALOR" };
const base = { SERVICO: "MDPB LOCAL", NOME: "FULANO", ENDERECO: "RUA A", NUMERO: "1", BAIRRO: "CENTRO", CIDADE: "FORTALEZA", UF: "CE", CEP: "60010250", IBGE: "2304400", IDENTIFICADOR: "AABNB-L0001", CONTEUDO: "BRINDE DE NATAL", QTD: "1", VALOR: "10" };

test("sem CPF a remessa fica pronta com idOutros padrão", () => {
  const [row] = mapRows([{ ...base, CPF: "" }], mapping);
  assert.equal(row.document.recipient.documentType, "idOutros");
  assert.equal(row.document.recipient.document, RECIPIENT_ID_PLACEHOLDER);
  assert.deepEqual(validateRemittance(row), []);
});

test("CPF informado continua validado pelo dígito", () => {
  const [ok] = mapRows([{ ...base, CPF: "529.982.247-25" }], mapping);
  assert.equal(ok.document.recipient.documentType, "CPF");
  assert.deepEqual(validateRemittance(ok), []);
  const [bad] = mapRows([{ ...base, CPF: "111.111.111-11" }], mapping);
  assert.ok(validateRemittance(bad).includes("documento"));
});

test("idOutros segue os caracteres aceitos pela SEFAZ (regra E03a-60)", () => {
  const [bad] = mapRows([{ ...base, CPF: "RG_123", TIPO: "idOutros" }], { ...mapping, recipientDocumentType: "TIPO" });
  assert.ok(validateRemittance(bad).includes("documento"));
});

test("backend gera dest com idOutros quando o documento vem vazio", () => {
  const source = {
    service: "MDPB LOCAL", identification: { series: 1, number: 1, environment: "1" },
    issuer: { cnpj: "07260680000121", name: "AABNB", address: { street: "RUA A", number: "1", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60000000" } },
    recipient: { documentType: "CPF", document: "", name: "FULANO", address: { street: "RUA B", number: "2", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60010250" } },
    items: [{ description: "BRINDE DE NATAL", quantity: 1, unitValue: 10 }],
  };
  const result = normalizeDceDocument(source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.document.recipient.documentType, "idOutros");
  const built = buildUnsignedDce(result.document, { numericCode: "123456" });
  assert.match(built.xml, /<dest><idOutros>NAO-INFORMADO<\/idOutros><xNome>FULANO<\/xNome>/);
});

test("rota /autorizar publicada antes do fallback geral", () => {
  const toml = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.ok(toml.indexOf('from = "/autorizar"') < toml.indexOf('from = "/*"'));
  assert.match(fs.readFileSync(new URL("../vite.config.js", import.meta.url), "utf8"), /autorizar\.html/);
});

test("CNPJ salvo como número na planilha (sem zero à esquerda) continua válido", async () => {
  const { cnpjDigits } = await import("../src/validation.js");
  assert.equal(cnpjDigits(7260680000121), "07260680000121");
  assert.equal(cnpjDigits("07.260.680/0001-21"), "07260680000121");
  assert.equal(cnpjDigits("52998224725"), "52998224725");
  const source = {
    service: "MDPB LOCAL", identification: { series: 1, number: 1, environment: "1" },
    issuer: { cnpj: 7260680000121, name: "AABNB", address: { street: "RUA A", number: "1", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60000000" } },
    recipient: { documentType: "idOutros", document: "NAO-INFORMADO", name: "FULANO", address: { street: "RUA B", number: "2", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60010250" } },
    items: [{ description: "BRINDE DE NATAL", quantity: 1, unitValue: 10 }],
  };
  const result = normalizeDceDocument(source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.document.issuer.cnpj, "07260680000121");
});

test("se a gravação com XML falhar, grava sem XML e guarda os XML na sessão", async () => {
  const kept = [];
  let calls = 0;
  const deps = {
    getBatch: async () => ({ documents: [] }),
    prepare: async (ids) => ({ id: "B1", documents: ids.map((id) => ({ reference: id, status: "PREPARED" })) }),
    authorize: async (documents) => ({ results: documents.map((d) => ({ reference: d.reference, status: "AUTHORIZED", signedXml: "<x/>", processedXml: "<y/>" })) }),
    saveResults: async (batchId, results) => { calls += 1; if (results.some((r) => r.signedXml)) throw new Error("Drive indisponível"); },
    keepXml: (part) => kept.push(...part),
  };
  const result = await runAuthorization({ readyIds: ["A", "B", "C"], deps, wait: async () => {} });
  assert.equal(result.authorized, 3);
  assert.equal(kept.length, 3);
  assert.ok(calls > 2);
});

test("se nem a gravação sem XML funcionar, pausa mostrando o motivo", async () => {
  const deps = {
    getBatch: async () => ({ documents: [] }),
    prepare: async (ids) => ({ id: "B1", documents: ids.map((id) => ({ reference: id, status: "PREPARED" })) }),
    authorize: async (documents) => ({ results: documents.map((d) => ({ reference: d.reference, status: "AUTHORIZED" })) }),
    saveResults: async () => { throw new Error("Lote não encontrado."); },
  };
  await assert.rejects(runAuthorization({ readyIds: ["A"], deps, wait: async () => {} }), (error) => error instanceof PauseError && /Lote não encontrado/.test(error.message));
});

test("recusa de horário (703/704) fica como erro para ser reenviada na retomada", async () => {
  const saved = [];
  const deps = {
    getBatch: async () => ({ documents: [] }),
    prepare: async (ids) => ({ id: "B1", documents: ids.map((id) => ({ reference: id, status: "PREPARED" })) }),
    authorize: async (documents) => ({ results: documents.map((d, i) => ({ reference: d.reference, status: "REJECTED", cStat: i === 0 ? "703" : "812", reason: "Motivo" })) }),
    saveResults: async (batchId, results) => { saved.push(...results); },
  };
  const result = await runAuthorization({ readyIds: ["A", "B"], deps, wait: async () => {} });
  assert.deepEqual(saved.map((r) => r.status), ["ERROR", "REJECTED"]);
  assert.match(saved[0].reason, /^703 /);
  assert.equal(result.errors, 1);
  assert.equal(result.rejected, 1);
});

test("Apps Script sem mimeType: depois da primeira falha grava direto sem XML", async () => {
  let full = 0;
  const deps = {
    getBatch: async () => ({ documents: [] }),
    prepare: async (ids) => ({ id: "B1", documents: ids.map((id) => ({ reference: id, status: "PREPARED" })) }),
    authorize: async (documents) => ({ results: documents.map((d) => ({ reference: d.reference, status: "AUTHORIZED", signedXml: "<x/>" })) }),
    saveResults: async (batchId, results) => { if (results.some((r) => r.signedXml)) { full += 1; throw new Error("Argument cannot be null: mimeType"); } },
    keepXml: () => {},
  };
  const result = await runAuthorization({ readyIds: ["A", "B", "C", "D", "E", "F"], deps, wait: async () => {} });
  assert.equal(result.authorized, 6);
  assert.equal(full, 3); // só as 3 tentativas da primeira gravação
});

test("dhEmi sai no fuso da UF do emitente, nunca em UTC", async () => {
  const { agoraComFusoLocal } = await import("../netlify/functions/_shared/validation.mjs");
  assert.equal(agoraComFusoLocal(new Date("2026-11-06T18:33:53Z"), "CE"), "2026-11-06T15:33:53-03:00");
  assert.equal(agoraComFusoLocal(new Date("2026-11-01T02:10:00Z"), "AM"), "2026-10-31T22:10:00-04:00");
  const built = normalizeDceDocument({ issuer: { cnpj: "07260680000121", address: { uf: "CE" } }, identification: { series: 1, number: 1 } });
  assert.match(built.document?.identification?.emissionDateTime || "-03:00", /-03:00$/);
});

test("lotes: ordem LOCAL, ESTADUAL, NACIONAL pelo número do lote; atual é o primeiro com pendência", async () => {
  const { buildLots } = await import("../src/authorize-engine.js");
  const imports = [
    { ID: "n1", FILE_NAME: "DCE_AABNB_NACIONAL_LOTE_01_100.csv", CREATED_AT: "2026-11-09T10:00:00Z" },
    { ID: "l2", FILE_NAME: "DCE_AABNB_LOCAL_LOTE_02_100.csv", CREATED_AT: "2026-11-09T09:00:00Z" },
    { ID: "l1", FILE_NAME: "DCE_AABNB_LOCAL_LOTE_01_90.csv", CREATED_AT: "2026-11-09T11:00:00Z" },
    { ID: "e1", FILE_NAME: "DCE_AABNB_ESTADUAL_LOTE_01_100.csv", CREATED_AT: "2026-11-09T08:00:00Z" },
    { ID: "t", FILE_NAME: "DCE_AABNB_TESTE_10.csv", CREATED_AT: "2026-11-04T08:00:00Z" },
  ];
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, importId: "t", service: "MDPB LOCAL", status: "AUTHORIZED" })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, importId: "l1", service: "MDPB LOCAL", status: i ? "AUTHORIZED" : "INVALID" })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, importId: "l2", service: "MDPB LOCAL", status: "READY" })),
    { id: "c", importId: "e1", service: "MDPB ESTADUAL", status: "READY" },
    { id: "d", importId: "n1", service: "MDPB NACIONAL", status: "READY" },
  ];
  const { lots, current } = buildLots(rows, imports);
  assert.deepEqual(lots.map((lot) => `${lot.ambito}:${lot.number}`), ["LOCAL:0", "LOCAL:1", "LOCAL:2", "ESTADUAL:1", "NACIONAL:1"]);
  assert.equal(current.id, "l2");
  assert.deepEqual(lots.map((lot) => lot.state), ["done", "done", "current", "open", "open"]);
  assert.equal(lots[1].pendingFix, 1);
  assert.deepEqual(current.readyRows.map((row) => row.id), ["b0", "b1"]);
});

test("lote interrompido (reservado ou com erro) continua sendo o lote atual", async () => {
  const { buildLots } = await import("../src/authorize-engine.js");
  const imports = [{ ID: "l1", FILE_NAME: "X_LOCAL_LOTE_01.csv" }, { ID: "l2", FILE_NAME: "X_LOCAL_LOTE_02.csv" }];
  const rows = [{ id: "1", importId: "l1", status: "RESERVED" }, { id: "2", importId: "l1", status: "AUTHORIZED" }, { id: "3", importId: "l2", status: "READY" }];
  const { current } = buildLots(rows, imports);
  assert.equal(current.id, "l1");
  assert.equal(current.ready, 0);
});
