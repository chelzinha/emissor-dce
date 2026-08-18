export const DCE_NAMESPACE = "http://www.portalfiscal.inf.br/dce";
export const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
export const DCE_LAYOUT_VERSION = "1.00";
export const DCE_MODEL = "99";
export const DCE_ISSUER_TYPE_OWN = "2";
export const DCE_TRANSPORT_CORREIOS = "0";
export const DCE_NORMAL_ISSUE = "1";

export const UF_CODES = Object.freeze({
  AC: "12", AL: "27", AP: "16", AM: "13", BA: "29", CE: "23", DF: "53",
  ES: "32", GO: "52", MA: "21", MT: "51", MS: "50", MG: "31", PA: "15",
  PB: "25", PR: "41", PE: "26", PI: "22", RJ: "33", RN: "24", RS: "43",
  RO: "11", RR: "14", SC: "42", SP: "35", SE: "28", TO: "17",
});

export const LEGAL_NOTICE_1 =
  "É contribuinte de ICMS qualquer pessoa física ou jurídica, que realize, com habitualidade ou em volume que caracterize intuito comercial, operações de circulação de mercadoria ou prestações de serviços de transportes interestadual e intermunicipal e de comunicação, ainda que as operações e prestações de iniciem no exterior (Lei Complementar nº 87/96, Art. 4º)";

export const LEGAL_NOTICE_2 =
  "Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social e qualquer acessório: quando negar ou deixar de fornecer, quando obrigatório, nota fiscal ou documento equivalente, relativa a venda de mercadoria ou prestação de serviço, efetivamente realizada ou fornece-la em desacordo com a legislação. Sob pena de reclusão de 2 (dois) e 5 (cinco) anos, e multa (Lei 8.137/90, Art 1ª, V).";

export function env(name, fallback = "") {
  const value = globalThis.Netlify?.env?.get?.(name);
  return value == null || value === "" ? fallback : value;
}

export function environmentConfig(tpAmb) {
  const production = String(tpAmb) === "1";
  return {
    tpAmb: production ? "1" : "2",
    authorizationUrl: production
      ? env("DCE_AUTH_URL_PRODUCTION", "https://dce.fazenda.pr.gov.br/dce/DCeAutorizacao")
      : env("DCE_AUTH_URL_HOMOLOG", "https://homologacao.dce.fazenda.pr.gov.br/dce/DCeAutorizacao"),
    statusUrl: production
      ? env("DCE_STATUS_URL_PRODUCTION", "https://dce.fazenda.pr.gov.br/dce/DCeStatusServico")
      : env("DCE_STATUS_URL_HOMOLOG", "https://homologacao.dce.fazenda.pr.gov.br/dce/DCeStatusServico"),
    consultationUrl: production
      ? env("DCE_CONSULT_URL_PRODUCTION", "https://dce.fazenda.pr.gov.br/dce/DCeConsulta")
      : env("DCE_CONSULT_URL_HOMOLOG", "https://homologacao.dce.fazenda.pr.gov.br/dce/DCeConsulta"),
    eventUrl: production
      ? env("DCE_EVENT_URL_PRODUCTION", "https://dce.fazenda.pr.gov.br/dce/DCeRecepcaoEvento")
      : env("DCE_EVENT_URL_HOMOLOG", "https://homologacao.dce.fazenda.pr.gov.br/dce/DCeRecepcaoEvento"),
    qrCodeUrl: env("DCE_QRCODE_URL", "https://www.fazenda.pr.gov.br/dce/qrcode"),
    authorizationNamespace: env(
      "DCE_AUTH_WSDL_NS",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeAutorizacao",
    ),
    authorizationSoapAction: env(
      "DCE_AUTH_SOAP_ACTION",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeAutorizacao/dceAutorizacao",
    ),
    statusNamespace: env(
      "DCE_STATUS_WSDL_NS",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeStatusServico",
    ),
    statusSoapAction: env(
      "DCE_STATUS_SOAP_ACTION",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeStatusServico/dceStatusServico",
    ),
    consultationNamespace: env(
      "DCE_CONSULT_WSDL_NS",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeConsulta",
    ),
    consultationSoapAction: env(
      "DCE_CONSULT_SOAP_ACTION",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeConsulta/dceConsulta",
    ),
    eventNamespace: env(
      "DCE_EVENT_WSDL_NS",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeRecepcaoEvento",
    ),
    eventSoapAction: env(
      "DCE_EVENT_SOAP_ACTION",
      "http://www.portalfiscal.inf.br/dce/wsdl/DCeRecepcaoEvento/dceRecepcaoEvento",
    ),
    eventOrganizationCode: env("DCE_EVENT_ORG_CODE", "91"),
  };
}
