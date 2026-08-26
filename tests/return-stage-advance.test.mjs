import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/elections-return-stage-actions.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/elections-return-stage-actions.css', import.meta.url), 'utf8');

test('etapa 3 exibe avanço explícito depois da seleção dos arquivos', () => {
  assert.match(html, /elections-return-stage-actions\.js/);
  assert.match(js, /Continuar: configurar etiqueta/);
  assert.match(js, /#portal-return-csv/);
  assert.match(js, /#portal-return-pdfs/);
  assert.match(js, /data-process-stage="\$\{next\}"/);
});

test('botão só é liberado com CSV e PDF selecionados', () => {
  assert.match(js, /const ready = state\.csv && state\.pdf/);
  assert.match(js, /setDisabled\(button, !ready\)/);
  assert.match(js, /Falta selecionar o CSV das postagens/);
  assert.match(js, /Falta selecionar o PDF das etiquetas/);
});

test('etapa 4 também oferece avanço para a auditoria', () => {
  assert.match(js, /Continuar: auditar Data Matrix/);
  assert.match(js, /#analyze-portal-return/);
  assert.match(css, /return-stage-next/);
});
