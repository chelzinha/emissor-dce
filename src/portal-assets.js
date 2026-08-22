const DB_NAME = "agf-eleicoes-local";
const DB_VERSION = 1;
const STORE = "portal-return-assets";

function openDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Armazenamento local indisponivel neste navegador."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "portalReturnId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir armazenamento local."));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha no armazenamento local."));
  });
}

export async function cachePortalReturnAssets({ portalReturnId, campaignId, csvFile, pdfFiles, csvSha256 }) {
  if (!portalReturnId) throw new Error("Retorno do Portal nao informado para cache local.");
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const record = {
      portalReturnId,
      campaignId: String(campaignId || ""),
      csvSha256: String(csvSha256 || ""),
      csvFile: csvFile || null,
      pdfFiles: [...(pdfFiles || [])],
      cachedAt: new Date().toISOString(),
    };
    await requestResult(store.put(record));
    return { portalReturnId, cachedAt: record.cachedAt, pdfCount: record.pdfFiles.length };
  } finally { db.close(); }
}

export async function getPortalReturnAssets(portalReturnId) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readonly");
    return await requestResult(transaction.objectStore(STORE).get(String(portalReturnId || ""))) || null;
  } finally { db.close(); }
}

export async function deletePortalReturnAssets(portalReturnId) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    await requestResult(transaction.objectStore(STORE).delete(String(portalReturnId || "")));
  } finally { db.close(); }
}

export async function portalReturnAssetsStatus(portalReturnId) {
  try {
    const record = await getPortalReturnAssets(portalReturnId);
    if (!record) return { available: false, pdfCount: 0, cachedAt: "" };
    return {
      available: Boolean(record.pdfFiles?.length),
      pdfCount: Number(record.pdfFiles?.length || 0),
      cachedAt: String(record.cachedAt || ""),
      csvSha256: String(record.csvSha256 || ""),
    };
  } catch {
    return { available: false, pdfCount: 0, cachedAt: "" };
  }
}
