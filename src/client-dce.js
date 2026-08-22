export const DCE_REQUEST_CHUNK = 5;

export function chunkDocuments(documents = [], size = DCE_REQUEST_CHUNK) {
  const chunkSize = Math.max(1, Math.min(20, Number(size || DCE_REQUEST_CHUNK)));
  const chunks = [];
  for (let index = 0; index < documents.length; index += chunkSize) chunks.push(documents.slice(index, index + chunkSize));
  return chunks;
}

export function normalizeAuthorizationPackage(pkg = {}) {
  const documents = Array.isArray(pkg.documents) ? pkg.documents : [];
  return {
    id: String(pkg.id || pkg.packageId || ""),
    campaignId: String(pkg.campaignId || ""),
    productionBatchId: String(pkg.productionBatchId || ""),
    environment: String(pkg.environment || "2") === "1" ? "1" : "2",
    status: String(pkg.status || "").toUpperCase(),
    total: Number(pkg.total || documents.length || 0),
    authorized: Number(pkg.authorized || 0),
    rejected: Number(pkg.rejected || 0),
    errors: Number(pkg.errors || 0),
    documents,
  };
}

export function pendingDocuments(pkg = {}) {
  return normalizeAuthorizationPackage(pkg).documents.filter((document) => {
    const status = String(document.status || "PREPARED").toUpperCase();
    return !["AUTHORIZED", "CANCELLED"].includes(status);
  });
}

export function authorizationProgress(pkg = {}) {
  const normalized = normalizeAuthorizationPackage(pkg);
  const done = normalized.authorized + normalized.rejected;
  const total = Math.max(normalized.total, done);
  return { total, done, percent: total ? Math.min(100, Math.round(done / total * 100)) : 0 };
}

export function buildAuthorizeBody({ documents, certificateBase64, passphrase, environment, confirmProduction = false }) {
  if (!Array.isArray(documents) || !documents.length) throw new Error("Nenhuma DC-e selecionada para autorização.");
  if (!String(certificateBase64 || "")) throw new Error("Selecione o certificado A1.");
  if (!String(passphrase || "")) throw new Error("Informe a senha do certificado A1.");
  const production = String(environment || "2") === "1";
  if (production && confirmProduction !== true) throw new Error("Confirme explicitamente a emissão em produção.");
  return {
    documents,
    certificateBase64: String(certificateBase64),
    passphrase: String(passphrase),
    confirmProduction: production ? true : Boolean(confirmProduction),
  };
}

export function normalizeAuthorizationResults(results = []) {
  return results.map((result) => ({
    reference: String(result.reference || ""),
    trackingCode: String(result.trackingCode || "").replace(/\s/g, "").toUpperCase(),
    status: String(result.status || "ERROR").toUpperCase(),
    accessKey: String(result.accessKey || "").replace(/\D/g, ""),
    cStat: String(result.cStat || ""),
    reason: String(result.reason || result.error || ""),
    protocolNumber: String(result.protocolNumber || ""),
    qrCode: String(result.qrCode || ""),
    receivedAt: String(result.receivedAt || ""),
    signedXml: String(result.signedXml || ""),
    processedXml: String(result.processedXml || ""),
  }));
}

export function clearCertificateState(state) {
  if (!state || typeof state !== "object") return;
  state.certificateBase64 = "";
  state.certificateName = "";
  state.passphrase = "";
  state.certificateInfo = null;
}
