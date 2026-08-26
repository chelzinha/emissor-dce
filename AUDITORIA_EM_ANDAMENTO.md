# Auditoria de fluxo em andamento

Esta auditoria percorre o fluxo operacional completo da agência, com prioridade para geração imediata de etiquetas e eliminação de regressões entre lotes ativos e históricos.

## Princípios

- lotes finalizados são somente histórico e não executam gates, recuperação, documentos ou preparação;
- somente lotes operacionais podem chamar `production.gates` e recuperação idempotente;
- a etiqueta 10 x 15 usa como fonte de verdade o motor v13 do aplicativo local;
- a escala de fontes é preservada entre 0,80 e 1,10;
- o fluxo deve permanecer na etapa escolhida durante geração e validação da etiqueta teste.
