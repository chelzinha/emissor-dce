# Checkpoint 015 - Portal do Cliente + ponte DC-e

- Base: commit isolado 110ae88519ee8c8e7cea100bec17c1ce04f4c762.
- Nenhuma branch foi movida.
- Login: logo, Acessar Portal, Usuário e Senha.
- 3 áreas: Dashboard, Simulador, Autorizar DC-e.
- O simulador não inventa tarifa; aguarda tabela configurada.
- Lote operacional passa por pre-flight antes de virar lote fiscal.
- Pre-flight valida destinatário, endereço, CEP, UF, IBGE, conteúdo e valor declarado.
- Numeração continua reservada pelo fluxo fiscal existente.
- A1 permanece somente em memória no navegador.
- Autorização usa os endpoints existentes em blocos de até 5.
- Chave/protocolo retornam para POSTAL_OBJECTS.
- 100% autorizado => READY_FOR_UNIFIED_LABEL.
- Capacidade física continua 250 etiquetas por volume.
