function digits_(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCnpj_(value) {
  const cnpj = digits_(value);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  function digit(base, weights) {
    const sum = base.split('').reduce(function(total, number, index) {
      return total + Number(number) * weights[index];
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  }
  const first = digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}` === cnpj.slice(12);
}

function isValidCpf_(value) {
  const cpf = digits_(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  function digit(length) {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf.charAt(index)) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  }
  return digit(9) === Number(cpf.charAt(9)) && digit(10) === Number(cpf.charAt(10));
}

function validateCompany_(profile) {
  const errors = [];
  const source = profile || {};
  if (!isValidCnpj_(source.cnpj)) errors.push('CNPJ inválido.');
  if (String(source.name || '').trim().length < 2) errors.push('Razão social obrigatória.');
  if (!source.address || String(source.address.street || '').trim().length < 2) errors.push('Logradouro do emitente obrigatório.');
  if (!source.address || !String(source.address.number || '').trim()) errors.push('Número do emitente obrigatório.');
  if (!source.address || String(source.address.district || '').trim().length < 2) errors.push('Bairro do emitente obrigatório.');
  if (!source.address || String(source.address.city || '').trim().length < 2) errors.push('Município do emitente obrigatório.');
  if (!source.address || !/^[A-Z]{2}$/.test(String(source.address.uf || '').toUpperCase())) errors.push('UF do emitente inválida.');
  if (!source.address || !/^\d{8}$/.test(digits_(source.address.zip))) errors.push('CEP do emitente inválido.');
  if (!source.address || !/^\d{7}$/.test(digits_(source.address.cityCode))) errors.push('Código IBGE do município obrigatório.');
  if (source.nonIcmsContributor !== true) errors.push('Confirme que a empresa não é contribuinte do ICMS.');
  if (source.operationWithoutInvoice !== true) errors.push('Confirme que a operação não exige nota fiscal.');
  const series = Number(source.series == null ? 0 : source.series);
  if (!Number.isInteger(series) || series < 0 || series > 999) errors.push('Série deve estar entre 0 e 999.');
  if (errors.length) throw new Error(errors.join(' '));
  return {
    cnpj: digits_(source.cnpj),
    name: String(source.name).trim(),
    series: series,
    address: source.address,
    phone: String(source.phone || '').trim(),
    email: String(source.email || '').trim(),
    nonIcmsContributor: true,
    operationWithoutInvoice: true
  };
}
