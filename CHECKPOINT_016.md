# CHECKPOINT 016 - Fluxo documental integrado

## Objetivo

Integrar a geração e autorização da DC-e ao fluxo operacional já usado para Declaração Simplificada.

## Fluxo aprovado

1. Importar e auditar o retorno do Portal Postal.
2. Escolher uma única modalidade para o retorno:
   - Declaração Simplificada;
   - DC-e com e-CNPJ.
3. Na Declaração Simplificada, liberar diretamente a produção.
4. Na DC-e:
   - criar o lote operacional;
   - executar a validação fiscal pela agência;
   - liberar o lote ao Portal do Cliente;
   - autorizar com e-CNPJ A1 do usuário final;
   - devolver o lote autorizado à produção.
5. Convergir os dois caminhos em:
   - Impressão;
   - Entrega à operação;
   - Acompanhamento;
   - Relatórios.

## Acessos

- Agência: `https://agf-dce-facil.netlify.app/eleicoes.html`
- Usuário final: `https://agf-dce-facil.netlify.app/portal`

O usuário e a senha do acesso final são criados pela agência em Configurações > Operações > Usuário final.

## Alterações principais

- substituição da ocultação temporária da DC-e por uma escolha explícita de modalidade;
- carregamento do módulo de validação DC-e no painel da agência;
- reativação da área Autorizar DC-e no Portal do Cliente;
- link direto do lote preparado para o Portal do Cliente;
- continuidade do lote autorizado no mesmo fluxo de impressão e entrega;
- atualização dos testes de contrato da interface e da documentação.

## Regra de segurança

O certificado A1 e a senha permanecem apenas na memória da sessão do usuário final. A autorização fiscal real continua exigindo homologação com certificado válido antes de qualquer uso em produção.
