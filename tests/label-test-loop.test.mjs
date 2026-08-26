import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const matrix = fs.readFileSync(new URL('../src/matrix-engine.js', import.meta.url), 'utf8');
const generator = fs.readFileSync(new URL('../src/production-label-generator.js', import.meta.url), 'utf8');
const resume = fs.readFileSync(new URL('../src/elections-session-resume.js', import.meta.url), 'utf8');
const stability = fs.readFileSync(new URL('../src/elections-label-test-stability.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('geração busca apenas Data Matrix dos SROs necessários', () => {
  assert.match(matrix, /targetTrackingCodes/);
  assert.match(matrix, /targeted && !targetOnPage/);
  assert.match(generator, /matrixCrops\(portalReturnId, trackingCodes, onProgress\)/);
  assert.match(generator, /targetTrackingCodes: targets/);
  assert.match(generator, /targets\.join\("\\|"\)/);
});

test('restauração de sessão encerra o observer após uma única recuperação', () => {
  assert.match(resume, /function finishRestore/);
  assert.match(resume, /observer\?\.disconnect\(\)/);
  assert.match(resume, /function restoreOnce/);
});

test('etiqueta teste usa modal estável e mantém etapa de produção', () => {
  assert.match(stability, /data-op="test"/);
  assert.match(stability, /askTrackingCode/);
  assert.match(stability, /sessionStorage\.removeItem\(RESUME_KEY\)/);
  assert.doesNotMatch(stability, /location\.reload/);
  assert.match(html, /elections-label-test-stability\.js/);
});
