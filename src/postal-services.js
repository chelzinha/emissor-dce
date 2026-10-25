// Regras de serviço postal aceitas pela emissão própria de DC-e.
// PAC e SEDEX exigem código SRO. A Mala Direta Postal Básica (MDPB) com
// chancela não possui SRO, por isso o código é opcional nesses serviços.

export const SERVICE_OPTIONS = ["PAC", "SEDEX", "MDPB LOCAL", "MDPB ESTADUAL", "MDPB NACIONAL"];

const MDPB_SERVICES = new Set(["MDPB LOCAL", "MDPB ESTADUAL", "MDPB NACIONAL"]);

// Códigos de contrato da MDPB a faturar com chancela (consulta de 25/10/2026).
const MDPB_CODES = { "15318": "MDPB LOCAL", "15300": "MDPB ESTADUAL", "15326": "MDPB NACIONAL" };

function plain(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Identifica a MDPB e o âmbito. Retorna "" quando não for MDPB ou o âmbito for desconhecido. */
export function detectMdpbService(value) {
  const text = plain(value);
  if (!text) return "";
  const code = text.replace(/\D/g, "");
  if (MDPB_CODES[code] && /^\d+$/.test(text.replace(/\s/g, ""))) return MDPB_CODES[code];
  if (!/\bMDPB|MALA DIRETA/.test(text)) return "";
  if (/\bLOCAL\b|\bMDPB L\b/.test(text)) return "MDPB LOCAL";
  if (/\bESTADUAL\b|\bMDPB E\b/.test(text)) return "MDPB ESTADUAL";
  if (/\bNACIONAL\b|\bMDPB N\b/.test(text)) return "MDPB NACIONAL";
  return "MDPB";
}

/**
 * Normaliza o serviço informado no arquivo ou na tela.
 * PAC e SEDEX mantêm exatamente a regra anterior: contém "SEDEX" vira SEDEX, o resto vira PAC.
 * MDPB sem âmbito definido retorna "MDPB" para ser bloqueada na revisão.
 */
export function normalizeService(value, fallback = "") {
  const source = String(value ?? "").trim() ? value : fallback;
  const mdpb = detectMdpbService(source);
  if (mdpb) return mdpb;
  return plain(source).includes("SEDEX") ? "SEDEX" : "PAC";
}

export function isAllowedService(service) {
  return SERVICE_OPTIONS.includes(String(service || ""));
}

export function isMdpbService(service) {
  return MDPB_SERVICES.has(String(service || ""));
}

/** PAC e SEDEX exigem SRO. MDPB com chancela aceita remessa sem SRO. */
export function requiresTrackingCode(service) {
  return !isMdpbService(service);
}

/** Identificação curta da remessa para listas e nomes de arquivo. */
export function remittanceLabel(row) {
  return String(row?.trackingCode || row?.reference || row?.document?.recipient?.name || "").trim();
}
