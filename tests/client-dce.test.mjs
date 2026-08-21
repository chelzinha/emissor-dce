import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationProgress, buildAuthorizeBody, chunkDocuments, clearCertificateState, normalizeAuthorizationResults, pendingDocuments } from '../src/client-dce.js';

test('quebra autorizacao em blocos de cinco', () => {
  const docs = Array.from({length:12}, (_,i)=>({reference:String(i+1)}));
  assert.deepEqual(chunkDocuments(docs).map((chunk)=>chunk.length), [5,5,2]);
});

test('nao reenvia documentos ja autorizados', () => {
  const pending = pendingDocuments({ documents:[{status:'AUTHORIZED'},{status:'REJECTED'},{status:'PREPARED'}] });
  assert.equal(pending.length, 2);
});

test('exige confirmacao explicita em producao', () => {
  assert.throws(() => buildAuthorizeBody({ documents:[{}], certificateBase64:'abc', passphrase:'123', environment:'1', confirmProduction:false }), /Confirme explicitamente/);
  assert.equal(buildAuthorizeBody({ documents:[{}], certificateBase64:'abc', passphrase:'123', environment:'2' }).confirmProduction, false);
});

test('normaliza resultados mas preserva XML autorizado', () => {
  const [result] = normalizeAuthorizationResults([{ reference:'i1', trackingCode:'oy 855 182 534 br', status:'AUTHORIZED', accessKey:'1.2.3', protocolNumber:'99', signedXml:'<a/>', processedXml:'<b/>' }]);
  assert.equal(result.trackingCode, 'OY855182534BR');
  assert.equal(result.accessKey, '123');
  assert.equal(result.processedXml, '<b/>');
});

test('limpa certificado e senha do estado temporario', () => {
  const state={certificateBase64:'secret',certificateName:'a.pfx',passphrase:'123',certificateInfo:{x:1}};
  clearCertificateState(state);
  assert.deepEqual(state,{certificateBase64:'',certificateName:'',passphrase:'',certificateInfo:null});
});

test('progresso usa autorizadas e rejeitadas', () => {
  assert.deepEqual(authorizationProgress({total:10,authorized:6,rejected:2}),{total:10,done:8,percent:80});
});
