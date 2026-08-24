import assert from 'node:assert/strict';
import test from 'node:test';
import { completeLabelSetup, isLabelSetupComplete, normalizeLabelSetup, normalizeMatrixRegion } from '../src/label-setup.js';

test('normaliza a regiao manual do Data Matrix dentro da pagina', () => {
  assert.deepEqual(normalizeMatrixRegion({ x: .2, y: .1, w: .3, h: .2 }), { x: .2, y: .1, w: .3, h: .2 });
  assert.deepEqual(normalizeMatrixRegion({ x: -.2, y: .9, w: 2, h: .5 }), { x: 0, y: .9, w: 1, h: .09999999999999998 });
});

test('configuracao so fica pronta com regiao e chancela', () => {
  const region = { x: .2, y: .1, w: .3, h: .2 };
  assert.equal(isLabelSetupComplete({ matrixRegion: region }), false);
  assert.equal(isLabelSetupComplete({ postageMarkDataUrl: 'data:image/png;base64,AAAA' }), false);
  assert.equal(isLabelSetupComplete({ matrixRegion: region, postageMarkDataUrl: 'data:image/png;base64,AAAA' }), true);
});

test('configuracao completa registra data e preserva nome da chancela', () => {
  const setup = completeLabelSetup({
    matrixRegion: { x: .2, y: .1, w: .3, h: .2 },
    postageMarkDataUrl: 'data:image/jpeg;base64,AAAA',
    postageMarkName: 'chancela.jpg',
  });
  assert.equal(setup.postageMarkName, 'chancela.jpg');
  assert.ok(setup.configuredAt);
});

test('configuracao da etiqueta aceita null sem quebrar a renderizacao', () => {
  // currentLabelSetup nasce null em elections-portal-return-ui. O default de
  // parametro (= {}) so cobre undefined, entao value.matrixRegion estourava
  // TypeError e abortava updateLabelSetupStatus, derrubando a etapa 3 inteira
  // e deixando os botoes de arquivo sem handler.
  assert.equal(isLabelSetupComplete(null), false);
  assert.equal(isLabelSetupComplete(undefined), false);
  assert.equal(isLabelSetupComplete(0), false);
  assert.equal(isLabelSetupComplete(''), false);

  const vazio = normalizeLabelSetup(null);
  assert.equal(vazio.matrixRegion, null);
  assert.equal(vazio.postageMarkDataUrl, '');
  assert.equal(vazio.postageMarkName, '');
});
