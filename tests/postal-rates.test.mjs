import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../apps-script/PostalRates.gs',import.meta.url),'utf8');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);

test('preço aceita vírgula e ponto decimal sem multiplicar centavos',()=>{
  assert.equal(sandbox.postalRateMoney_('21,11'),21.11);
  assert.equal(sandbox.postalRateMoney_('21.11'),21.11);
  assert.equal(sandbox.postalRateMoney_('1.234,56'),1234.56);
  assert.equal(sandbox.postalRateMoney_('1,234.56'),1234.56);
});

test('normaliza uma faixa de tabela à vista',()=>{
  const result=sandbox.normalizePostalRateRow_({SERVICO:'PAC',CEP_INICIAL:'60000-000',CEP_FINAL:'60999-999',PESO_INICIAL_G:'1',PESO_FINAL_G:'500',PRECO:'18,40',PRAZO_DIAS:'5',REGIAO:'Fortaleza'});
  assert.deepEqual(Array.from(result.issues),[]);
  assert.equal(result.row.zipStart,'60000000');
  assert.equal(result.row.zipEnd,'60999999');
  assert.equal(result.row.price,18.4);
  assert.equal(result.row.deadlineDays,5);
});

test('seleciona a faixa mais específica quando existem faixas sobrepostas',()=>{
  const rows=[
    {SERVICE:'PAC',ZIP_START:'60000000',ZIP_END:'69999999',WEIGHT_FROM_G:1,WEIGHT_TO_G:1000,PRICE:30,DEADLINE_DAYS:10},
    {SERVICE:'PAC',ZIP_START:'60000000',ZIP_END:'60999999',WEIGHT_FROM_G:1,WEIGHT_TO_G:500,PRICE:20,DEADLINE_DAYS:5},
  ];
  const match=sandbox.findPostalRateMatch_(rows,'PAC','60123456',300);
  assert.equal(match.PRICE,20);
  assert.equal(match.DEADLINE_DAYS,5);
});

test('cotação calcula total pela quantidade e mantém prazo da faixa',()=>{
  const rows=[{SERVICE:'SEDEX',ZIP_START:'60000000',ZIP_END:'60999999',WEIGHT_FROM_G:1,WEIGHT_TO_G:500,PRICE:29.7,DEADLINE_DAYS:2,REGION:'Fortaleza'}];
  const quote=sandbox.quotePostalRateService_(rows,'SEDEX','60123456',300,100);
  assert.equal(quote.available,true);
  assert.equal(quote.unitPrice,29.7);
  assert.equal(quote.totalPrice,2970);
  assert.equal(quote.deadlineDays,2);
});