import test from "node:test";
import assert from "node:assert/strict";
import { buildPostingProtocolModel, paginatePostingProtocol, postalProtocolMetadata, validateProtocolObject } from "../src/posting-protocol.js";

function sro(n) { return `AB${String(n).padStart(9, "0")}BR`; }
function row(n, list, service = "PAC", overrides = {}) {
  return {
    trackingCode: sro(n), service,
    recipient: { name: `DESTINATARIO ${n}`, address: { zip: "60000000" } },
    postal: { LISTA: String(list), DATA_POSTAGEM: "21/08/2026", HORA_POSTAGEM: "14:30", ...overrides },
  };
}

test("real list number is mandatory", () => {
  const item = row(1, "");
  const check = validateProtocolObject(item, 0);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes("LISTA_AUSENTE")));
});

test("PAC service code can default to 4510 only when service is known", () => {
  assert.equal(postalProtocolMetadata(row(1, 100, "PAC")).serviceCode, "4510");
});

test("SEDEX service code can default to 4014 only when service is known", () => {
  assert.equal(postalProtocolMetadata(row(1, 100, "SEDEX")).serviceCode, "4014");
});

test("explicit service code wins", () => {
  assert.equal(postalProtocolMetadata(row(1, 100, "PAC", { CODIGO_SERVICO: "9999" })).serviceCode, "9999");
});

test("protocol groups by postal list, not physical volume", () => {
  const model = buildPostingProtocolModel([row(1, 10), row(2, 10), row(3, 11)], { senderName: "Remetente", cnpj: "123" });
  assert.equal(model.valid, true);
  assert.equal(model.lists.length, 2);
  assert.deepEqual(model.lists.map((l) => l.quantity), [2,1]);
});

test("numbering restarts inside each postal list", () => {
  const model = buildPostingProtocolModel([row(1, 10), row(2, 10), row(3, 11)]);
  assert.deepEqual(model.lists[0].rows.map((r) => r.itemNumber), [1,2]);
  assert.deepEqual(model.lists[1].rows.map((r) => r.itemNumber), [1]);
});

test("duplicate SRO blocks protocol", () => {
  const a = row(1, 10); const b = row(1, 11);
  const model = buildPostingProtocolModel([a,b]);
  assert.equal(model.valid, false);
  assert.ok(model.errors.some((e) => e.includes("SRO_DUPLICADO")));
});

test("different posting dates require explicit protocol date", () => {
  const model = buildPostingProtocolModel([row(1, 10), row(2, 11, "PAC", { DATA_POSTAGEM: "22/08/2026" })]);
  assert.equal(model.valid, false);
  assert.ok(model.errors.includes("DATAS_DE_POSTAGEM_DIVERGENTES"));
});

test("explicit protocol date allows lists with different dates", () => {
  const model = buildPostingProtocolModel([row(1, 10), row(2, 11, "PAC", { DATA_POSTAGEM: "22/08/2026" })], { protocolDate: "22/08/2026" });
  assert.equal(model.valid, true);
});

test("time divergence stays as warning, not artificial list split", () => {
  const model = buildPostingProtocolModel([row(1, 10), row(2, 10, "PAC", { HORA_POSTAGEM: "14:45" })]);
  assert.equal(model.valid, true);
  assert.equal(model.lists.length, 1);
  assert.match(model.lists[0].timeWarning, /Horarios divergentes/);
});

test("pagination keeps two columns per page", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(i + 1, 10));
  const model = buildPostingProtocolModel(rows);
  const pages = paginatePostingProtocol(model, { rowsPerColumn: 6 });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].left.used, 6);
  assert.equal(pages[0].right.used, 6);
});

test("continued list is marked cont", () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(i + 1, 10));
  const pages = paginatePostingProtocol(buildPostingProtocolModel(rows), { rowsPerColumn: 5 });
  assert.equal(pages[0].left.segments[0].continuation, false);
  assert.equal(pages[0].right.segments[0].continuation, true);
});
