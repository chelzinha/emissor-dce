import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFinanceCsv, financeDailyForPeriod, financePeriodTotals } from '../src/finance-report.js';

const summary = {
  credit: 100,
  daily: [
    { date: '2026-08-24', pacQuantity: 0, pacAmount: 0, sedexQuantity: 440, sedexAmount: 12144, totalQuantity: 440, totalAmount: 12144, paid: 5000, balance: 7144 },
    { date: '2026-08-25', pacQuantity: 622, pacAmount: 17120, sedexQuantity: 0, sedexAmount: 0, totalQuantity: 622, totalAmount: 17120, paid: 10000, balance: 7120 },
  ],
};

test('totais financeiros respeitam o período selecionado', () => {
  assert.equal(financeDailyForPeriod(summary, { from: '2026-08-25', to: '2026-08-25' }).length, 1);
  const totals = financePeriodTotals(summary, { from: '2026-08-24', to: '2026-08-25' });
  assert.equal(totals.objects, 1062);
  assert.equal(totals.amount, 29264);
  assert.equal(totals.paid, 15000);
  assert.equal(totals.balance, 14264);
});

test('CSV operacional recebe seção financeira sem duplicar BOM', () => {
  const csv = appendFinanceCsv('\uFEFFRELATÓRIO OPERACIONAL\r\nETAPA;TOTAL', summary, { from: '2026-08-24', to: '2026-08-25' });
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.equal(csv.slice(1).includes('\uFEFF'), false);
  assert.match(csv, /FINANCEIRO DO PERÍODO/);
  assert.match(csv, /Valor postado;29264/);
  assert.match(csv, /2026-08-25;622;17120/);
});
