# Checkpoint 014 - frontend real + portal do cliente

## Estado

Candidato local sobre o commit orfao `110ae88519ee8c8e7cea100bec17c1ce04f4c762`.
Nenhuma branch foi movida e nenhum deploy foi solicitado.

## Portal do cliente

- login simples: logo, Acessar Portal, Usuario e Senha;
- Usuario e um alias real: username explicito do Netlify Identity quando existir; como contingencia, usa a parte anterior ao @ do e-mail somente se for unica;
- o e-mail nao e solicitado nem exibido na tela de login;
- login ocorre em funcao serverless com `verifyRequestOrigin`, erro generico e sessao oficial do Netlify Identity;
- exatamente 3 areas: Dashboard, Simulador, Autorizar DC-e;
- Dashboard PAC / SEDEX / TOTAL, percentuais, timeline e filtro por periodo;
- Simulador nao inventa preco: fica bloqueado ate existir tabela configurada na operacao;
- Autorizar DC-e usa A1 apenas em memoria, valida CNPJ e reutiliza os endpoints fiscais existentes.

## Ponte Agencia -> Cliente -> Producao

- lote DCE nasce como `AWAITING_DCE_PREPARATION`;
- a agencia executa pre-flight fiscal antes de liberar;
- o evento `DCE_PREPARED` prematuro e ignorado enquanto o lote ainda aguarda preparo;
- o pre-flight exige CPF/CNPJ valido do destinatario, endereco, CEP, UF, codigo IBGE, conteudo, quantidade e valor >= R$ 0,01;
- apos pre-flight o lote passa a `DCE_PREPARED`;
- o cliente reserva a numeracao pelo fluxo fiscal existente;
- autorizacao ocorre em blocos de ate 5 requisicoes por chamada ao endpoint oficial;
- chave e protocolo retornam para `POSTAL_OBJECTS`;
- 100% autorizado move o lote para `READY_FOR_UNIFIED_LABEL`.

## Painel da agencia

- mantem o visual aprovado;
- PAC / SEDEX / TOTAL;
- passo a passo colorido;
- termo `lote`, sem `pacote`;
- filtro por data no Dashboard, Preparacao e Producao;
- nova etapa `Acompanhamento` depois da Producao;
- acompanhamento mostra baixas acumuladas, volumes e data operacional;
- botao da Producao segue para Acompanhamento;
- modal `Preparar lote DC-e` conectado ao pre-flight.

## QA local

- sintaxe de todos os JS/MJS do candidato: OK;
- sintaxe dos Apps Script tratados como JavaScript: OK;
- 5/5 testes novos do alias de usuario: OK;
- busca de terminologia: nenhum uso de `pacote` no candidato;
- build Vite completo ainda nao executado porque este runtime nao possui node_modules.
- login real por username nao pode ser exercitado localmente; Netlify Identity exige ambiente implantado.

## Gate antes de mover qualquer branch

1. Materializar todos os arquivos deste checkpoint em um unico commit orfao GitHub.
2. Comparar diff contra `110ae885...`.
3. Fazer revisao estatica final.
4. Mover uma unica branch de staging uma unica vez.
5. Aguardar GitHub Actions e Netlify terminarem sem disparar deploy paralelo.
6. Testar login por Usuario em Deploy Preview.
7. Testar pre-flight e autorizacao com A1 em homologacao antes de qualquer merge para main.
