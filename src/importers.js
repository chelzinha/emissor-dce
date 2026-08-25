import Papa from "papaparse";

export const FIELD_DEFINITIONS = [
  ["trackingCode", "Código SRO", true], ["service", "Serviço", true],
  ["recipientName", "Destinatário", true], ["recipientDocumentType", "Tipo do documento", false],
  ["recipientDocument", "CPF/CNPJ/Outro", true],
  ["street", "Logradouro", true], ["number", "Número", true], ["complement", "Complemento", false],
  ["district", "Bairro", true], ["city", "Município", true], ["uf", "UF", true],
  ["zip", "CEP", true], ["cityCode", "Código IBGE", false], ["email", "E-mail", false],
  ["reference", "Referência/pedido", false], ["description", "Conteúdo", true],
  ["ncm", "NCM", false], ["quantity", "Quantidade", false], ["unitValue", "Valor unitário", false],
];

const ALIASES = {
  trackingCode: ["OBJETO", "OBJETO_POSTAL", "NUMERO_ETIQUETA", "CODIGO_RASTREAMENTO", "SRO"],
  service: ["SERVICO", "TIPO_SERVICO"], recipientName: ["DESTINATARIO", "NOME_DESTINATARIO", "NOME"],
  recipientDocumentType: ["TIPO_DOCUMENTO", "DOCUMENT_TYPE", "TIPO_DOC"],
  recipientDocument: ["CPF_CNPJ", "CPFCNPJ", "DOCUMENTO", "CPF", "CNPJ"], street: ["ENDERECO", "LOGRADOURO"],
  number: ["NUM", "NUMERO"], complement: ["COMPL", "COMPLEMENTO"], district: ["BAIRRO"],
  city: ["CIDADE", "MUNICIPIO"], uf: ["UF", "ESTADO"], zip: ["CEP"], cityCode: ["CODIGO_IBGE", "IBGE", "CMUN"],
  email: ["EMAIL", "E_MAIL"], reference: ["NF_PEDIDO", "PEDIDO", "REFERENCIA", "CODIGO_PP"],
  description: ["CONTEUDO", "DESCRICAO", "PRODUTO"], ncm: ["NCM"], quantity: ["QUANTIDADE", "QTD"],
  unitValue: ["VALOR_UNITARIO", "VALOR", "VUNCOM"],
};

export function normalizeKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function decodeBuffer(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1252").decode(buffer);
}

function xmlValue(node, tag) {
  return node.getElementsByTagName(tag)[0]?.textContent?.trim() || "";
}

async function parseFile(file) {
  const buffer = await file.arrayBuffer();
  const text = decodeBuffer(buffer);
  if (file.name.toLowerCase().endsWith(".xml") || text.trim().startsWith("<?xml")) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error(`${file.name}: XML inválido`);
    return [...xml.getElementsByTagName("objeto_postal")].map((node) => ({
      NUMERO_ETIQUETA: xmlValue(node, "numero_etiqueta"),
      CODIGO_OBJETO_CLIENTE: xmlValue(node, "codigo_objeto_cliente"),
      DATA_ATUALIZACAO: xmlValue(node, "data_atualizacao"),
    }));
  }
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: normalizeKey });
  if (parsed.errors.some((error) => error.type === "Quotes")) throw new Error(`${file.name}: CSV malformado`);
  return parsed.data;
}

export async function parseImportFiles(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error("Selecione pelo menos um arquivo CSV ou XML");
  const groups = await Promise.all(files.map(parseFile));
  const byTracking = new Map();
  const withoutTracking = [];
  for (const row of groups.flat()) {
    const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
    const key = String(normalized.OBJETO || normalized.NUMERO_ETIQUETA || normalized.CODIGO_RASTREAMENTO || "")
      .replace(/\s/g, "").toUpperCase();
    if (!key) withoutTracking.push(normalized);
    else byTracking.set(key, { ...(byTracking.get(key) || {}), ...normalized, OBJETO: key });
  }
  return { rows: [...byTracking.values(), ...withoutTracking], fileNames: files.map((file) => file.name) };
}

export function detectMapping(rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const mapping = {};
  for (const [field] of FIELD_DEFINITIONS) {
    mapping[field] = headers.find((header) => (ALIASES[field] || []).includes(normalizeKey(header))) || "";
  }
  return { headers, mapping };
}

function numeric(value) {
  if (typeof value === "number") return value;
  const raw = String(value || "").replace(/R\$/gi, "").replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized || 0);
}

export function inferRecipientDocumentType(value, explicitType = "") {
  const type = String(explicitType || "").trim().toUpperCase();
  if (type === "IDOUTROS" || type === "OUTRO" || type === "OUTROS") return "idOutros";
  if (type === "CNPJ") return "CNPJ";
  if (type === "CPF") return "CPF";
  const raw = String(value || "").trim();
  if (raw && !/^[\d./-]+$/.test(raw)) return "idOutros";
  return raw.replace(/\D/g, "").length === 14 ? "CNPJ" : "CPF";
}

export function mapRows(rows, mapping, defaults = {}) {
  const get = (row, field) => mapping[field] ? row[mapping[field]] : defaults[field];
  return rows.map((row, index) => {
    const rawDocument = String(get(row, "recipientDocument") || "").trim();
    const documentType = inferRecipientDocumentType(rawDocument, get(row, "recipientDocumentType"));
    const doc = documentType === "idOutros" ? rawDocument : rawDocument.replace(/\D/g, "");
    const quantity = numeric(get(row, "quantity")) || numeric(defaults.quantity) || 1;
    const unitValue = numeric(get(row, "unitValue")) || numeric(defaults.unitValue);
    const description = String(get(row, "description") || defaults.description || "").trim();
    const trackingCode = String(get(row, "trackingCode") || "").replace(/\s/g, "").toUpperCase();
    return {
      localId: crypto.randomUUID(), selected: true,
      reference: String(get(row, "reference") || trackingCode || index + 1), trackingCode,
      service: String(get(row, "service") || defaults.service || "").toUpperCase().includes("SEDEX") ? "SEDEX" : "PAC",
      document: {
        recipient: {
          documentType, document: doc,
          name: String(get(row, "recipientName") || "").trim(), email: String(get(row, "email") || "").trim(),
          address: {
            street: String(get(row, "street") || "").trim(), number: String(get(row, "number") || "SN").trim(),
            complement: String(get(row, "complement") || "").trim(), district: String(get(row, "district") || "").trim(),
            city: String(get(row, "city") || "").trim(), cityCode: String(get(row, "cityCode") || "").replace(/\D/g, ""),
            uf: String(get(row, "uf") || "").trim().toUpperCase(), zip: String(get(row, "zip") || "").replace(/\D/g, ""),
            countryCode: "1058", country: "BRASIL", email: String(get(row, "email") || "").trim(),
          },
        },
        items: [{ description, ncm: String(get(row, "ncm") || defaults.ncm || "").replace(/\D/g, ""), quantity, unitValue, totalValue: Number((quantity * unitValue).toFixed(2)) }],
        additionalInfo: "",
      },
    };
  });
}
