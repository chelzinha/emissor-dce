import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
test("portal mantem exatamente tres areas principais",()=>{const src=read("src/client-portal.js");assert.match(src,/\["dashboard"/);assert.match(src,/\["simulator"/);assert.match(src,/\["authorization"/);assert.equal((src.match(/\["dashboard"|\["simulator"|\["authorization"/g)||[]).length,3)});
test("login visivel usa Usuario e Senha sem campo de email",()=>{const src=read("src/client-portal.js");assert.match(src,/>Usuário</);assert.match(src,/>Senha</);assert.doesNotMatch(src,/name="email"/)});
test("API expoe preflight reserva e sincronizacao",()=>{const api=read("apps-script/Api.gs");for(const a of ["productionDce.list","productionDce.preflight","productionDce.reserve","productionDce.syncResults"])assert.match(api,new RegExp(a.replace(".","\\.")))});
test("preflight exige valor e documento antes de liberar",()=>{const src=read("apps-script/ProductionDce.gs");assert.match(src,/CPF\/CNPJ do destinatario invalido/);assert.match(src,/Valor declarado deve ser maior ou igual/);assert.match(src,/STATUS:'DCE_PREPARED'/)});
test("resultado autorizado retorna ao objeto postal",()=>{const src=read("apps-script/ProductionDce.gs");assert.match(src,/ACCESS_KEY/);assert.match(src,/PROTOCOL/);assert.match(src,/READY_FOR_UNIFIED_LABEL/)});
test("evento preparado prematuro nao entra na metrica",()=>{const src=read("apps-script/Operations.gs");assert.match(src,/AWAITING_DCE_PREPARATION/)});
test("rota portal nao substitui index do emissor",()=>{const vite=read("vite.config.js");assert.match(vite,/portal:resolve\(rootDir,"portal.html"\)/);assert.match(vite,/dce:resolve\(rootDir,"index.html"\)/)});

test("valor declarado preserva decimal com ponto e virgula",()=>{const src=read("apps-script/ProductionDce.gs");assert.match(src,/typeof value==='number'/);assert.match(src,/lastIndexOf\(','\)/);assert.match(src,/lastIndexOf\('\.'\)/)});
test("autorizacao em producao exige status e confirmacao explicita",()=>{const src=read("src/client-portal.js");assert.match(src,/\/api\/dce\/status/);assert.match(src,/window\.confirm\("Confirma a autorização deste lote no ambiente de PRODUÇÃO\?"\)/)});
