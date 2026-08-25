import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const flow = fs.readFileSync(new URL('../src/elections-production-stage-separation-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/elections-production-stage-separation-ui.css', import.meta.url), 'utf8');

test('área da agência carrega separação explícita entre produção e impressão', () => {
  assert.match(html, /elections-production-stage-separation-ui\.js/);
  assert.match(flow, /AGF_OPERATION_STAGE_FULL_1_11/);
  assert.match(flow, /production-stage-7/);
  assert.match(flow, /production-stage-8/);
});

test('etapa 7 não libera arquivos finais nem baixa de impressão', () => {
  assert.match(flow, /decorateStageSeven/);
  assert.match(flow, /\[data-generate-volume\]/);
  assert.match(flow, /\[data-op="print"\]/);
  assert.match(flow, /Produção concluída/);
  assert.match(flow, /Avance para a etapa 8 - Impressão/);
});

test('etapa 8 esconde ações de preparação e exige etiqueta teste aprovada', () => {
  assert.match(flow, /decorateStageEight/);
  for (const selector of ['data-dce-preflight', 'data-op="setup"', 'data-op="matrix"', 'data-op="test"', 'data-generate-test']) {
    assert.match(flow, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(flow, /labelTestOk/);
  assert.match(flow, /Impressão ainda bloqueada/);
  assert.match(flow, /Retorne à etapa 7 - Produção/);
});

test('avisos de etapa são responsivos e não dependem de um novo layout', () => {
  assert.match(css, /production-stage-note/);
  assert.match(css, /@media\(max-width:720px\)/);
});
