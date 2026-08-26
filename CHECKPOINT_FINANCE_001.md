# CHECKPOINT FINANCE 001 - Consolidador, baixas e relatório integrado

## Branch isolada

Desenvolvimento exclusivo em:

```text
feature/acompanhamento-relatorios-financeiro
```

A branch foi criada a partir do commit `ae180f642aa99584fef412f8c6cdfb1d31b1a3bf` e, antes deste checkpoint, foi sincronizada por fast-forward com o estado mais recente da `main`, commit `f0c8b4fbf6179ac3cf54992982670ec536d2d29f`.

A sincronização ocorreu somente da `main` para a branch. A `main` não foi alterada por este desenvolvimento.

## Objetivo deste bloco

Criar a primeira entrega funcional do módulo Financeiro sem reconstruir os módulos de Acompanhamento e Relatórios que já existiam.

O bloco permite:

- importar o CSV do Consolidador;
- identificar cada postagem pelo SRO;
- separar PAC e SEDEX;
- consolidar quantidade e valor por data, serviço e lista/OS;
- impedir duplicação ao reimportar o mesmo arquivo ou o mesmo SRO;
- bloquear conflito quando um SRO reaparece com dados financeiros diferentes;
- registrar pagamentos integrais ou parciais;
- aplicar pagamentos às postagens mais antigas ou a um grupo escolhido;
- manter crédito para postagens futuras;
- exibir valor postado, recebido, saldo e crédito;
- incluir o financeiro no relatório por período e no CSV final.

## Estrutura de dados adicionada

### `FINANCE_IMPORTS`

Uma linha por arquivo importado, com hash, totais e resultado da importação.

### `FINANCE_POSTINGS`

Uma linha por SRO com data, serviço, lista/OS, código Portal Postal, quantidade e valor original.

### `FINANCE_PAYMENTS`

Uma linha por pagamento recebido do cliente.

### `FINANCE_ALLOCATIONS`

Relaciona pagamentos aos grupos de cobrança. O valor original da postagem não é alterado.

## Chaves e idempotência

- Arquivo: `CAMPAIGN_ID + FILE_HASH`
- Postagem financeira: `CAMPAIGN_ID + TRACKING_CODE`
- Grupo de cobrança: `POSTING_DATE + SERVICE + LIST_ID`
- Evento operacional de importação: `finance-import:IMPORT_ID`
- Requisição de pagamento: `CAMPAIGN_ID + IDEMPOTENCY_KEY`
- Evento operacional de pagamento: `finance-payment:PAYMENT_ID`

## Formatos reconhecidos no CSV

O importador procura o cabeçalho nas primeiras 30 linhas e aceita aliases para:

- `SRO`, `OBJETO`, `CODIGO_RASTREIO`;
- `SERVICO` ou `ECT`;
- `DATA` ou `DATA_POSTAGEM`;
- `VALOR`;
- `QTD`;
- `LISTA`, `LISTA_POSTAGEM` ou `OS`;
- `CODIGO_PP`.

As linhas de totalização sem SRO são ignoradas.

## Endpoints adicionados

```text
finance.import.start
finance.import.append
finance.import.finish
finance.imports.list
finance.summary
finance.charges.list
finance.payment.record
finance.payments.list
```

As escritas exigem perfil `AGENCY_ADMIN`.

## Interface

Novo item principal no painel da agência:

```text
Financeiro
```

A tela contém:

- indicadores gerais;
- PAC e SEDEX;
- tabela diária;
- importação do Consolidador;
- registro de pagamento;
- contas agrupadas;
- histórico de pagamentos;
- histórico de importações.

A aba Relatórios passa a incluir:

- valor postado no período;
- valor pago/alocado;
- saldo;
- crédito geral;
- tabela financeira diária;
- seção financeira no CSV exportado.


## Portal do cliente

O endereço principal `/portal` volta a carregar a experiência autenticada com exatamente três áreas:

```text
Dashboard
Simulador
Autorizar DC-e
```

O resumo financeiro foi incluído dentro do Dashboard, sem criar uma quarta área principal. Ele mostra valor postado, valor pago, saldo, crédito e os últimos dias de postagem.

A validação demonstrativa isolada do e-CNPJ permanece disponível em `portal-certificado.html`.

## Migração do Apps Script

Depois que este checkpoint for aprovado para implantação, executar:

```text
setupProject()
```

Essa execução cria as quatro novas abas e preserva os dados das abas já existentes por remapeamento de cabeçalhos.

Depois disso, publicar uma nova versão do Web App do Apps Script.

## QA

Validações executadas antes do commit:

- sintaxe dos arquivos JavaScript novos e alterados;
- sintaxe dos arquivos Apps Script convertidos temporariamente para `.js`;
- testes locais do contrato financeiro e do relatório financeiro;
- teste do importador preparado para execução pela suíte completa após `npm ci`.

O build Vite e a suíte integral devem ser confirmados pelo CI da branch. Nenhum deploy manual deve ser disparado em paralelo.

## Próximos blocos

1. Documentos e consolidados de tickets no Drive com autorização por campanha.
2. Resumo financeiro simplificado no Dashboard do cliente, sem criar uma quarta área principal.
3. Fonte de rastreamento automatizada por integração permitida ou importação periódica do Portal Postal.
4. Relatórios por município, região, lista e situação postal.
