import { DCE_LAYOUT_VERSION, DCE_NAMESPACE } from "./constants.mjs";
import { escapeXml } from "./xml.mjs";

export function buildConsultationXml(environment, accessKey) {
  const key = String(accessKey || "").replace(/\D/g, "");
  if (!/^\d{44}$/.test(key)) throw new Error("Chave de acesso inválida");
  const tpAmb = String(environment) === "1" ? "1" : "2";
  return `<consSitDCe xmlns="${DCE_NAMESPACE}" versao="${DCE_LAYOUT_VERSION}"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chDCe>${key}</chDCe></consSitDCe>`;
}

export function buildStatusXml(environment) {
  const tpAmb = String(environment) === "1" ? "1" : "2";
  return `<consStatServDCe xmlns="${DCE_NAMESPACE}" versao="${DCE_LAYOUT_VERSION}"><tpAmb>${tpAmb}</tpAmb><xServ>STATUS</xServ></consStatServDCe>`;
}

export function buildCancellationXml({ environment, accessKey, issuerCnpj, protocolNumber, reason, organizationCode = "91" }) {
  const key = String(accessKey || "").replace(/\D/g, "");
  const cnpj = String(issuerCnpj || "").replace(/\D/g, "");
  const protocol = String(protocolNumber || "").replace(/\D/g, "");
  const justification = String(reason || "").replace(/\s+/g, " ").trim();
  if (!/^\d{44}$/.test(key)) throw new Error("Chave de acesso inválida");
  if (!/^\d{14}$/.test(cnpj)) throw new Error("CNPJ do autor inválido");
  if (!/^\d{16}$/.test(protocol)) throw new Error("Protocolo de autorização inválido");
  if (justification.length < 15 || justification.length > 255) {
    throw new Error("A justificativa deve ter entre 15 e 255 caracteres");
  }
  const tpAmb = String(environment) === "1" ? "1" : "2";
  const tpEvento = "110111";
  const sequence = "001";
  const eventId = `ID${tpEvento}${key}${sequence}`;
  const dateTime = new Date().toISOString().replace("Z", "+00:00");
  return [
    `<eventoDCe xmlns="${DCE_NAMESPACE}" versao="${DCE_LAYOUT_VERSION}">`,
    `<infEvento Id="${eventId}">`,
    `<cOrgao>${escapeXml(organizationCode)}</cOrgao><tpAmb>${tpAmb}</tpAmb><tpEmit>2</tpEmit>`,
    `<CNPJAutor>${cnpj}</CNPJAutor><CNPJUsEmit>${cnpj}</CNPJUsEmit>`,
    `<chDCe>${key}</chDCe><dhEvento>${dateTime}</dhEvento>`,
    `<tpEvento>${tpEvento}</tpEvento><nSeqEvento>1</nSeqEvento>`,
    `<detEvento versaoEvento="${DCE_LAYOUT_VERSION}"><evCancDCe><descEvento>Cancelamento</descEvento>`,
    `<nProt>${protocol}</nProt><xJust>${escapeXml(justification)}</xJust></evCancDCe></detEvento>`,
    `</infEvento></eventoDCe>`,
  ].join("");
}
