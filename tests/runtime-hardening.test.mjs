import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("bibliotecas postais sao empacotadas localmente", () => {
  const source = read("src/postal-vendors.js");
  assert.doesNotMatch(source, /cdnjs|cdn\.jsdelivr/);
  assert.match(source, /import\("pdfjs-dist\/build\/pdf\.mjs"\)/);
  assert.match(source, /import\("@zxing\/library"\)/);
});

test("paginas recebem politica CSP", () => {
  const config = read("netlify.toml");
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /object-src 'none'/);
  assert.match(config, /frame-ancestors 'none'/);
});

test("QR Code autorizado e persistido e reutilizado na etiqueta", () => {
  assert.match(read("apps-script/Config.gs"), /'QR_CODE'/);
  assert.match(read("apps-script/Batches.gs"), /QR_CODE: result\.qrCode/);
  assert.match(read("apps-script/ProductionDocuments.gs"), /qrCode: String\(dce\.QR_CODE/);
  assert.match(read("src/production-label-generator.js"), /d\.qrCode \|\|/);
});
