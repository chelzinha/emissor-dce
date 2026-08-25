import test from "node:test";
import assert from "node:assert/strict";
import { listAllIdentityUsers } from "../netlify/functions/_shared/identity-users.mjs";

test("login e provisionamento percorrem todas as paginas do Identity", async () => {
  const calls = [];
  const users = await listAllIdentityUsers(async ({ page, perPage }) => {
    calls.push({ page, perPage });
    return page === 1 ? Array.from({ length: 2 }, (_, index) => ({ id: index + 1 })) : [{ id: 3 }];
  }, { perPage: 2 });
  assert.deepEqual(users.map((user) => user.id), [1, 2, 3]);
  assert.deepEqual(calls, [{ page: 1, perPage: 2 }, { page: 2, perPage: 2 }]);
});

test("paginacao falha de forma explicita se o limite for excedido", async () => {
  await assert.rejects(
    () => listAllIdentityUsers(async () => [{ id: 1 }], { perPage: 1, maxPages: 2 }),
    /Limite de paginação/
  );
});
