import {
  DCE_LAYOUT_VERSION,
  DCE_NAMESPACE,
  LEGAL_NOTICE_1,
  LEGAL_NOTICE_2,
  environmentConfig,
} from "./constants.mjs";
import { createAccessKey } from "./access-key.mjs";

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name, value) {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

/**
 * Conteudo em CDATA, sem escapar o e-comercial.
 *
 * Regra ZX02-10 do Anexo I: o QR-Code nao pode conter sequencia de escape
 * para o "&". Passar a URL por escapeXml gera &amp; e provoca rejeicao 813.
 * A nota da propria regra diz: "Deve-se usar o CDATA".
 */
function cdataTag(name, value) {
  const conteudo = String(value ?? "").replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<${name}><![CDATA[${conteudo}]]></${name}>`;
}

function optionalTag(name, value) {
  return value == null || value === "" ? "" : tag(name, value);
}

function formatQuantity(value) {
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function formatMoney(value) {
  return Number(value).toFixed(2);
}

const NCM_NOT_CLASSIFIED = "00000000";
// CNPJ dos Correios (ECT). CNPJTransp é obrigatório no XSD (aceita vazio).
const CORREIOS_CNPJ = "34028316000103";

function transportCnpj(transport = {}) {
  const informed = String(transport.carrierCnpj || "").replace(/\D/g, "");
  if (informed.length === 14) return informed;
  return String(transport.mode) === "0" ? CORREIOS_CNPJ : "";
}

function addressXml(name, address, destination = false) {
  return [
    `<${name}>`,
    tag("xLgr", address.street),
    tag("nro", address.number),
    optionalTag("xCpl", address.complement),
    tag("xBairro", address.district),
    tag("cMun", address.cityCode),
    tag("xMun", address.city),
    tag("UF", address.uf),
    optionalTag("CEP", address.zip),
    destination ? optionalTag("cPais", address.countryCode) : tag("cPais", address.countryCode),
    destination ? optionalTag("xPais", address.country) : tag("xPais", address.country),
    optionalTag("fone", address.phone),
    destination ? optionalTag("email", address.email) : "",
    `</${name}>`,
  ].join("");
}

// Emissão própria (tpEmit=2): só o grupo emit. O grupo EmpEmisProp (D15) foi
// removido pela NT 2024.001 (regras D16-10/D16-20 revogadas) e não existe no XSD
// de produção; enviá-lo gera a rejeição 215 (falha no schema XML).
// Regra C02-40: sem grupo Fisco/Marketplace/Transportadora/ECT, tpEmit deve ser 2.
function issuerXml(issuer) {
  return [
    "<emit>",
    tag("CNPJ", issuer.cnpj),
    tag("xNome", issuer.name),
    addressXml("enderEmit", issuer.address),
    "</emit>",
  ].join("");
}

function recipientXml(recipient) {
  return [
    "<dest>",
    tag(recipient.documentType, recipient.document),
    tag("xNome", recipient.name),
    addressXml("enderDest", recipient.address, true),
    "</dest>",
  ].join("");
}

function itemsXml(items) {
  return items.map((item, index) => [
    `<det nItem="${index + 1}">`,
    "<prod>",
    tag("xProd", item.description),
    // NCM é obrigatório no XSD; regra I03-10: sem classificação, informar 00000000.
    tag("NCM", item.ncm || NCM_NOT_CLASSIFIED),
    tag("qCom", formatQuantity(item.quantity)),
    tag("vUnCom", formatMoney(item.unitValue)),
    tag("vProd", formatMoney(item.totalValue)),
    "</prod>",
    optionalTag("infAdProd", item.additionalInfo),
    "</det>",
  ].join("")).join("");
}

export function buildUnsignedDce(document, options = {}) {
  const access = createAccessKey(document, options.numericCode);
  const config = environmentConfig(document.identification.environment);
  const total = document.items.reduce((sum, item) => sum + Number(item.totalValue), 0);
  const extraInfo = [
    document.trackingCode ? `OBJETO POSTAL: ${document.trackingCode}` : "",
    document.service ? `SERVIÇO POSTAL: ${document.service}` : "",
    document.additionalInfo,
  ].filter(Boolean).join(" | ");
  const qrCode = `${config.qrCodeUrl}?chDCe=${access.key}&tpAmb=${document.identification.environment}`;

  const ide = [
    "<ide>",
    tag("cUF", document.identification.cUF),
    tag("cDC", access.numericCode),
    tag("mod", document.identification.model),
    tag("serie", document.identification.series),
    tag("nDC", document.identification.number),
    tag("dhEmi", document.identification.emissionDateTime),
    tag("tpEmis", document.identification.issueMode),
    tag("tpEmit", document.identification.issuerType),
    tag("nSiteAutoriz", document.identification.authorizationSite),
    tag("cDV", access.checkDigit),
    tag("tpAmb", document.identification.environment),
    tag("verProc", document.identification.processVersion),
    "</ide>",
  ].join("");

  const infAdic = extraInfo ? `<infAdic>${tag("infCpl", extraInfo)}</infAdic>` : "";
  const infDec = `<infDec>${tag("xObs1", LEGAL_NOTICE_1)}${tag("xObs2", LEGAL_NOTICE_2)}</infDec>`;
  const infDCe = [
    `<infDCe versao="${DCE_LAYOUT_VERSION}" Id="DCe${access.key}">`,
    ide,
    issuerXml(document.issuer),
    recipientXml(document.recipient),
    itemsXml(document.items),
    `<total>${tag("vDC", formatMoney(total))}</total>`,
    `<transp>${tag("modTrans", document.transport.mode)}${tag("CNPJTransp", transportCnpj(document.transport))}</transp>`,
    infAdic,
    infDec,
    "</infDCe>",
  ].join("");

  const supplemental = [
    "<infDCeSupl>",
    cdataTag("qrCodDCe", qrCode),
    tag("urlChave", config.qrCodeUrl),
    "</infDCeSupl>",
  ].join("");

  return {
    accessKey: access.key,
    numericCode: access.numericCode,
    checkDigit: access.checkDigit,
    qrCode,
    total: Number(total.toFixed(2)),
    xml: `<DCe xmlns="${DCE_NAMESPACE}">${infDCe}${supplemental}</DCe>`,
  };
}

export function buildProcessedDceXml(signedXml, protocolXml) {
  const cleanDce = String(signedXml).replace(/^<\?xml[^>]*>\s*/i, "");
  const cleanProtocol = String(protocolXml || "").replace(/^<\?xml[^>]*>\s*/i, "");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<procDCe xmlns="${DCE_NAMESPACE}" versao="${DCE_LAYOUT_VERSION}">`,
    cleanDce,
    cleanProtocol,
    "</procDCe>",
  ].join("");
}
