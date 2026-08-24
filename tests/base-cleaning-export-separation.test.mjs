import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const addresses = fs.readFileSync(new URL('../apps-script/Addresses.gs', import.meta.url), 'utf8');
const baseFlow = fs.readFileSync(new URL('../src/elections-base-flow-v2.js', import.meta.url), 'utf8');
const guidance = fs.readFileSync(new URL('../src/elections-csv-guidance.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} deve existir`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`Corpo de ${name} não fechado`);
}

test('higienizacao valida endereco sem exigir servico ou conteudo', () => {
  const cleaning = functionBody(addresses, 'validateCleanAddress_');
  assert.doesNotMatch(cleaning, /INVALID_SERVICE/);
  assert.doesNotMatch(cleaning, /CONTEUDO/);

  const portal = functionBody(addresses, 'validatePortalExportRow_');
  assert.match(portal, /PAC/);
  assert.match(portal, /SEDEX/);
  assert.match(portal, /CONTEUDO/);
});

test('exportacao aplica servico e conteudo somente na etapa do Portal', () => {
  const exportBody = functionBody(addresses, 'exportPortalPostal_');
  assert.match(exportBody, /payload\.content/);
  assert.match(exportBody, /clean\.service = service/);
  assert.match(exportBody, /clean\.content = content/);
  assert.doesNotMatch(exportBody, /clean\.service \|\|/);
});

test('front esconde servico e conteudo na entrada e cria etapa posterior', () => {
  assert.match(baseFlow, /base-service/);
  assert.match(baseFlow, /field\.hidden = true/);
  assert.match(baseFlow, /Definir dados da postagem/);
  assert.match(baseFlow, /portal-export-service/);
  assert.match(baseFlow, /portal-export-content/);
  assert.match(baseFlow, /portal\.export/);
});

test('orientacao de colunas existe nos imports CSV atuais', () => {
  assert.match(guidance, /Receber nova base/);
  assert.match(guidance, /NOME; CEP; ENDEREÇO; NUMERO; COMPLEMENTO; BAIRRO; CIDADE; UF/);
  assert.match(guidance, /Tabela à vista PAC e SEDEX/);
  assert.match(guidance, /SERVICO; CEP_INICIAL; CEP_FINAL; PESO_INICIAL_G; PESO_FINAL_G; PRECO; PRAZO_DIAS; REGIAO/);
  assert.match(guidance, /Atualizar rastreamento/);
  assert.match(guidance, /SRO; STATUS; DATA_EVENTO; HORA; LOCAL/);
  assert.match(guidance, /Importar retorno do Portal Postal/);
  assert.match(guidance, /OBJETO\/SRO; SERVICO; DESTINATARIO/);
  assert.match(html, /elections-base-flow-v2\.js/);
  assert.match(html, /elections-csv-guidance\.js/);
});
