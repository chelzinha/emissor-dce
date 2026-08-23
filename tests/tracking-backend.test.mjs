import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tracking=fs.readFileSync(new URL('../apps-script/Tracking.gs',import.meta.url),'utf8');
const config=fs.readFileSync(new URL('../apps-script/Config.gs',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../apps-script/Api.gs',import.meta.url),'utf8');

test('schema guarda histórico de rastreamento por SRO',()=>{
  assert.match(config,/TRACKING_EVENTS:/);
  assert.match(config,/SOURCE_KEY/);
  assert.match(config,/MAX_TRACKING_CHUNK: 200/);
});

test('importação exige objeto já confirmado como postado e deduplica source key',()=>{
  assert.match(tracking,/OBJETO_NAO_CONFIRMADO_COMO_POSTADO/);
  assert.match(tracking,/existingKeys\[uniqueKey\]/);
  assert.match(tracking,/TRACKING_DELIVERED/);
  assert.match(tracking,/tracking-delivered:/);
});

test('dispatcher expõe append, resumo e eventos',()=>{
  assert.match(api,/tracking\.updates\.append/);
  assert.match(api,/tracking\.summary/);
  assert.match(api,/tracking\.events\.list/);
});
