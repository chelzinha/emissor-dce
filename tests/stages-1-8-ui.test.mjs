import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const stages = fs.readFileSync(new URL('../src/elections-stage-shell-ui.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../src/elections-operation-settings-ui.js', import.meta.url), 'utf8');
const delivery = fs.readFileSync(new URL('../src/elections-internal-delivery-ui.js', import.meta.url), 'utf8');
const generator = fs.readFileSync(new URL('../src/internal-delivery-generator.js', import.meta.url), 'utf8');
const localization = fs.readFileSync(new URL('../src/elections-localization-ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('menu expõe o fluxo completo em 11 etapas e mantém Operações em Configurações', () => {
  assert.match(stages, /\[1, 'Preparação', 'bases'/);
  assert.match(stages, /\[6, 'Escolher documento', 'returns'/);
  assert.match(stages, /\[9, 'Entrega à operação', 'production'/);
  assert.match(stages, /\[10, 'Acompanhamento', 'tracking'/);
  assert.match(stages, /\[11, 'Relatórios', 'reports'/);
  assert.match(stages, /FLUXO COMPLETO DA OPERAÇÃO/);
  assert.match(stages, /CONFIGURAÇÕES/);
  assert.match(stages, /data-operation-view="campaigns">Operações/);
});

test('timeline usa as mesmas onze etapas do menu', () => {
  assert.match(stages, /PASSO A PASSO DA OPERAÇÃO/);
  assert.match(stages, /STAGES\.map/);
  assert.match(stages, /Fluxo completo, da preparação da base aos relatórios finais/);
});

test('etapas 3, 4, 5 e 6 têm conteúdo e títulos distintos', () => {
  assert.match(stages, /Etapa 3 - Retorno do Portal/);
  assert.match(stages, /Etapa 4 - Configurar etiqueta/);
  assert.match(stages, /Etapa 5 - Auditar Data Matrix/);
  assert.match(stages, /Etapa 6 - Escolher documento/);
  assert.match(stages, /applyReturnsStage/);
  assert.match(stages, /return-upload-grid/);
  assert.match(stages, /return-label-setup/);
  assert.match(stages, /return-link-row/);
});

test('navegação entre etapas da mesma tela preserva os inputs de arquivo', () => {
  assert.match(stages, /if \(currentView === stage\[2\]\) \{[\s\S]*?decorate\(\);[\s\S]*?focusStage\(stage\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(stages, /\}\s*sourceButton\(stage\[2\]\)\?\.click\(\);/);
});

test('chips e eventos técnicos são apresentados em português', () => {
  assert.match(stages, /READY_FOR_UNIFIED_LABEL: 'Pronto para produção'/);
  assert.match(stages, /IN_PRODUCTION: 'Em produção'/);
  assert.match(localization, /LABEL_GENERATED: 'Etiquetas geradas'/);
  assert.match(localization, /LABEL_PRINTED: 'Etiquetas impressas'/);
  assert.match(localization, /MATRIX_100_VERIFIED: 'Data Matrix 100% verificado'/);
  assert.match(localization, /ADDRESS_CLEANING_COMPLETED: 'Higienização de endereços concluída'/);
  assert.match(localization, /PORTAL_RETURN_IMPORTED: 'Retorno do Portal importado'/);
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

test('HTML carrega fluxo completo, localização e não duplica cadastro antigo', () => {
  assert.match(html, /elections-operation-settings-ui\.js/);
  assert.match(html, /elections-internal-delivery-ui\.js/);
  assert.match(html, /elections-localization-ui\.js/);
  assert.doesNotMatch(html, /elections-user-admin-ui\.js/);
});

test('Acompanhamento e Relatórios fazem parte do fluxo principal e da timeline', () => {
  assert.match(stages, /\[10, 'Acompanhamento', 'tracking'/);
  assert.match(stages, /\[11, 'Relatórios', 'reports'/);
  assert.match(stages, /if \(view === 'tracking'\)/);
  assert.match(stages, /if \(view === 'reports'\)/);
  assert.doesNotMatch(stages, /PÓS-POSTAGEM/);
});

test('componente antigo separado permanece removido do projeto', () => {
  assert.doesNotMatch(html, /elections-approved-ui/);
  assert.equal(fs.existsSync(new URL('../src/elections-approved-ui.js', import.meta.url)), false);
});
