import { dataAction } from "./api.js";
import {
  chunkPreparedDocuments,
  fiscalEnrichmentTemplate,
  parseFiscalEnrichmentCsv,
  preflightDcePreparation,
} from "./agency-dce-preparation.js";

export async function loadAllDcePreparationObjects(campaignId, productionBatchId, onProgress) {
  const rows = [];
  let offset = 0;
  const limit = 250;
  let total = Infinity;
  while (offset < total) {
    const page = await dataAction("dcePrep.objects", { campaignId, productionBatchId, offset, limit });
    total = Number(page.total || 0);
    rows.push(...(page.rows || []));
    offset = rows.length;
    onProgress?.({ loaded: rows.length, total });
    if (!(page.rows || []).length) break;
  }
  if (rows.length !== total) throw new Error(`Leitura incompleta dos objetos: ${rows.length} de ${total}.`);
  return rows;
}

export async function loadDcePreparationContext(campaignId, productionBatchId) {
  return dataAction("dcePrep.context", { campaignId, productionBatchId });
}

export async function saveIssuerDraft(campaignId, profile) {
  return dataAction("issuer.upsert", { campaignId, profile, confirmDeclarations: false });
}

export async function prepareDceAuthorizationPackage({
  campaignId,
  productionBatchId,
  objects,
  issuerProfile,
  defaults = {},
  enrichmentCsvText = "",
  environment = "2",
  onProgress,
}) {
  let enrichments = [];
  if (String(enrichmentCsvText || "").trim()) {
    const parsed = parseFiscalEnrichmentCsv(enrichmentCsvText);
    if (parsed.errors.length) throw new Error(parsed.errors.join(" "));
    enrichments = parsed.rows;
  }
  const preflight = preflightDcePreparation({ objects, issuerProfile, defaults, enrichments });
  if (!preflight.ready) {
    const error = new Error(`Preparo fiscal bloqueado: ${preflight.blockedCount} objeto(s) com pendencias.`);
    error.preflight = preflight;
    throw error;
  }
  onProgress?.({ stage:"start", message:"Reservando numeracao e criando pacote" });
  const started = await dataAction("client.dce.prepareStart", { campaignId, productionBatchId, environment });
  if (String(started.status || "").toUpperCase() !== "UPLOADING") {
    return { package: started, preflight, resumed: true, alreadyPrepared: true };
  }
  const chunks = chunkPreparedDocuments(preflight.documents, started.chunkSize || 100);
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.({ stage:"append", index:index + 1, total:chunks.length, message:`Preparando bloco ${index + 1} de ${chunks.length}` });
    await dataAction("client.dce.prepareAppend", { campaignId, packageId: started.id, documents: chunks[index] });
  }
  onProgress?.({ stage:"finish", message:"Concluindo pacote para autorizacao do cliente" });
  const finished = await dataAction("client.dce.prepareFinish", { campaignId, packageId: started.id });
  return { package: finished, preflight, resumed: Boolean(started.resumed), alreadyPrepared: false };
}

export function downloadFiscalEnrichmentTemplate() {
  return new Blob([fiscalEnrichmentTemplate()], { type:"text/csv;charset=utf-8" });
}

export function summarizePreflight(preflight) {
  const counts = Object.entries(preflight?.blockerCounts || {}).sort((a,b)=>b[1]-a[1]);
  return {
    ready: Boolean(preflight?.ready), total:Number(preflight?.total || 0), readyCount:Number(preflight?.readyCount || 0),
    blockedCount:Number(preflight?.blockedCount || 0), topBlockers:counts.slice(0,8).map(([code,count])=>({code,count}))
  };
}
