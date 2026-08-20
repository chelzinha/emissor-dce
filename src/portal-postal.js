export const PORTAL_POSTAL_HEADERS = Object.freeze([
  "NOME", "EMPRESA", "CPF", "CEP", "ENDEREÇO", "NUMERO", "COMPLEMENTO", "BAIRRO", "CIDADE", "UF",
  "AOS_CUIDADOS", "NOTA_FISCAL", "SERVICO", "SERV_ADICIONAIS", "VALOR_DECLARADO", "OBSERVAÇÕES",
  "CONTEUDO", "DDD", "TELEFONE", "EMAIL", "IDENTIFICADOR_CLIENTE (chave do cliente)", "PESO", "ALTURA",
  "LARGURA", "COMPRIMENTO", "ENTREGA_VIZINHO", "RFID", "CHAVE_NOTA_FISCAL",
]);

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizePortalRow(source = {}, defaults = {}) {
  const read = (...keys) => {
    for (const key of keys) if (source[key] != null && String(source[key]).trim() !== "") return source[key];
    return "";
  };
  return {
    name: cleanText(read("name", "NOME", "destinatario", "DESTINATARIO")),
    company: cleanText(read("company", "EMPRESA")),
    cpf: digitsOnly(read("cpf", "CPF")),
    zip: digitsOnly(read("zip", "cep", "CEP")),
    street: cleanText(read("street", "endereco", "ENDEREÇO", "ENDERECO")),
    number: cleanText(read("number", "numero", "NUMERO")),
    complement: cleanText(read("complement", "complemento", "COMPLEMENTO")),
    district: cleanText(read("district", "bairro", "BAIRRO")),
    city: cleanText(read("city", "cidade", "CIDADE")),
    uf: cleanText(read("uf", "UF")).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2),
    careOf: cleanText(read("careOf", "AOS_CUIDADOS")),
    invoice: cleanText(read("invoice", "NOTA_FISCAL")),
    service: cleanText(read("service", "servico", "SERVICO") || defaults.service).toUpperCase(),
    additionalServices: cleanText(read("additionalServices", "SERV_ADICIONAIS")),
    declaredValue: cleanText(read("declaredValue", "VALOR_DECLARADO")),
    observations: cleanText(read("observations", "OBSERVAÇÕES", "OBSERVACOES")),
    content: cleanText(read("content", "conteudo", "CONTEUDO") || defaults.content),
    ddd: digitsOnly(read("ddd", "DDD")),
    phone: digitsOnly(read("phone", "telefone", "TELEFONE")),
    email: cleanText(read("email", "EMAIL")),
    customerId: cleanText(read("customerId", "IDENTIFICADOR_CLIENTE (chave do cliente)")),
    weight: cleanText(read("weight", "peso", "PESO") || defaults.weight),
    height: cleanText(read("height", "altura", "ALTURA") || defaults.height),
    width: cleanText(read("width", "largura", "LARGURA") || defaults.width),
    length: cleanText(read("length", "comprimento", "COMPRIMENTO") || defaults.length),
    neighborDelivery: cleanText(read("neighborDelivery", "ENTREGA_VIZINHO")),
    rfid: cleanText(read("rfid", "RFID")),
    invoiceKey: cleanText(read("invoiceKey", "CHAVE_NOTA_FISCAL")),
  };
}

export function validatePortalRow(row) {
  const issues = [];
  const add = (field, code, message, severity = "ERROR") => issues.push({ field, code, message, severity });
  if (!row.name) add("NOME", "REQUIRED", "Nome obrigatório.");
  if (!/^\d{8}$/.test(row.zip)) add("CEP", "INVALID_CEP", "CEP deve ter 8 dígitos.");
  if (!row.street) add("ENDEREÇO", "REQUIRED", "Logradouro obrigatório.");
  if (!row.number) add("NUMERO", "REQUIRED", "Número obrigatório.");
  if (/^\d+$/.test(row.number) && digitsOnly(row.number).length > 8) add("NUMERO", "SUSPICIOUS_NUMBER", "Número com quantidade incomum de dígitos.", "REVIEW");
  if (!row.district) add("BAIRRO", "REQUIRED", "Bairro obrigatório.");
  if (!row.city) add("CIDADE", "REQUIRED", "Cidade obrigatória.");
  if (!/^[A-Z]{2}$/.test(row.uf)) add("UF", "INVALID_UF", "UF inválida.");
  if (!["PAC", "SEDEX"].includes(row.service)) add("SERVICO", "INVALID_SERVICE", "Serviço deve ser PAC ou SEDEX.");
  if (!row.content) add("CONTEUDO", "REQUIRED", "Conteúdo obrigatório.");
  return issues;
}

export function portalValues(row) {
  return [
    row.name, row.company, row.cpf, row.zip, row.street, row.number, row.complement, row.district, row.city, row.uf,
    row.careOf, row.invoice, row.service, row.additionalServices, row.declaredValue, row.observations, row.content,
    row.ddd, row.phone, row.email, row.customerId, row.weight, row.height, row.width, row.length,
    row.neighborDelivery, row.rfid, row.invoiceKey,
  ];
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildPortalCsv(rows) {
  const lines = [PORTAL_POSTAL_HEADERS.map(escapeCsv).join(";")];
  for (const row of rows) lines.push(portalValues(row).map(escapeCsv).join(";"));
  return `${lines.join("\r\n")}\r\n`;
}
