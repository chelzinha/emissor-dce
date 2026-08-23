# Checkpoint 015 — AGF Operações Postais

Branch de homologação para o novo front operacional.

Release atual prioriza a Declaração Simplificada online, com backend isolado do Apps Script fiscal da DC-e.

## Backend isolado
- Front de Operações Postais: `/api/operations-data`
- Variáveis dedicadas: `OPERATIONS_APPS_SCRIPT_URL` e `OPERATIONS_APPS_SCRIPT_TOKEN`
- Backend DC-e existente continua usando `APPS_SCRIPT_URL` e `APPS_SCRIPT_TOKEN`

## Fluxo da release simplificada
Cadastros → Higienização → CSV Portal Postal → PDF + CSV de retorno → auditoria Data Matrix → Declaração Simplificada → etiqueta teste → PDFs 10×15 por volume.

A DC-e permanece fora do fluxo operacional desta primeira release e será retomada após validação física das etiquetas simplificadas.
