import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const baseFlow = fs.readFileSync(new URL('../src/elections-base-flow-v2.js', import.meta.url), 'utf8');
const baseFlowCss = fs.readFileSync(new URL('../src/elections-base-flow-v2.css', import.meta.url), 'utf8');
const approved = fs.readFileSync(new URL('../src/elections-stage-shell-ui.js', import.meta.url), 'utf8');
const documentMode = fs.readFileSync(new URL('../src/elections-document-mode-ui.js', import.meta.url), 'utf8');
const dceUi = fs.readFileSync(new URL('../src/elections-production-dce-ui.js', import.meta.url), 'utf8');
const portalReturn = fs.readFileSync(new URL('../src/portal-return-service.js', import.meta.url), 'utf8');
const tracking = fs.readFileSync(new URL('../src/elections-tracking-ui.js', import.meta.url), 'utf8');
const rates = fs.readFileSync(new URL('../src/elections-rate-table-ui.js', import.meta.url), 'utf8');

test('base completa é importada em uma única ação com divisão apenas interna', () => {
  assert.match(baseFlow, /Importar base completa/);
  assert.match(baseFlow, /rows\.slice\(index, end\)/);
  assert.match(baseFlow, /chunkSize|const size/);
  assert.doesNotMatch(baseFlow, /Processe no maximo 200 registros por baixa/);
});

test('higienização percorre todos os registros RAW em blocos internos sem pedir novos arquivos', () => {
  assert.match(baseFlow, /async function cleanFull/);
  assert.match(baseFlow, /status: 'RAW'/);
  assert.match(baseFlow, /rowIds: ids/);
  assert.match(baseFlow, /while \(true\)/);
  assert.match(baseFlow, /Higienizar base/);
  assert.doesNotMatch(approved, /Higienizar próximo bloco/);
});

test('proxy divide cada bloco de higienização em requisições menores que o limite técnico', () => {
  assert.match(api, /CLEANING_REQUEST_CHUNK = 25/);
  assert.match(api, /action === "cleaning\.process"/);
  assert.match(api, /rowIds\.slice\(index, index \+ CLEANING_REQUEST_CHUNK\)/);
  assert.match(api, /summary\.processed \+=/);
});

test('higienização mostra progresso vivo no mesmo box da base', () => {
  assert.match(api, /onProgress/);
  assert.match(baseFlow, /base-cleaning-progress/);
  assert.match(baseFlow, /data-progress-completed/);
  assert.match(baseFlow, /data-progress-remaining/);
  assert.match(baseFlow, /data-progress-elapsed/);
  assert.match(baseFlow, /data-progress-eta/);
  assert.match(baseFlow, /Última atualização/);
  assert.match(baseFlow, /setInterval\(\(\) => renderCleaning/);
  assert.match(baseFlowCss, /base-cleaning-spinner/);
  assert.match(baseFlowCss, /base-cleaning-bar/);
});

test('pendências de endereço têm revisão editável antes da postagem', () => {
  assert.match(baseFlow, /Revisar pendências/);
  assert.match(baseFlow, /addressRow\.update/);
  assert.match(baseFlow, /name="zip"/);
  assert.match(baseFlow, /name="street"/);
  assert.match(baseFlow, /name="city"/);
  assert.match(baseFlow, /service: '', content: ''/);
});

test('serviço e conteúdo entram somente depois da higienização', () => {
  assert.doesNotMatch(baseFlow, /SERVICO:\s*row\.SERVICO/);
  assert.doesNotMatch(baseFlow, /CONTEUDO:\s*row\.CONTEUDO/);
  assert.match(baseFlow, /Definir dados da postagem/);
  assert.match(baseFlow, /portal-export-service/);
  assert.match(baseFlow, /portal-export-content/);
});

test('outros CSVs grandes também usam divisão interna automática', () => {
  assert.match(portalReturn, /chunkRows\(backendRows/);
  assert.match(tracking, /chunkTrackingRows\(rows,200\)/);
  assert.match(rates, /parsed\.data\.slice\(i,i\+chunk\)/);
});

test('retorno do Portal exige escolha entre Declaração Simplificada e DC-e', () => {
  assert.match(documentMode, /Qual documento será usado neste lote/);
  assert.match(documentMode, /Gerar Declaração Simplificada/);
  assert.match(documentMode, /Preparar lote para DC-e/);
  assert.match(documentMode, /status === 'READY'/);
});

test('fluxo DC-e valida na agência e entrega a autorização ao portal do cliente', () => {
  assert.match(dceUi, /productionDce\.preflight/);
  assert.match(dceUi, /Validar e preparar lote DC-e/);
  assert.match(dceUi, /href="\/portal"/);
  assert.match(dceUi, /READY_FOR_UNIFIED_LABEL/);
});

test('passo a passo visível foi consolidado nas oito etapas operacionais atuais', () => {
  for (const label of ['Preparação', 'Portal Postal', 'Retorno do Portal', 'Configurar etiqueta', 'Auditar Data Matrix', 'Produção', 'Impressão', 'Entrega à operação']) {
    assert.match(approved, new RegExp(label));
  }
  assert.doesNotMatch(approved, /\[9,\s*'Postagem'/);
  assert.match(approved, /STATUS_LABELS/);
  assert.match(approved, /READY_FOR_UNIFIED_LABEL:'Pronto para produção'/);
});
