import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const stages = fs.readFileSync(new URL('../src/elections-stage-shell-ui.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/elections-operation-settings-ui.js', import.meta.url), 'utf8');
const delivery = fs.readFileSync(new URL('../src/elections-internal-delivery-ui.js', import.meta.url), 'utf8');
const generator = fs.readFileSync(new URL('../src/internal-delivery-generator.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('menu expõe exatamente as etapas 1 a 8 e mantém Operações dentro de Configurações', () => {
  assert.match(stages, /\[1,'Preparação','bases'/);
  assert.match(stages, /\[8,'Entrega à operação','production'/);
  assert.match(stages, /FLUXO DA OPERAÇÃO/);
  assert.match(stages, /CONFIGURAÇÕES/);
  assert.match(stages, /data-operation-view="campaigns">Operações/);
  assert.doesNotMatch(stages, /\[9,/);
});

test('timeline usa as mesmas oito etapas do menu', () => {
  assert.match(stages, /PASSO A PASSO DA OPERAÇÃO/);
  assert.match(stages, /STAGES\.map/);
  assert.match(stages, /As mesmas oito etapas do menu/);
});

test('chips técnicos são apresentados em português sem perder o código interno', () => {
  assert.match(stages, /READY_FOR_UNIFIED_LABEL:'Pronto para produção'/);
  assert.match(stages, /IN_PRODUCTION:'Em produção'/);
  assert.match(stages, /dataset\.statusCode/);
});

test('Operações concentra endereço, remetente e usuário final com edição', () => {
  assert.match(settings, /Endereço da operação/);
  assert.match(settings, /Dados do remetente/);
  assert.match(settings, /Usuário final/);
  assert.match(settings, /campaign\.upsert/);
  assert.match(settings, /\/api\/portal\/users/);
});

test('entrega interna exige seleção de lotes e data antes da numeração', () => {
  assert.match(delivery, /data-delivery-batch/);
  assert.match(delivery, /internal-delivery-date/);
  assert.match(delivery, /Vincular lotes e numerar volumes/);
  assert.match(delivery, /sequence: index \+ 1/);
  assert.match(delivery, /status: 'PLANNED'/);
  assert.match(delivery, /production\.handoff\.confirm/);
});

test('etiquetas de volume só são geradas a partir do plano de entrega vinculado', () => {
  assert.match(generator, /Vincule os lotes e a data da entrega antes de gerar as etiquetas de volume/);
  assert.match(generator, /VOLUME \$\{volume\.sequence\}\/\$\{total\}/);
  assert.match(generator, /USO INTERNO - NÃO SUBSTITUI O PROTOCOLO DE POSTAGEM/);
  assert.match(generator, /CONTROLE INTERNO DE ENTREGA DE VOLUMES/);
});

test('HTML carrega os novos módulos e não duplica o cadastro antigo de usuário', () => {
  assert.match(html, /elections-operation-settings-ui\.js/);
  assert.match(html, /elections-internal-delivery-ui\.js/);
  assert.doesNotMatch(html, /elections-user-admin-ui\.js/);
});

test('Acompanhamento e Relatorios ficam visiveis na secao PÓS-POSTAGEM', () => {
  // Antes eles eram injetados como filhos diretos de .app-nav e o proprio
  // shell os marcava como source-nav-button, que o CSS esconde. Ficavam
  // inalcancaveis pelo menu.
  assert.match(stages, /POST_VIEWS=\['tracking','reports'\]/);
  assert.match(stages, /PÓS-POSTAGEM/);
  assert.match(stages, /data-operation-post/);
  assert.match(stages, /function relocatePostViews/);
  // os botoes sao MOVIDOS, nunca recriados, para preservar os listeners
  assert.match(stages, /host\.appendChild\(button\)/);
  assert.match(stages, /if\(!POST_VIEWS\.includes\(b\.dataset\.view\)\)b\.classList\.add\('source-nav-button'\)/);
});

test('componente antigo de 11 etapas foi removido do projeto', () => {
  assert.doesNotMatch(html, /elections-approved-ui/);
  assert.equal(fs.existsSync(new URL('../src/elections-approved-ui.js', import.meta.url)), false);
});
