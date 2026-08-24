import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/elections-session-resume.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('refresh interno preserva operacao e etapa atual', () => {
  assert.match(source, /beforeunload/);
  assert.match(source, /campaignId/);
  assert.match(source, /data-view/);
  assert.match(source, /dispatchEvent\(new Event\('change'/);
  assert.match(source, /button\.click\(\)/);
  assert.match(source, /MAX_AGE_MS/);
  assert.match(html, /elections-session-resume\.js/);
});

test('logout limpa o contexto salvo', () => {
  assert.match(source, /#signout/);
  assert.match(source, /clearResume\(\)/);
});
