import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('backend financeiro possui schemas, ações e eventos operacionais', async () => {
  const [config, api, operations, finance] = await Promise.all([
    read('../apps-script/Config.gs'),
    read('../apps-script/Api.gs'),
    read('../apps-script/Operations.gs'),
    read('../apps-script/Finance.gs'),
  ]);
  for (const sheet of ['FINANCE_IMPORTS', 'FINANCE_POSTINGS', 'FINANCE_PAYMENTS', 'FINANCE_ALLOCATIONS']) {
    assert.match(config, new RegExp(`${sheet}:`));
  }
  for (const action of ['finance.import.start', 'finance.import.append', 'finance.import.finish', 'finance.summary', 'finance.payment.record']) {
    assert.match(api, new RegExp(action.replaceAll('.', '\\.')));
  }
  assert.match(operations, /FINANCE_POSTINGS_IMPORTED/);
  assert.match(operations, /FINANCE_PAYMENT_RECEIVED/);
  assert.match(finance, /SRO_JA_IMPORTADO_COM_DADOS_DIFERENTES/);
});

test('painel carrega Financeiro e Relatórios inclui valores', async () => {
  const [html, financeUi, reportsUi] = await Promise.all([
    read('../eleicoes.html'),
    read('../src/elections-finance-ui.js'),
    read('../src/elections-reports-ui.js'),
  ]);
  assert.match(html, /elections-finance-ui\.js/);
  assert.match(financeUi, /Postagens, pagamentos e saldo/);
  assert.match(financeUi, /finance\.payment\.record/);
  assert.match(reportsUi, /finance\.summary/);
  assert.match(reportsUi, /Fechamento operacional e financeiro/);
});
