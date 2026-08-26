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

function number(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function fileMetadata(files) {
  return [...files].map((file) => ({ name: file.name, size: file.size, type: file.type || "application/pdf" }));
}

function portalReturnId(row) {
  return String(row?.ID || row?.id || "");
}

function portalReturnStatus(row) {
  return String(row?.STATUS || row?.status || "");
}

function portalReturnSha(row) {
  return String(row?.CSV_SHA256 || row?.csvSha256 || "");
}

function portalReturnFileName(row) {
  return String(row?.CSV_FILE_NAME || row?.csvFileName || "");
}

function portalReturnTotal(row) {
  return Number(row?.TOTAL_ROWS ?? row?.total ?? 0);
}

function publicSavedReturn(row, recovered = true) {
  return {
    id: portalReturnId(row),
    status: portalReturnStatus(row),
    total: portalReturnTotal(row),
    pac: Number(row?.PAC_ROWS ?? row?.pac ?? 0),
    sedex: Number(row?.SEDEX_ROWS ?? row?.sedex ?? 0),
    invalid: Number(row?.INVALID_ROWS ?? row?.invalid ?? 0),
    matrix: row?.MATRIX_SUMMARY_JSON || row?.matrix || {},
    recovered,
  };
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function releasePdfDocuments(documents) {
  for (const item of documents || []) {
    try { item.doc?.cleanup?.(); } catch { /* limpeza best effort */ }
    try { await item.doc?.destroy?.(); } catch { /* limpeza best effort */ }
  }
}

export function validateReturnPackageCounts(csvRows, pdfDocuments, pdfFiles = []) {
  const csvCount = Number(Array.isArray(csvRows) ? csvRows.length : csvRows || 0);
  const pdfPageCount = (Array.isArray(pdfDocuments) ? pdfDocuments : [])
    .reduce((sum, item) => sum + Number(item?.doc?.numPages || 0), 0);
  const selectedNames = [...(pdfFiles || [])].map((file) => file?.name).filter(Boolean);
  const filesLabel = selectedNames.length
    ? ` PDF selecionado: ${selectedNames.join(", ")}.`
    : "";

  if (csvCount === pdfPageCount) return { csvCount, pdfPageCount };

  if (csvCount > pdfPageCount) {
    const missing = csvCount - pdfPageCount;
    throw new Error(
      `Os arquivos não correspondem. O CSV contém ${number(csvCount)} objetos, mas os PDFs selecionados somam ${number(pdfPageCount)} páginas. `
      + `Faltam ${number(missing)} etiquetas.${filesLabel} Selecione também o PDF restante no mesmo campo ou use o CSV correspondente a essas ${number(pdfPageCount)} páginas.`,
    );
  }

  const excess = pdfPageCount - csvCount;
  throw new Error(
    `Os arquivos não correspondem. O CSV contém ${number(csvCount)} objetos, mas os PDFs selecionados somam ${number(pdfPageCount)} páginas. `
    + `Há ${number(excess)} páginas a mais.${filesLabel} Selecione o CSV correto ou retire o PDF que não pertence a este retorno.`,
  );
}

async function existingReturnForAnalysis(campaignId, csvFile, analysis) {
  const rows = await dataAction("portalReturns.list", { campaignId });
  const expectedSha = String(analysis?.csvSha256 || "");
  const expectedName = String(csvFile?.name || "");
  return rows.find((row) => {
    const sameSha = expectedSha && portalReturnSha(row) === expectedSha;
    const sameName = !expectedSha && expectedName && portalReturnFileName(row) === expectedName;
    return sameSha || sameName;
  }) || null;
}

async function resumeUploadingReturn({ campaignId, existing, backendRows, onProgress }) {
  const id = portalReturnId(existing);
  if (!id) throw new Error("Retorno parcial do Portal sem identificador.");

  const stored = await dataAction("postalObjects.list", {
    campaignId,
    portalReturnId: id,
    limit: 1000,
  });
  const existingCodes = new Set(stored.map((row) => String(row.trackingCode || row.TRACKING_CODE || "").replace(/\s/g, "").toUpperCase()));
  const missing = backendRows.filter((row) => !existingCodes.has(String(row.trackingCode || "").replace(/\s/g, "").toUpperCase()));
  const chunks = chunkRows(missing, 200);

  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.({
      stage: "save-resume",
      index: index + 1,
      total: chunks.length,
      message: `Retomando retorno: bloco ${index + 1} de ${chunks.length}`,
    });
    await dataAction("portalReturn.append", {
      campaignId,
      portalReturnId: id,
      rows: chunks[index],
    });
  }

  onProgress?.({ stage: "save-finish", message: "Finalizando retorno recuperado" });
  const finished = await dataAction("portalReturn.finish", { campaignId, portalReturnId: id });
  return { ...finished, recovered: true };
}

export async function analyzePortalReturn({ csvFile, pdfFiles, pdfjsLib, ZXing, onProgress, region }) {
  if (!csvFile) throw new Error("Selecione o CSV de postagens exportado pelo Portal Postal.");
  if (!pdfFiles?.length) throw new Error("Selecione ao menos um PDF de etiquetas exportado pelo Portal Postal.");
  const csvText = await csvFile.text();
  const parsed = parsePortalReturnCsv(csvText);
  if (parsed.errors.length) throw new Error(parsed.errors.join("; "));
  if (!parsed.rows.length) throw new Error("O CSV do Portal nao possui objetos.");

  const csvSha256 = await sha256Hex(csvText);
  onProgress?.({ stage: "pdf-load", message: "Lendo PDFs do Portal Postal" });
  const documents = await loadPdfDocuments(pdfFiles, pdfjsLib);
  let matrixResult;
  let packageCounts;

  try {
    packageCounts = validateReturnPackageCounts(parsed.rows, documents, pdfFiles);
    onProgress?.({
      stage: "package-check",
      message: `Pacote conferido: ${number(packageCounts.csvCount)} objetos e ${number(packageCounts.pdfPageCount)} páginas`,
    });

    matrixResult = await auditPdfDocuments(documents, ZXing, {
      region,
      keepCrops: false,
      onProgress: (progress) => onProgress?.({ stage: "matrix", ...progress }),
    });
  } finally {
    await releasePdfDocuments(documents);
  }

  onProgress?.({
    stage: "consolidating",
    message: "Consolidando a auditoria",
    detail: "Cruzando os SROs do CSV com as páginas analisadas",
  });
  await yieldToBrowser();
  const merged = mergePortalRowsWithMatrix(parsed.rows, matrixResult.audit);
  const summary = summarizePortalReturn(merged);
  await yieldToBrowser();

  onProgress?.({ stage: "complete", message: "Auditoria concluída" });
  return {
    csvText,
    csvSha256,
    parsed,
    matrixResult,
    rows: merged,
    summary,
    packageCounts,
    pdfFiles: fileMetadata(pdfFiles),
  };
}

export async function savePortalReturn({ campaignId, portalExportId = "", csvFile, analysis, onProgress }) {
  if (!campaignId) throw new Error("Campanha nao informada.");
  if (!analysis?.rows?.length) throw new Error("Analise do retorno do Portal nao realizada.");

  const backendRows = buildPortalReturnBackendRows(analysis.rows);
  const existing = await existingReturnForAnalysis(campaignId, csvFile, analysis);
  if (existing) {
    const status = portalReturnStatus(existing);
    if (["READY", "REVIEW", "IN_PRODUCTION"].includes(status) && portalReturnTotal(existing) === backendRows.length) {
      onProgress?.({ stage: "recovered", message: "Retorno já registrado. Reaproveitando o lote existente." });
      return publicSavedReturn(existing, true);
    }
    if (status === "UPLOADING") {
      onProgress?.({ stage: "resume-start", message: "Retomando um retorno que ficou incompleto" });
      return resumeUploadingReturn({ campaignId, existing, backendRows, onProgress });
    }
  }

  onProgress?.({ stage: "save-start", message: "Criando lote de retorno" });
  const created = await dataAction("portalReturn.start", {
    campaignId,
    portalExportId,
    csvFileName: csvFile?.name || "retorno_portal.csv",
    csvSha256: analysis.csvSha256,
    pdfFiles: analysis.pdfFiles,
  });
  const chunks = chunkRows(backendRows, created.chunkSize || 200);
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress?.({
      stage: "save-rows",
      index: index + 1,
      total: chunks.length,
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
