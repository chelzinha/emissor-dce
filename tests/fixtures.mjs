export const sampleInput = {
  reference: "remessa-1", trackingCode: "AA123456789BR", service: "PAC",
  identification: { series: 0, number: 1, numericCode: "123456", environment: "2", emissionDateTime: "2026-08-18T10:00:00-03:00" },
  issuer: { cnpj: "11222333000181", name: "EMPRESA TESTE LTDA", address: { street: "RUA UM", number: "10", district: "CENTRO", cityCode: "2304400", city: "FORTALEZA", uf: "CE", zip: "60000000", countryCode: "1058", country: "BRASIL" } },
  recipient: { documentType: "CPF", document: "52998224725", name: "CLIENTE TESTE", address: { street: "RUA DOIS", number: "20", district: "CENTRO", cityCode: "2304400", city: "FORTALEZA", uf: "CE", zip: "60000001", countryCode: "1058", country: "BRASIL" } },
  items: [{ description: "LIVRO USADO", ncm: "49", quantity: 1, unitValue: 25.5 }],
};
