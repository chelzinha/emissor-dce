import { dataAction } from "./api.js";
import { auditPdfDocuments, loadPdfDocuments } from "./matrix-engine.js";
import {
  buildPortalReturnBackendRows,
  chunkRows,
  mergePortalRowsWithMatrix,
  parsePortalReturnCsv,
  summarizePortalReturn,
} from "./portal-return.js";

async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) return "";
  const data = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fileMetadata(files) {
  return [...files].map((file) => ({ name: file.name, size: file.size, type: file.type || "application/pdf" }));
}

export async function analyzePortalReturn({ csvFile, pdfFiles, pdfjsLib, ZXing, onProgress, region }) {
  if (!csvFile) throw new Error("Selecione o CSV de postagens exportado pelo Portal Postal.");
  if (!pdfFiles?.length) throw new Error("Selecione ao menos um PDF de etiquetas exportado pelo Portal Postal.");
  const csvText = await csvFile.text();
  const parsed = parsePortalReturnCsv(csvText);
  if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
  if (!parsed.rows.length) throw new Error("O CSV do Portal nao possui objetos.");

  onProgress?.({ stage: "pdf-load", message: "Lendo PDFs do Portal Postal" });
  const documents = await loadPdfDocuments(pdfFiles, pdfjsLib);
  const matrixResult = await auditPdfDocuments(documents, ZXing, {
    region,
    onProgress: (progress) => onProgress?.({ stage: "matrix", ...progress }),
  });
  const merged = mergePortalRowsWithMatrix(parsed.rows, matrixResult.audit);
  const summary = summarizePortalReturn(merged);
  return {
    csvText,
    csvSha256: await sha256Hex(csvText),
    parsed,
    matrixResult,
    rows: merged,
    summary,
    pdfFiles: fileMetadata(pdfFiles),
  };
}

export async function savePortalReturn({ campaignId, portalExportId = "", csvFile, analysis, onProgress }) {
  if (!campaignId) throw new Error("Campanha nao informada.");
  if (!analysis?.rows?.length) throw new Error("Analise do retorno do Portal nao realizada.");
  onProgress?.({ stage: "save-start", message: "Criando lote de retorno" });
  const created = await dataAction("portalReturn.start", {
    campaignId,
    portalExportId,
    csvFileName: csvFile?.name || "retorno_portal.csv",
    csvSha256: analysis.csvSha256,
    pdfFiles: analysis.pdfFiles,
  });
  const backendRows = buildPortalReturnBackendRows(analysis.rows);
  const chunks = chunkRows(backendRows, created.chunkSize || 200);
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.({
      stage: "save-rows", index: index + 1, total: chunks.length,
      message: `Salvando bloco ${index + 1} de ${chunks.length}`,
    });
    await dataAction("portalReturn.append", {
      campaignId,
      portalReturnId: created.id,
      rows: chunks[index],
    });
  }
  const finished = await dataAction("portalReturn.finish", { campaignId, portalReturnId: created.id });
  onProgress?.({ stage: "saved", message: "Retorno do Portal registrado", result: finished });
  return finished;
}

export async function processAndSavePortalReturn(options) {
  const analysis = await analyzePortalReturn(options);
  const saved = await savePortalReturn({ ...options, analysis });
  return { analysis, saved };
}

export async function chooseProductionMode(campaignId, portalReturnId, documentMode) {
  return dataAction("production.prepare", { campaignId, portalReturnId, documentMode });
}

export const DOCUMENT_MODES = Object.freeze({
  SIMPLIFIED: "SIMPLIFIED_DECLARATION",
  DCE: "DCE_AUTHORIZED",
});
