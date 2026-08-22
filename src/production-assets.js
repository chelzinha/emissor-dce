import { getPortalReturnAssets, restorePortalReturnAssets } from "./portal-assets.js";
import { auditPdfDocuments, loadPdfDocuments, verifyCrops } from "./matrix-engine.js";
import { isMatrixVerified } from "./label-production.js";

export async function resolveProductionAssets({
  portalReturnId,
  campaignId,
  reselectedPdfFiles = [],
  expectedPdfManifest = [],
}) {
  let cached = await getPortalReturnAssets(portalReturnId);
  if (cached?.pdfFiles?.length) {
    return { source: "CACHE", ...cached };
  }
  if (!reselectedPdfFiles?.length) {
    return {
      source: "MISSING",
      portalReturnId,
      campaignId,
      pdfFiles: [],
      pdfManifest: expectedPdfManifest || [],
    };
  }
  await restorePortalReturnAssets({
    portalReturnId,
    campaignId,
    pdfFiles: reselectedPdfFiles,
    expectedPdfManifest,
  });
  cached = await getPortalReturnAssets(portalReturnId);
  return { source: "RESELECTED", ...cached };
}

export function matrixCoverageForObjects(objects, matrixAudit) {
  const byObject = new Map((matrixAudit?.audit || []).map((entry) => [String(entry.object || "").toUpperCase(), entry]));
  const rows = (objects || []).map((row) => {
    const trackingCode = String(row.trackingCode || "").replace(/\s/g, "").toUpperCase();
    const entry = byObject.get(trackingCode) || null;
    const status = String(row.matrixStatus || row.matrix?.status || "MISSING").toUpperCase();
    return {
      trackingCode,
      expectedStatus: status,
      decoded: Boolean(entry?.payload && String(entry.payload).toUpperCase().includes(trackingCode)),
      origin: entry?.origin || "",
      page: entry?.page || 0,
      fileName: entry?.fileName || "",
      cropAvailable: Boolean(matrixAudit?.crops?.get?.(trackingCode)),
    };
  });
  return {
    rows,
    total: rows.length,
    decoded: rows.filter((row) => row.decoded).length,
    withCrop: rows.filter((row) => row.cropAvailable).length,
    fullyCovered: rows.length > 0 && rows.every((row) => row.decoded && row.cropAvailable && isMatrixVerified(row.expectedStatus)),
  };
}

export async function rebuildVerifiedMatrixCrops({ pdfFiles, pdfjsLib, ZXing, onProgress }) {
  if (!pdfFiles?.length) throw new Error("Os PDFs originais do Portal Postal nao estao disponiveis.");
  const documents = await loadPdfDocuments(pdfFiles, pdfjsLib);
  const result = await auditPdfDocuments(documents, ZXing, {
    onProgress: (progress) => onProgress?.({ stage: "matrix", ...progress }),
  });
  const verification = await verifyCrops(result.crops, ZXing);
  const verified = new Map();
  verification.forEach((entry) => {
    if (entry.ok && result.crops.has(entry.object)) verified.set(entry.object, result.crops.get(entry.object));
  });
  return {
    ...result,
    verifiedCrops: verified,
    verification,
    verifiedCount: verification.filter((entry) => entry.ok).length,
  };
}
