import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const portal=fs.readFileSync(new URL('../apps-script/PortalReturns.gs',import.meta.url),'utf8');
const documentsUi=fs.readFileSync(new URL('../src/elections-production-documents-ui.js',import.meta.url),'utf8');

test('retorno do Portal não antecipa etiqueta gerada nem DC-e preparada',()=>{
  assert.doesNotMatch(portal,/type:\s*'LABEL_GENERATED'/);
  assert.doesNotMatch(portal,/production-dce-prepared:/);
});

test('baixa LABEL_GENERATED acontece depois da geração do PDF final do volume',()=>{
  const generatedPdf=documentsUi.indexOf('generateProductionVolumePdf');
  const eventMatch=/type:\s*'LABEL_GENERATED'/.exec(documentsUi);
  const event=eventMatch?.index??-1;
  assert.ok(generatedPdf>=0);
  assert.ok(event>generatedPdf);
  assert.match(documentsUi,/idempotencyKey:\s*`label-generated-volume:/);
  assert.match(documentsUi,/sourceType:\s*'DELIVERY_VOLUME'/);
});

test('etiqueta teste não registra LABEL_GENERATED',()=>{
  const start=documentsUi.indexOf('async function generateTest');
  const end=documentsUi.indexOf('async function generateVolume');
  const testBlock=documentsUi.slice(start,end);
  assert.doesNotMatch(testBlock,/LABEL_GENERATED/);
});
