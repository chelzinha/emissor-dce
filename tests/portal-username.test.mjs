import test from "node:test";
import assert from "node:assert/strict";
import { findIdentityUserByUsername, normalizePortalUsername } from "../netlify/functions/_shared/portal-username.mjs";

test("normaliza username sem transformar em e-mail",()=>assert.equal(normalizePortalUsername(" Cliente_01 "),"cliente_01"));
test("prioriza username explicito do Identity",()=>{const u=[{email:"outro@x.com",user_metadata:{username:"cliente"}},{email:"cliente@x.com"}];assert.equal(findIdentityUserByUsername(u,"cliente"),u[0])});
test("aceita local-part do e-mail como alias de contingencia",()=>{const u=[{email:"operacao@x.com"}];assert.equal(findIdentityUserByUsername(u,"operacao"),u[0])});
test("rejeita alias ambiguo",()=>assert.equal(findIdentityUserByUsername([{email:"a@x.com"},{email:"a@y.com"}],"a"),null));
test("rejeita formato fora da regra",()=>assert.equal(findIdentityUserByUsername([{email:"ok@x.com"}],"@@"),null));
