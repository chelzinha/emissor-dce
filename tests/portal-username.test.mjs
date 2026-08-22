import test from "node:test";
import assert from "node:assert/strict";
import {
  findIdentityUserByUsername,
  identityUserAliases,
  normalizePortalUsername,
} from "../netlify/functions/_shared/portal-username.mjs";

test("normaliza username sem transformar em e-mail", () => {
  assert.equal(normalizePortalUsername("  Cliente.JB  "), "cliente.jb");
});

test("prioriza username explicito do Identity", () => {
  const users = [
    { id: "1", email: "financeiro@example.com", user_metadata: { username: "operacao01" } },
    { id: "2", email: "operacao01@outro.com" },
  ];
  assert.equal(findIdentityUserByUsername(users, "operacao01")?.id, "1");
});

test("aceita local-part do e-mail como alias de contingencia", () => {
  const user = { id: "1", email: "cliente.agf@example.com" };
  assert.deepEqual(identityUserAliases(user), ["cliente.agf"]);
  assert.equal(findIdentityUserByUsername([user], "cliente.agf")?.id, "1");
});

test("rejeita alias ambiguo", () => {
  const users = [
    { id: "1", email: "cliente@a.com" },
    { id: "2", email: "cliente@b.com" },
  ];
  assert.equal(findIdentityUserByUsername(users, "cliente"), null);
});

test("rejeita formato de username fora da regra", () => {
  assert.equal(findIdentityUserByUsername([{ id: "1", email: "a@b.com" }], "a@b.com"), null);
});
