# Migração histórica da campanha

Fluxo temporário e protegido para reconstruir a campanha `d0a9470d-79dd-425f-9bd3-c6230c4693e5`.

## Ordem obrigatória

1. `reset`
2. `campaign`
3. `addresses`
4. `production`
5. `tracking`
6. `events`
7. `finance`
8. `finalize`

A função exige `HISTORICAL_IMPORT_TOKEN` e usa um arquivo ZIP privado no Google Drive, acessado somente pelo Apps Script autorizado.

## Totais validados

- Endereços: 9.999
- Exportações Portal: 16
- Retornos Portal: 16
- Objetos postais: 5.368
- Lotes: 16
- Volumes: 28
- Eventos de rastreamento: 2.353
- Eventos operacionais: 134
- Resumos diários: 7
- Lançamentos financeiros parciais: 1.062

## Limpeza pós-migração

Após a validação, remover a função temporária, os handlers `historical.*`, a variável `HISTORICAL_IMPORT_TOKEN` e o arquivo temporário do Drive. Manter a correção do `Setup.gs`.
