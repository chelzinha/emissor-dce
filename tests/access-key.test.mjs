import assert from "node:assert/strict";
import test from "node:test";
import { createAccessKey, modulo11 } from "../netlify/functions/_shared/access-key.mjs";

test("módulo 11 reproduz o dígito do exemplo do manual", () => {
  const base = "4317099999808080011263001850856881100000001";
  assert.equal(base.length, 43);
  assert.equal(modulo11(base), 5);
});

test("chave própria possui 44 dígitos e usa tpEmit 2", () => {
  const result = createAccessKey({
    identification: {
      cUF: "23", emissionDateTime: "2026-08-18T10:00:00-03:00", model: "99",
      series: "0", number: "1", issueMode: "1", issuerType: "2", authorizationSite: "0",
    },
    issuer: { cnpj: "11222333000181" },
  }, "123456");
  assert.match(result.key, /^\d{44}$/);
  assert.equal(result.key.slice(35, 36), "2");
  assert.equal(result.key.at(-1), String(modulo11(result.key.slice(0, -1))));
});
