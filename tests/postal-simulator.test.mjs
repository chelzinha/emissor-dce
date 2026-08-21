import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuoteRequest, quoteFromTariffRows, selectTariffRow } from '../src/postal-simulator.js';

const request = { campaignId:'c1', originCep:'60000-000', destinationCep:'62010-120', service:'PAC', weightGrams:750, heightCm:2, widthCm:20, lengthCm:30 };

test('nao inventa preco quando nao ha tabela', () => {
  const quote = quoteFromTariffRows([], request, {});
  assert.equal(quote.configured, false);
  assert.equal(quote.matched, false);
  assert.equal(quote.reason, 'TABELA_NAO_CONFIGURADA');
});

test('seleciona a faixa mais especifica', () => {
  const rows = [
    { service:'PAC', destinationCepStart:'60000000', destinationCepEnd:'69999999', weightMinGrams:0, weightMaxGrams:1000, priceCents:2500, deadlineBusinessDays:5 },
    { service:'PAC', destinationCepStart:'62000000', destinationCepEnd:'62099999', weightMinGrams:501, weightMaxGrams:1000, priceCents:2100, deadlineBusinessDays:3 },
  ];
  const selected = selectTariffRow(rows, request);
  assert.equal(selected.row.priceCents, 2100);
  const quote = quoteFromTariffRows(rows, request, { name:'Tabela oficial teste' });
  assert.equal(quote.matched, true);
  assert.equal(quote.priceCents, 2100);
  assert.equal(quote.deadlineBusinessDays, 3);
});

test('servico diferente nao cruza tabela', () => {
  const rows = [{ service:'SEDEX', destinationCepStart:'60000000', destinationCepEnd:'69999999', weightMinGrams:0, weightMaxGrams:1000, priceCents:5000, deadlineBusinessDays:1 }];
  const quote = quoteFromTariffRows(rows, request, { name:'X' });
  assert.equal(quote.matched, false);
  assert.equal(quote.reason, 'FAIXA_NAO_ENCONTRADA');
});

test('valida cep e peso antes da consulta', () => {
  assert.throws(() => normalizeQuoteRequest({ ...request, destinationCep:'123' }), /8 dígitos/);
  assert.throws(() => normalizeQuoteRequest({ ...request, weightGrams:0 }), /Peso inválido/);
});
