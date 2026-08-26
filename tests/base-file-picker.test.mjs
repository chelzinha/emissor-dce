import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const code = fs.readFileSync(new URL("../src/elections-file-picker-fix.js", import.meta.url), "utf8");

test("seletor de arquivo da base recebe a proteção contra recriação do DOM", () => {
  assert.match(code, /'#base-file'/);
  assert.match(code, /\.upload-box input\[type="file"\]/);
  assert.match(code, /agf-native-file-visible/);
});

test("controle nativo permanece habilitado e recebe os eventos completos do clique", () => {
  assert.match(code, /input\.disabled = false/);
  assert.match(code, /addEventListener\('pointerdown', containPickerEvent\)/);
  assert.match(code, /addEventListener\('mousedown', containPickerEvent\)/);
  assert.match(code, /addEventListener\('click', containPickerEvent\)/);
  assert.match(code, /pointer-events:auto!important/);
});
