import test from "node:test";
import assert from "node:assert/strict";
import { stripeFromTextContent, trackingCodesFromText } from "../src/matrix-engine.js";

test("extrai codigos SRO unicos do texto", () => {
  assert.deepEqual(
    trackingCodesFromText("Objeto OY855189152BR outro QN909519897BR e OY855189152BR novamente"),
    ["OY855189152BR", "QN909519897BR"],
  );
});

test("le a tarja mais a direita dentro da janela esperada", () => {
  const viewport = { width: 1000, height: 1000 };
  const textContent = { items: [
    { str: "IMP", transform: [1, 0, 0, 1, 800, 150] },
    { str: "PTG", transform: [1, 0, 0, 1, 900, 120] },
    { str: "FORA", transform: [1, 0, 0, 1, 300, 300] },
  ] };
  assert.equal(stripeFromTextContent(textContent, viewport), "PTG");
});

test("ignora textos longos e fora da janela da tarja", () => {
  const viewport = { width: 1000, height: 1000 };
  const textContent = { items: [
    { str: "DESTINATARIO", transform: [1, 0, 0, 1, 900, 100] },
    { str: "IMP", transform: [1, 0, 0, 1, 500, 500] },
  ] };
  assert.equal(stripeFromTextContent(textContent, viewport), null);
});
