const DB_NAME = "agf-postal-operations-local";
const LEGACY_DB_NAME = "agf-eleicoes-local";
const DB_VERSION = 1;
const STORE = "portal-return-assets";

function openDb(name = DB_NAME) {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Armazenamento local indisponivel neste navegador."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
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

async function readFromDb(name, portalReturnId) {
  const db = await openDb(name);
  try {
    const transaction = db.transaction(STORE, "readonly");
    return await requestResult(transaction.objectStore(STORE).get(String(portalReturnId || ""))) || null;
  } finally { db.close(); }
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fileFingerprint(file) {
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  return {
    name: String(file.name || ""),
    size: Number(file.size || buffer.byteLength || 0),
    type: String(file.type || "application/octet-stream"),
    lastModified: Number(file.lastModified || 0),
    sha256: await sha256Hex(buffer),
  };
}

export async function buildFileManifest(files) {
  const result = [];
  for (const file of [...(files || [])]) result.push(await fileFingerprint(file));
  return result;
}

function manifestKey(item) {
  return `${String(item?.name || "").trim().toLowerCase()}|${Number(item?.size || 0)}`;
}

export function compareFileManifests(expected = [], actual = []) {
  const expectedByKey = new Map(expected.map((item) => [manifestKey(item), item]));
  const actualByKey = new Map(actual.map((item) => [manifestKey(item), item]));
  const missing = [];
  const unexpected = [];
  const hashMismatch = [];

  for (const [key, item] of expectedByKey) {
    const candidate = actualByKey.get(key);
    if (!candidate) { missing.push(item); continue; }
    if (item.sha256 && candidate.sha256 && item.sha256 !== candidate.sha256) {
      hashMismatch.push({ expected: item, actual: candidate });
    }
  }
  for (const [key, item] of actualByKey) if (!expectedByKey.has(key)) unexpected.push(item);

  return {
    valid: missing.length === 0 && unexpected.length === 0 && hashMismatch.length === 0,
    missing,
    unexpected,
    hashMismatch,
  };
}

export async function cachePortalReturnAssets({ portalReturnId, campaignId, csvFile, pdfFiles, csvSha256, pdfManifest }) {
  if (!portalReturnId) throw new Error("Retorno do Portal nao informado para cache local.");
  const files = [...(pdfFiles || [])];
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const record = {
      portalReturnId,
      campaignId: String(campaignId || ""),
      csvSha256: String(csvSha256 || ""),
      csvFile: csvFile || null,
      pdfFiles: files,
      pdfManifest: pdfManifest || await buildFileManifest(files),
      cachedAt: new Date().toISOString(),
    };
    await requestResult(store.put(record));
    return {
      portalReturnId,
      cachedAt: record.cachedAt,
      pdfCount: record.pdfFiles.length,
      pdfManifest: record.pdfManifest,
    };
  } finally { db.close(); }
}

export async function getPortalReturnAssets(portalReturnId) {
  const id = String(portalReturnId || "");
  let current = null;
  try { current = await readFromDb(DB_NAME, id); } catch { current = null; }
  if (current) return current;

  let legacy = null;
  try { legacy = await readFromDb(LEGACY_DB_NAME, id); } catch { legacy = null; }
  if (!legacy) return null;
  try {
    await cachePortalReturnAssets({
      portalReturnId: id,
      campaignId: legacy.campaignId,
      csvFile: legacy.csvFile,
      pdfFiles: legacy.pdfFiles,
      csvSha256: legacy.csvSha256,
      pdfManifest: legacy.pdfManifest,
    });
  } catch { /* a leitura do legado ainda pode ser usada nesta sessao */ }
  return legacy;
}

export async function restorePortalReturnAssets({ portalReturnId, campaignId, csvFile = null, pdfFiles, expectedPdfManifest = [] }) {
  if (!portalReturnId) throw new Error("Retorno do Portal nao informado.");
  const files = [...(pdfFiles || [])];
  if (!files.length) throw new Error("Selecione novamente o PDF ou PDFs originais do Portal Postal.");
  const actualManifest = await buildFileManifest(files);
  if (expectedPdfManifest?.length) {
    const comparison = compareFileManifests(expectedPdfManifest, actualManifest);
    if (!comparison.valid) throw new Error("Os PDFs selecionados nao correspondem aos arquivos originais deste retorno.");
  }
  return cachePortalReturnAssets({ portalReturnId, campaignId, csvFile, pdfFiles: files, pdfManifest: actualManifest });
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
    if (!record) return { available: false, pdfCount: 0, cachedAt: "", pdfManifest: [] };
    return {
      available: Boolean(record.pdfFiles?.length),
      pdfCount: Number(record.pdfFiles?.length || 0),
      cachedAt: String(record.cachedAt || ""),
      csvSha256: String(record.csvSha256 || ""),
      pdfManifest: record.pdfManifest || [],
    };
  } catch {
    return { available: false, pdfCount: 0, cachedAt: "", pdfManifest: [] };
  }
}
