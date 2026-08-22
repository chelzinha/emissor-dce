import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOfflineManifestObjects, parseOfflineManifest, validateOfflineManifest } from '../src/offline-manifest.js';

const H = 'a'.repeat(64);
function object(code, service, extra = {}) {
  return { trackingCode: code, service, matrixStatus: 'AUTO_VERIFIED', matrixOrigin: 'codigo', ...extra };
}
function validManifest() {
  const objects = [object('AA123456789BR', 'PAC'), object('BB123456789BR', 'SEDEX')];
  return {
    schema: 'agf-postal-operations-local-manifest', version: 3, batchId: 'batch-1', documentMode: 'SIMPLIFIED_DECLARATION',
    summary: { total: 2, pac: 1, sedex: 1, matrixVerified: 2, matrixPending: 0 },
    physicalTests: [
      { service: 'PAC', trackingCode: 'AA123456789BR', approved: true },
      { service: 'SEDEX', trackingCode: 'BB123456789BR', approved: true },
    ],
    sourceFiles: [{ name: 'retorno.csv', sha256: H }], generatedFiles: [{ name: 'etiqueta.pdf', sha256: H }],
    volumes: [
      { number: 1, service: 'PAC', quantity: 1, trackingCodes: ['AA123456789BR'] },
      { number: 2, service: 'SEDEX', quantity: 1, trackingCodes: ['BB123456789BR'] },
    ], operationEvents: [], objects,
  };
}

test('aceita manifesto offline v3 coerente', () => {
  const result = validateOfflineManifest(validManifest());
  assert.equal(result.valid, true);
  assert.equal(result.summary.total, 2);
});

test('rejeita Matrix pendente e cobertura incompleta de volumes', () => {
  const manifest = validManifest();
  manifest.objects[0].matrixStatus = 'TEXT_ONLY';
  manifest.volumes[0].trackingCodes = [];
  manifest.volumes[0].quantity = 0;
  const result = validateOfflineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.problems.includes('MATRIX_NAO_VERIFICADO:AA123456789BR'));
  assert.ok(result.problems.includes('COBERTURA_VOLUMES_DIVERGENTE'));
});

test('modo DCE exige chave de 44 digitos e protocolo', () => {
  const manifest = validManifest();
  manifest.documentMode = 'DCE_AUTHORIZED';
  const result = validateOfflineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.problems.some((item) => item.startsWith('CHAVE_DCE_INVALIDA:')));
  assert.ok(result.problems.some((item) => item.startsWith('PROTOCOLO_DCE_AUSENTE:')));
});

test('parser aceita JSON valido e rejeita JSON invalido', () => {
  assert.equal(parseOfflineManifest(JSON.stringify(validManifest())).batchId, 'batch-1');
  assert.throws(() => parseOfflineManifest('{'), /MANIFESTO_JSON_INVALIDO/);
});

test('comparacao detecta SRO ausente, extra e servico divergente', () => {
  const manifest = validManifest();
  const comparison = compareOfflineManifestObjects(manifest, [
    { trackingCode: 'AA123456789BR', service: 'SEDEX' },
    { trackingCode: 'CC123456789BR', service: 'PAC' },
  ]);
  assert.equal(comparison.exact, false);
  assert.deepEqual(comparison.missingInBackend, ['BB123456789BR']);
  assert.deepEqual(comparison.extraInBackend, ['CC123456789BR']);
  assert.equal(comparison.serviceMismatch.length, 1);
});

test('eventos fisicos sao validados e entrega exige impressao integral', () => {
  const manifest = validManifest();
  manifest.operationEvents = [
    { id: 'e1', type: 'LABEL_PRINTED', service: 'PAC', quantity: 1, occurredAt: '2026-08-21T02:00:00-03:00' },
    { id: 'e2', type: 'LABEL_HANDOFF', service: 'PAC', quantity: 1, occurredAt: '2026-08-21T02:10:00-03:00', receivedBy: 'Operacao' },
    { id: 'e3', type: 'LABEL_HANDOFF', service: 'SEDEX', quantity: 1, occurredAt: '2026-08-21T02:10:00-03:00', receivedBy: 'Operacao' },
  ];
  const result = validateOfflineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.problems.includes('ENTREGA_SEM_IMPRESSAO_INTEGRAL:SEDEX'));
});

test('evento de teste exige SRO valido', () => {
  const manifest = validManifest();
  manifest.operationEvents = [
    { id: 't1', type: 'LABEL_TEST_APPROVED', service: 'PAC', quantity: 1, trackingCode: 'INVALIDO', occurredAt: '2026-08-21T02:00:00-03:00' },
  ];
  const result = validateOfflineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.problems.includes('EVENTO_TESTE_SRO_INVALIDO:t1'));
});

test('impressao offline nao pode ser registrada parcialmente', () => {
  const manifest = validManifest();
  manifest.operationEvents = [
    { id: 'p1', type: 'LABEL_PRINTED', service: 'PAC', quantity: 1, occurredAt: '2026-08-21T02:00:00-03:00' },
  ];
  // PAC tem total 1 neste fixture, portanto ainda e valido.
  assert.equal(validateOfflineManifest(manifest).valid, true);
  manifest.summary.pac = 2;
  manifest.summary.total = 3;
  manifest.objects.push(object('CC123456789BR', 'PAC'));
  manifest.volumes[0].trackingCodes.push('CC123456789BR');
  manifest.volumes[0].quantity = 2;
  const result = validateOfflineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.problems.includes('IMPRESSAO_PARCIAL_NAO_PERMITIDA:PAC'));
});

test('parser atualiza manifesto v2 legado para v3 sem inventar eventos', () => {
  const legacy = validManifest();
  legacy.version = 2;
  delete legacy.operationEvents;
  const parsed = parseOfflineManifest(JSON.stringify(legacy));
  assert.equal(parsed.version, 3);
  assert.deepEqual(parsed.operationEvents, []);
});


test('evento LABEL_GENERATED offline é opcional, mas quando existe precisa representar o serviço inteiro', () => {
  const manifest = validManifest();
  manifest.operationEvents = [
    { id: 'g1', type: 'LABEL_GENERATED', service: 'PAC', quantity: 1, occurredAt: '2026-08-21T02:00:00-03:00' },
    { id: 'g2', type: 'LABEL_GENERATED', service: 'SEDEX', quantity: 1, occurredAt: '2026-08-21T02:00:00-03:00' },
  ];
  const ok = validateOfflineManifest(manifest);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.summary.generated, { PAC: 1, SEDEX: 1 });

  manifest.summary.pac = 2;
  manifest.summary.total = 3;
  manifest.objects.push(object('CC123456789BR', 'PAC'));
  manifest.volumes[0].trackingCodes.push('CC123456789BR');
  manifest.volumes[0].quantity = 2;
  const blocked = validateOfflineManifest(manifest);
  assert.equal(blocked.valid, false);
  assert.ok(blocked.problems.includes('GERACAO_PARCIAL_NAO_PERMITIDA:PAC'));
});
