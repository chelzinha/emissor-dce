import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { mapRows } from "../src/importers.js";
import { normalizeService, requiresTrackingCode, remittanceLabel } from "../src/postal-services.js";
import { validateRemittance } from "../src/validation.js";
import { normalizeDceDocument } from "../netlify/functions/_shared/validation.mjs";

const mapping = {
  trackingCode: "OBJETO", service: "SERVICO", recipientName: "NOME", recipientDocument: "CPF",
  street: "ENDERECO", number: "NUMERO", district: "BAIRRO", city: "CIDADE", uf: "UF", zip: "CEP",
  cityCode: "IBGE", reference: "IDENTIFICADOR", description: "CONTEUDO", quantity: "QTD", unitValue: "VALOR",
};

const baseRow = {
  NOME: "FABIOLA MAGALHAES MESQUITA", CPF: "529.982.247-25", ENDERECO: "RUA AGAPITO DOS SANTOS",
  NUMERO: "724", BAIRRO: "CENTRO", CIDADE: "FORTALEZA", UF: "CE", CEP: "60010-250", IBGE: "2304400",
  IDENTIFICADOR: "AABNB-L0677", CONTEUDO: "BRINDE DE NATAL", QTD: "1", VALOR: "10,00",
};

test("normaliza os nomes de MDPB usados no Portal Postal e no contrato", () => {
  assert.equal(normalizeService("MDPB LOCAL - CHANCELA"), "MDPB LOCAL");
  assert.equal(normalizeService("MDPB_L"), "MDPB LOCAL");
  assert.equal(normalizeService("MDPB ESTADUAL A FAT CHANCELA"), "MDPB ESTADUAL");
  assert.equal(normalizeService("mdpb nacional"), "MDPB NACIONAL");
  assert.equal(normalizeService("15318"), "MDPB LOCAL");
  assert.equal(normalizeService("15300"), "MDPB ESTADUAL");
  assert.equal(normalizeService("15326"), "MDPB NACIONAL");
  assert.equal(normalizeService("Mala Direta Postal Básica Nacional"), "MDPB NACIONAL");
});

test("PAC e SEDEX mantêm a regra anterior de normalização", () => {
  assert.equal(normalizeService("SEDEX 10"), "SEDEX");
  assert.equal(normalizeService("sedex"), "SEDEX");
  assert.equal(normalizeService("PAC"), "PAC");
  assert.equal(normalizeService(""), "PAC");
  assert.equal(requiresTrackingCode("PAC"), true);
  assert.equal(requiresTrackingCode("SEDEX"), true);
  assert.equal(requiresTrackingCode("MDPB LOCAL"), false);
});

test("MDPB sem âmbito definido fica bloqueada", () => {
  const [row] = mapRows([{ ...baseRow, SERVICO: "MDPB REG." }], mapping);
  assert.equal(row.service, "MDPB");
  assert.ok(validateRemittance(row).includes("serviço"));
});

test("MDPB com chancela é válida sem SRO", () => {
  const [row] = mapRows([{ ...baseRow, SERVICO: "MDPB LOCAL - CHANCELA" }], mapping);
  assert.equal(row.trackingCode, "");
  assert.equal(row.reference, "AABNB-L0677");
  assert.deepEqual(validateRemittance(row), []);
  assert.equal(remittanceLabel(row), "AABNB-L0677");
});

test("MDPB com SRO informado continua exigindo formato válido", () => {
  const [row] = mapRows([{ ...baseRow, SERVICO: "MDPB NACIONAL", OBJETO: "XX123" }], mapping);
  assert.ok(validateRemittance(row).includes("SRO"));
});

test("PAC e SEDEX sem SRO continuam bloqueados", () => {
  for (const service of ["PAC", "SEDEX"]) {
    const [row] = mapRows([{ ...baseRow, SERVICO: service }], mapping);
    assert.ok(validateRemittance(row).includes("SRO"), service);
  }
});

test("serviço padrão vale só para linha sem serviço no arquivo", () => {
  const { service: _ignored, ...withoutService } = mapping;
  const [fromDefault] = mapRows([baseRow], withoutService, { service: "MDPB ESTADUAL" });
  assert.equal(fromDefault.service, "MDPB ESTADUAL");
  const [fromFile] = mapRows([{ ...baseRow, SERVICO: "PAC", OBJETO: "AA123456789BR" }], mapping, { service: "MDPB ESTADUAL" });
  assert.equal(fromFile.service, "PAC");
});

