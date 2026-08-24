import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const baseFlow = fs.readFileSync(new URL('../src/elections-base-flow-v2.js', import.meta.url), 'utf8');
const csvFormat = fs.readFileSync(new URL('../src/elections-csv-format-ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('entrada da base fica restrita aos dados de endereco', () => {
  assert.match(baseFlow, /base-service/);
  assert.match(baseFlow, /base-content/);
  assert.match(baseFlow, /field\.hidden = true/);
  assert.match(baseFlow, /Definir dados da postagem/);
  assert.match(baseFlow, /portal-export-service/);
  assert.match(baseFlow, /portal-export-content/);
  assert.match(baseFlow, /portal\.export/);
  assert.match(baseFlow, /service, content/);
});

test('todos os imports CSV exibem as colunas esperadas', () => {
  assert.match(csvFormat, /Receber nova base/);
  assert.match(csvFormat, /CSV colunas: NOME; CEP; ENDEREÇO; NUMERO; COMPLEMENTO; BAIRRO; CIDADE; UF/);
  assert.match(csvFormat, /Tabela à vista PAC e SEDEX/);
  assert.match(csvFormat, /SERVICO; CEP_INICIAL; CEP_FINAL; PESO_INICIAL_G; PESO_FINAL_G; PRECO; PRAZO_DIAS; REGIAO/);
  assert.match(csvFormat, /Atualizar rastreamento/);
  assert.match(csvFormat, /SRO; STATUS; DESCRICAO; DATA_EVENTO; HORA; LOCAL/);
  assert.match(csvFormat, /Importar retorno do Portal Postal/);
  assert.match(csvFormat, /OBJETO; SERVICO; DESTINATARIO; CPF_CNPJ; ENDERECO; NUM; COMPLEMENTO; BAIRRO; CIDADE; UF; CEP; CONTEUDO; CODIGO_PP/);
  assert.match(html, /elections-base-flow-v2\.js/);
  assert.match(html, /elections-csv-format-ui\.js/);
});
