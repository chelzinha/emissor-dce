const ROOT = document.querySelector('#elections-app');

const CSV_FORMATS = Object.freeze({
  'Receber nova base': 'CSV colunas mínimas: NOME; CEP; ENDEREÇO; NUMERO; BAIRRO; CIDADE; UF. Colunas opcionais aceitas: COMPLEMENTO; CPF; EMPRESA; SERVICO; CONTEUDO.',
  'Importar retorno do Portal Postal': 'CSV do Portal Postal: OBJETO; SERVICO; DESTINATARIO; CPF_CNPJ; ENDERECO; NUM; COMPLEMENTO; BAIRRO; CIDADE; UF; CEP; CONTEUDO; CODIGO_PP.',
  'Atualizar rastreamento': 'CSV colunas: SRO; STATUS; DESCRICAO; DATA_EVENTO; HORA; LOCAL.',
  'Tabela à vista PAC e SEDEX': 'CSV colunas: SERVICO; CEP_INICIAL; CEP_FINAL; PESO_INICIAL_G; PESO_FINAL_G; PRECO; PRAZO_DIAS; REGIAO.',
});

function applyCsvFormatSubtitles() {
  if (!ROOT) return;

  ROOT.querySelectorAll('.section-title').forEach((sectionTitle) => {
    const title = sectionTitle.querySelector('h2')?.textContent?.trim();
    const format = CSV_FORMATS[title];
    if (!format) return;

    let subtitle = sectionTitle.querySelector('p');
    if (!subtitle) {
      subtitle = document.createElement('p');
      sectionTitle.querySelector('div')?.appendChild(subtitle);
    }
    if (subtitle && subtitle.textContent !== format) subtitle.textContent = format;
  });
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyCsvFormatSubtitles();
  });
});

if (ROOT) observer.observe(ROOT, { childList: true, subtree: true });
applyCsvFormatSubtitles();
