const CLEANING_REQUEST_CHUNK = 25;

export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
    return response;
  }
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || "Não foi possível concluir a operação");
  return result.data;
}

function isOperationsFrontend() {
  const path = String(globalThis.location?.pathname || "").toLowerCase();
  return path === "/eleicoes" || path === "/eleicoes.html" || path === "/portal" || path === "/portal.html" || path.startsWith("/operacoes");
}

function callDataAction(action, payload = {}) {
  const endpoint = isOperationsFrontend() ? "/api/operations-data" : "/api/data";
  return api(endpoint, { method: "POST", body: JSON.stringify({ action, payload }) });
}

async function processCleaningInSafeChunks(payload) {
  const rowIds = Array.isArray(payload?.rowIds) ? payload.rowIds.map(String).filter(Boolean) : [];
  if (rowIds.length <= CLEANING_REQUEST_CHUNK) return callDataAction("cleaning.process", payload);

  const summary = { processed: 0, ready: 0, review: 0, rejected: 0 };
  let lastId = "";
  for (let index = 0; index < rowIds.length; index += CLEANING_REQUEST_CHUNK) {
    const result = await callDataAction("cleaning.process", {
      ...payload,
      rowIds: rowIds.slice(index, index + CLEANING_REQUEST_CHUNK),
    });
    lastId = result?.id || lastId;
    const current = result?.summary || {};
    summary.processed += Number(current.processed || 0);
    summary.ready += Number(current.ready || 0);
    summary.review += Number(current.review || 0);
    summary.rejected += Number(current.rejected || 0);
  }
  return { id: lastId, summary };
}

export function dataAction(action, payload = {}) {
  if (action === "cleaning.process") return processCleaningInSafeChunks(payload);
  return callDataAction(action, payload);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function textDownload(content, name, type = "application/xml;charset=utf-8") {
  downloadBlob(new Blob([content], { type }), name);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}
