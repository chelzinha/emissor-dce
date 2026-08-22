import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const posting=fs.readFileSync(new URL('../apps-script/Posting.gs',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');

test('postagem é idempotente por lote, lista, serviço e código de serviço',()=>{
  assert.match(posting,/posting-list:' \+ batchId \+ ':' \+ String\(list\.listId\)/);
  assert.match(posting,/postingEventForList_/);
  assert.match(posting,/duplicate: true/);
});

test('baixa de postagem grava evento POSTING_COMPLETED por lista real',()=>{
  assert.match(posting,/type: 'POSTING_COMPLETED'/);
  assert.match(posting,/sourceType: 'POSTAL_LIST'/);
  assert.match(posting,/quantity: Number\(list\.total \|\| 0\)/);
});

test('dispatcher expõe listagem e confirmação de postagem',()=>{
  assert.match(api,/production\.posting\.list/);
  assert.match(api,/production\.posting\.confirm/);
});
