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

export function dataAction(action, payload = {}) {
  const endpoint = isOperationsFrontend() ? "/api/operations-data" : "/api/data";
  return api(endpoint, { method: "POST", body: JSON.stringify({ action, payload }) });
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