test("backend aceita MDPB sem SRO e registra o serviço", () => {
  const result = normalizeDceDocument({
    service: "MDPB LOCAL", trackingCode: "",
    identification: { series: 0, number: 1, environment: "2" },
    issuer: { cnpj: "07260680000121", name: "AABNB", address: { street: "RUA A", number: "1", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60000000" } },
    recipient: { documentType: "CPF", document: "52998224725", name: "TESTE", address: { street: "RUA B", number: "2", district: "CENTRO", city: "FORTALEZA", cityCode: "2304400", uf: "CE", zip: "60010250" } },
    items: [{ description: "BRINDE DE NATAL", quantity: 1, unitValue: 10 }],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.document.service, "MDPB LOCAL");
  assert.equal(result.document.trackingCode, "");
});

const imports = fs.readFileSync(new URL("../apps-script/Imports.gs", import.meta.url), "utf8");
const batches = fs.readFileSync(new URL("../apps-script/Batches.gs", import.meta.url), "utf8");
const sandbox = {
  digits_: (value) => String(value ?? "").replace(/\D/g, ""),
  normalizeRecipientDocument_: (document, documentType) => ({ valid: true, document: String(document || ""), documentType: documentType || "CPF" }),
};
vm.createContext(sandbox);
vm.runInContext(`${imports}\n${batches}`, sandbox);

const gsSource = (service, trackingCode = "") => ({
  service, trackingCode, reference: "AABNB-L0677",
  document: {
    recipient: { name: "TESTE", documentType: "CPF", document: "52998224725", address: { street: "RUA A", number: "1", district: "CENTRO", city: "FORTALEZA", uf: "CE", zip: "60010250", cityCode: "2304400" } },
    items: [{ description: "BRINDE DE NATAL", quantity: 1, unitValue: 10 }],
  },
});

test("Apps Script aceita MDPB sem SRO e mantém PAC/SEDEX exigindo SRO", () => {
  assert.deepEqual([...sandbox.normalizeImportedRemittance_(gsSource("MDPB NACIONAL")).errors], []);
  assert.ok(sandbox.normalizeImportedRemittance_(gsSource("PAC")).errors.includes("Código SRO inválido."));
  assert.ok(sandbox.normalizeImportedRemittance_(gsSource("SEDEX")).errors.includes("Código SRO inválido."));
  assert.deepEqual([...sandbox.normalizeImportedRemittance_(gsSource("PAC", "AA123456789BR")).errors], []);
  assert.ok(sandbox.normalizeImportedRemittance_(gsSource("MDPB")).errors.some((error) => /Serviço deve ser/.test(error)));
});

test("Apps Script usa a referência como chave só para remessa sem SRO", () => {
  assert.equal(sandbox.untrackedReferenceKey_("MDPB LOCAL", "", "AABNB-L0677"), "MDPB LOCAL|AABNB-L0677");
  assert.equal(sandbox.untrackedReferenceKey_("MDPB LOCAL", "", "15"), "");
  assert.equal(sandbox.untrackedReferenceKey_("MDPB LOCAL", "AA123456789BR", "AABNB-L0677"), "");
  assert.equal(sandbox.untrackedReferenceKey_("PAC", "", "AABNB-L0677"), "");
});

test("reserva grava o status em bloco por faixa contígua", () => {
  const writes = [];
  const grid = { 2: ["a", "READY", ""], 3: ["b", "READY", ""], 4: ["c", "READY", ""], 9: ["d", "READY", ""] };
  sandbox.getSheet_ = () => ({
    getLastColumn: () => 3,
    getRange: (row, col, rows) => ({
      getValues: () => Array.from({ length: rows }, (_, index) => [...grid[row + index]]),
      setValues: (values) => writes.push({ row, values }),
    }),
  });
  sandbox.headerMap_ = () => ({ ID: 0, STATUS: 1, UPDATED_AT: 2 });
  sandbox.writeRowsInBlocks_("REMITTANCES", [2, 3, 4, 9].map((rowNumber) => ({ rowNumber, changes: { STATUS: "RESERVED", UPDATED_AT: "agora" } })));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].values.length, 3);
  assert.deepEqual(writes[1].values[0], ["d", "RESERVED", "agora"]);
});
