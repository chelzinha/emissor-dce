import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');
const recovery = fs.readFileSync(new URL('../src/elections-production-matrix-inheritance.js', import.meta.url), 'utf8');

test('produção reconhece a auditoria concluída na etapa 5', () => {
  assert.match(html, /elections-production-matrix-inheritance\.js/);
  assert.match(recovery, /operation\.record/);
  assert.match(recovery, /MATRIX_100_VERIFIED/);
  assert.match(recovery, /PORTAL_RETURN_AUDIT/);
  assert.match(recovery, /matrix-100:/);
});

test('auditoria herdada exige total compatível e ausência de faltas ou divergências', () => {
  assert.match(recovery, /summary\.textOnly/);
  assert.match(recovery, /matched === total/);
  assert.match(recovery, /summary\.missing/);
  assert.match(recovery, /summary\.divergent/);
  assert.match(recovery, /READY_FOR_UNIFIED_LABEL/);
});

test('releitura manual usa resultado em memória sem depender de recortes Base64', () => {
  assert.match(recovery, /keepCrops: false/);
  assert.match(recovery, /audit\.audit\.filter/);
  assert.doesNotMatch(recovery, /verifyCrops/);
  assert.match(recovery, /item\.doc\.destroy/);
});

test('ação de Data Matrix preserva a etapa de produção mesmo após recarga', () => {
  assert.match(recovery, /AGF_OPERATION_STAGE_FULL_1_11/);
  assert.match(recovery, /AGF_OPERATIONS_RESUME_V1/);
  assert.match(recovery, /view: 'production'/);
  assert.match(recovery, /stopImmediatePropagation/);
});
