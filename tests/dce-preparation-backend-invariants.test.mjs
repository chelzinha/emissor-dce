import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const clientDce = fs.readFileSync(new URL("../apps-script/ClientDce.gs", import.meta.url), "utf8");
const issuer = fs.readFileSync(new URL("../apps-script/IssuerProfiles.gs", import.meta.url), "utf8");
const prep = fs.readFileSync(new URL("../apps-script/DcePreparation.gs", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../src/client-portal.js", import.meta.url), "utf8");

test("reserva numeracao com lock somente depois de perfil fiscal ativo", () => {
  assert.match(clientDce, /LockService\.getScriptLock\(\)/);
  assert.match(clientDce, /String\(issuerRow\.STATUS\) !== 'ACTIVE'/);
  assert.match(clientDce, /NEXT_NUMBER: lastNumber \+ 1/);
  assert.match(clientDce, /FIRST_NUMBER: firstNumber/);
});

test("numero da DC-e e imposto pelo backend conforme ordem do lote", () => {
  assert.match(clientDce, /Number\(pkg\.FIRST_NUMBER \|\| 0\) \+ located\.index/);
  assert.match(clientDce, /series: Number\(pkg\.SERIES \|\| 0\)/);
  assert.match(clientDce, /reference: id/);
});

test("append e retomavel sem duplicar SRO ja recebido", () => {
  assert.match(clientDce, /if \(existing\[tracking\]\) return \{ _skip: true/);
  assert.match(clientDce, /skipped: records\.length - newRecords\.length/);
});

test("autorizacao exige chave de 44 digitos e protocolo", () => {
  assert.match(clientDce, /\^\\d\{44\}\$/);
  assert.match(clientDce, /Protocolo de autorizacao ausente/);
});

test("XML do fluxo do cliente e salvo por operacao e nao por usuario", () => {
  assert.match(clientDce, /campaign_' \+ campaignId/);
  assert.match(clientDce, /readClientDceXmlFile_/);
  assert.doesNotMatch(clientDce, /writeXmlFile_\(userId/);
});

test("perfil fiscal invalida confirmacao quando agencia altera", () => {
  assert.match(issuer, /if \(!isClient\)/);
  assert.match(issuer, /merged\.nonIcmsContributor = false/);
  assert.match(issuer, /merged\.operationWithoutInvoice = false/);
});


test("proximo numero nao pode retroceder dentro da mesma serie", () => {
  assert.match(issuer, /nextNumber\) < Number\(existing\.NEXT_NUMBER/);
});

test("lista de preparo e paginada em blocos de no maximo 250", () => {
  assert.match(prep, /Math\.min\(250/);
  assert.match(prep, /rows\.slice\(offset, offset \+ limit\)/);
});

test("portal do cliente continua com exatamente tres abas principais", () => {
  const navBlock = portal.match(/const NAV = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(navBlock);
  const ids = [...navBlock[1].matchAll(/\["([^"]+)"/g)].map((m)=>m[1]);
  assert.deepEqual(ids, ["dashboard","simulator","authorization"]);
  assert.match(portal, /id="fiscal-profile"/);
});

test("A1 e senha nao aparecem nos novos arquivos Apps Script", () => {
  const all = `${clientDce}\n${issuer}\n${prep}`.toLowerCase();
  assert.doesNotMatch(all, /certificatebase64/);
  assert.doesNotMatch(all, /passphrase/);
});
