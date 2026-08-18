import {
  DCE_ISSUER_TYPE_OWN,
  DCE_MODEL,
  DCE_NORMAL_ISSUE,
  DCE_TRANSPORT_CORREIOS,
  UF_CODES,
} from "./constants.mjs";

export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function cleanText(value, maxLength = 5000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function isValidCpf(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCnpj(value) {
  const cnpj = digits(value);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const digit = (base, weights) => {
    const sum = base.split("").reduce((total, number, index) => {
      return total + Number(number) * weights[index];
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}` === cnpj.slice(12);
}

function requireText(errors, path, value, min, max) {
  const normalized = cleanText(value, max);
  if (normalized.length < min) errors.push(`${path}: preenchimento obrigatório`);
  return normalized;
}

function normalizeAddress(errors, path, address, destination = false) {
  const value = address || {};
  const uf = cleanText(value.uf, 2).toUpperCase();
  const countryCode = digits(value.countryCode || "1058");
  const country = cleanText(value.country || "BRASIL", 60);
  const normalized = {
    street: requireText(errors, `${path}.street`, value.street, 2, 60),
    number: requireText(errors, `${path}.number`, value.number, 1, 60),
    complement: cleanText(value.complement, 60),
    district: requireText(errors, `${path}.district`, value.district, 2, 60),
    cityCode: digits(value.cityCode),
    city: requireText(errors, `${path}.city`, value.city, 2, 60),
    uf,
    zip: digits(value.zip),
    countryCode,
    country,
    phone: digits(value.phone),
    email: cleanText(value.email, 60),
  };

  if (!/^\d{7}$/.test(normalized.cityCode)) errors.push(`${path}.cityCode: código IBGE inválido`);
  if (!UF_CODES[uf] && uf !== "EX") errors.push(`${path}.uf: UF inválida`);
  if (!/^\d{8}$/.test(normalized.zip) && !(destination && uf === "EX")) {
    errors.push(`${path}.zip: CEP deve ter 8 dígitos`);
  }
  if (!destination && countryCode !== "1058") errors.push(`${path}.countryCode: remetente deve estar no Brasil`);
  if (normalized.phone && !/^\d{7,14}$/.test(normalized.phone)) errors.push(`${path}.phone: telefone inválido`);
  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.push(`${path}.email: e-mail inválido`);
  }
  return normalized;
}

export function normalizeDceDocument(input) {
  const errors = [];
  const source = input || {};
  const issuerCnpj = digits(source.issuer?.cnpj);
  const recipientDocument = digits(source.recipient?.document);
  const recipientDocumentType = source.recipient?.documentType === "CNPJ" ? "CNPJ" : "CPF";
  const uf = cleanText(source.issuer?.address?.uf, 2).toUpperCase();
  const series = String(Number(source.identification?.series ?? 0));
  const number = String(Number(source.identification?.number ?? 0));
  const tpAmb = String(source.identification?.environment ?? "2") === "1" ? "1" : "2";
  const emissionDateTime = cleanText(source.identification?.emissionDateTime, 30)
    || new Date().toISOString().replace("Z", "+00:00");

  if (!isValidCnpj(issuerCnpj)) errors.push("issuer.cnpj: CNPJ do emitente inválido");
  if (recipientDocumentType === "CNPJ" && !isValidCnpj(recipientDocument)) {
    errors.push("recipient.document: CNPJ do destinatário inválido");
  }
  if (recipientDocumentType === "CPF" && !isValidCpf(recipientDocument)) {
    errors.push("recipient.document: CPF do destinatário inválido");
  }
  if (!UF_CODES[uf]) errors.push("issuer.address.uf: UF do emitente inválida");
  if (!/^\d{1,3}$/.test(series) || Number(series) > 999) errors.push("identification.series: série inválida");
  if (!/^\d{1,9}$/.test(number) || Number(number) < 1) errors.push("identification.number: número inválido");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(emissionDateTime)) {
    errors.push("identification.emissionDateTime: data e hora inválidas");
  }

  const items = (Array.isArray(source.items) ? source.items : []).map((item, index) => {
    const quantity = Number(item.quantity);
    const unitValue = Number(item.unitValue);
    const totalValue = Number((quantity * unitValue).toFixed(2));
    const description = requireText(errors, `items[${index}].description`, item.description, 1, 120);
    const ncm = digits(item.ncm);
    if (!(quantity > 0)) errors.push(`items[${index}].quantity: quantidade deve ser maior que zero`);
    if (!(unitValue >= 0.01)) errors.push(`items[${index}].unitValue: valor deve ser maior que zero`);
    if (totalValue > 10_000_000) errors.push(`items[${index}].totalValue: valor acima de R$ 10.000.000,00`);
    if (ncm && !/^\d{2}(?:\d{6})?$/.test(ncm)) errors.push(`items[${index}].ncm: NCM deve ter 2 ou 8 dígitos`);
    return {
      description,
      ncm,
      quantity,
      unitValue,
      totalValue,
      additionalInfo: cleanText(item.additionalInfo, 500),
    };
  });
  if (items.length < 1 || items.length > 999) errors.push("items: informe de 1 a 999 itens");
  if (items.reduce((total, item) => total + item.totalValue, 0) > 10_000_000) {
    errors.push("items: valor total da DC-e acima de R$ 10.000.000,00");
  }

  const normalized = {
    reference: cleanText(source.reference, 60),
    trackingCode: cleanText(source.trackingCode, 20).toUpperCase(),
    service: cleanText(source.service, 20).toUpperCase(),
    identification: {
      cUF: UF_CODES[uf] || "",
      model: DCE_MODEL,
      series,
      number,
      emissionDateTime,
      issueMode: DCE_NORMAL_ISSUE,
      issuerType: DCE_ISSUER_TYPE_OWN,
      authorizationSite: String(source.identification?.authorizationSite ?? "0"),
      environment: tpAmb,
      processVersion: cleanText(source.identification?.processVersion || "EMISSOR-DCE-0.1.0", 20),
    },
    issuer: {
      cnpj: issuerCnpj,
      name: requireText(errors, "issuer.name", source.issuer?.name, 2, 60),
      address: normalizeAddress(errors, "issuer.address", source.issuer?.address, false),
    },
    recipient: {
      documentType: recipientDocumentType,
      document: recipientDocument,
      name: requireText(errors, "recipient.name", source.recipient?.name, 2, 60),
      address: normalizeAddress(errors, "recipient.address", source.recipient?.address, true),
    },
    items,
    transport: {
      mode: DCE_TRANSPORT_CORREIOS,
    },
    additionalInfo: cleanText(source.additionalInfo, 5000),
  };

  if (normalized.identification.authorizationSite !== "0") {
    errors.push("identification.authorizationSite: o Ambiente Nacional publicado utiliza site 0");
  }
  if (normalized.trackingCode && !/^[A-Z]{2}\d{9}BR$/.test(normalized.trackingCode)) {
    errors.push("trackingCode: código SRO inválido");
  }
  return { valid: errors.length === 0, errors, document: normalized };
}
