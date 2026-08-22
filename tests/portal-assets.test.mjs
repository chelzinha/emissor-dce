import test from "node:test";
import assert from "node:assert/strict";
import { compareFileManifests } from "../src/portal-assets.js";

test("manifesto aceita os mesmos PDFs com nome, tamanho e hash iguais", () => {
  const expected = [{ name: "etiquetas_1.pdf", size: 1000, sha256: "abc" }, { name: "etiquetas_2.pdf", size: 2000, sha256: "def" }];
  const actual = [{ name: "etiquetas_2.pdf", size: 2000, sha256: "def" }, { name: "etiquetas_1.pdf", size: 1000, sha256: "abc" }];
  assert.equal(compareFileManifests(expected, actual).valid, true);
});

test("manifesto rejeita PDF diferente mesmo com nome e tamanho iguais", () => {
  const result = compareFileManifests([{ name: "etiquetas.pdf", size: 1000, sha256: "abc" }], [{ name: "etiquetas.pdf", size: 1000, sha256: "zzz" }]);
  assert.equal(result.valid, false);
  assert.equal(result.hashMismatch.length, 1);
});

test("manifesto rejeita ausencia ou arquivo inesperado", () => {
  const result = compareFileManifests([{ name: "a.pdf", size: 10 }, { name: "b.pdf", size: 20 }], [{ name: "a.pdf", size: 10 }, { name: "c.pdf", size: 20 }]);
  assert.equal(result.valid, false);
  assert.equal(result.missing.length, 1);
  assert.equal(result.unexpected.length, 1);
});
