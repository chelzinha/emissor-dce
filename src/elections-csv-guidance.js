const ROOT = document.querySelector('#elections-app');

const GUIDANCE = new Map([
  ['Receber nova base', '<strong>CSV:</strong> NOME; CEP; ENDEREÇO; NUMERO; COMPLEMENTO; BAIRRO; CIDADE; UF. Colunas extras são preservadas.'],
  ['Tabela à vista PAC e SEDEX', '<strong>CSV:</strong> SERVICO; CEP_INICIAL; CEP_FINAL; PESO_INICIAL_G; PESO_FINAL_G; PRECO; PRAZO_DIAS; REGIAO.'],
  ['Atualizar rastreamento', '<strong>CSV:</strong> SRO; STATUS; DATA_EVENTO; HORA; LOCAL. DESCRICAO é opcional.'],
  ['Importar retorno do Portal Postal', '<strong>CSV do Portal Postal:</strong> OBJETO/SRO; SERVICO; DESTINATARIO; CPF_CNPJ; ENDERECO; NUMERO; COMPLEMENTO; BAIRRO; CIDADE; UF; CEP; CONTEUDO; CODIGO_PP.'],
]);

function applyGuidance() {
  if (!ROOT) return;
  ROOT.querySelectorAll('.section-title').forEach((section) => {
    const title = section.querySelector('h2')?.textContent?.trim();
    const text = GUIDANCE.get(title);
    if (!text) return;
    const subtitle = section.querySelector('p');
    if (subtitle) subtitle.innerHTML = text;
  });
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; applyGuidance(); });
});
if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applyGuidance();
