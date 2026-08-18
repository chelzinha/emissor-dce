export function modulo11(value) {
  let weight = 2;
  let sum = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    sum += Number(value[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

export function createNumericCode(random = Math.random) {
  const code = String(Math.floor(random() * 1_000_000)).padStart(6, "0");
  if (/^(\d)\1{5}$/.test(code)) return "104729";
  return code;
}

export function createAccessKey(document, numericCode = createNumericCode()) {
  const ide = document.identification;
  const yearMonth = ide.emissionDateTime.slice(2, 4) + ide.emissionDateTime.slice(5, 7);
  const base = [
    ide.cUF,
    yearMonth,
    document.issuer.cnpj.padStart(14, "0"),
    ide.model,
    ide.series.padStart(3, "0"),
    ide.number.padStart(9, "0"),
    ide.issueMode,
    ide.issuerType,
    ide.authorizationSite,
    numericCode,
  ].join("");
  if (!/^\d{43}$/.test(base)) throw new Error("Não foi possível formar os 43 dígitos da chave de acesso");
  const checkDigit = String(modulo11(base));
  return { key: base + checkDigit, numericCode, checkDigit };
}
