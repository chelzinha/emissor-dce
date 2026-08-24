import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/elections-csv-format-ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../eleicoes.html', import.meta.url), 'utf8');

test('mostra os formatos dos CSVs diretamente nos subtitulos', () => {
  assert.match(source, /CSV colunas: NOME; CEP; ENDEREÇO; NUMERO; COMPLEMENTO; BAIRRO; CIDADE; UF/);
  assert.match(source, /CSV colunas: OBJETO; SERVICO; DESTINATARIO; CPF_CNPJ; ENDERECO; NUM; COMPLEMENTO; BAIRRO; CIDADE; UF; CEP; CONTEUDO; CODIGO_PP/);
  assert.match(source, /CSV colunas: SRO; STATUS; DESCRICAO; DATA_EVENTO; HORA; LOCAL/);
  assert.match(source, /CSV colunas: SERVICO; CEP_INICIAL; CEP_FINAL; PESO_INICIAL_G; PESO_FINAL_G; PRECO; PRAZO_DIAS; REGIAO/);
  assert.match(html, /elections-csv-format-ui\.js/);
});
