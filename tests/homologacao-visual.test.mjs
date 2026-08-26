import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('painel de homologação exibe os três módulos novos sem backend',()=>{
  const html=read('homologacao.html');
  const js=read('src/homologacao-demo.js');
  assert.match(html,/homologacao-demo\.js/);
  assert.match(js,/Acompanhamento/);
  assert.match(js,/Relatórios/);
  assert.match(js,/Financeiro/);
  assert.match(js,/Importar Consolidador/);
  assert.match(js,/Registrar pagamento/);
  assert.match(js,/Dados fictícios para avaliação visual/);
});

test('portal demonstrativo mantém exatamente três áreas principais',()=>{
  const html=read('portal-homologacao.html');
  const js=read('src/portal-homologacao-demo.js');
  assert.match(html,/portal-homologacao-demo\.js/);
  assert.match(js,/\['dashboard','Dashboard'\]/);
  assert.match(js,/\['simulador','Simulador'\]/);
  assert.match(js,/\['autorizacao','Autorizar DC-e'\]/);
  assert.match(js,/Valor postado/);
  assert.match(js,/Saldo em aberto/);
});

test('vite inclui as duas páginas isoladas no build',()=>{
  const vite=read('vite.config.js');
  assert.match(vite,/homologacao:resolve\(rootDir,"homologacao\.html"\)/);
  assert.match(vite,/portalHomologacao:resolve\(rootDir,"portal-homologacao\.html"\)/);
});
