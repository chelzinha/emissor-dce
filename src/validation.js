export function digits(value) { return String(value || "").replace(/\D/g, ""); }

export function isCnpj(value) {
  const cnpj = digits(value);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base, weights) => {
    const sum = [...base].reduce((total, number, index) => total + Number(number) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}` === cnpj.slice(12);
}

export function isCpf(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (length) => {
    const sum = cpf.slice(0, length).split("").reduce((total, n, index) => total + Number(n) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isIdOutros(value) {
  return /^[\u0021-\u00FF]{2,60}$/.test(String(value || "").trim());
}

export function validateRemittance(row) {
  const errors = [];
  const r = row.document?.recipient || {};
  const a = r.address || {};
  const item = row.document?.items?.[0] || {};
  if (!/^[A-Z]{2}\d{9}BR$/.test(row.trackingCode || "")) errors.push("SRO");
  if (!["PAC", "SEDEX"].includes(row.service)) errors.push("serviço");
  if (!r.name) errors.push("destinatário");
  const documentValid = r.documentType === "CNPJ" ? isCnpj(r.document)
    : r.documentType === "idOutros" ? isIdOutros(r.document)
      : isCpf(r.document);
  if (!documentValid) errors.push("documento");
  for (const [label, value] of [["logradouro", a.street], ["número", a.number], ["bairro", a.district], ["município", a.city]]) {
    if (!String(value || "").trim()) errors.push(label);
  }
  if (!/^[A-Z]{2}$/.test(a.uf || "")) errors.push("UF");
  if (!/^\d{8}$/.test(digits(a.zip))) errors.push("CEP");
  if (!/^\d{7}$/.test(digits(a.cityCode))) errors.push("IBGE");
  if (!String(item.description || "").trim()) errors.push("conteúdo");
  if (!(Number(item.quantity) > 0)) errors.push("quantidade");
  if (!(Number(item.unitValue) >= 0.01)) errors.push("valor");
  if (item.ncm && !/^\d{2}(?:\d{6})?$/.test(digits(item.ncm))) errors.push("NCM");
  return [...new Set(errors)];
}

export function normalizeName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
