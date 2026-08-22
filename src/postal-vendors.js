const VENDORS = Object.freeze({
  pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  zxing: "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js",
});

const pending = new Map();

function loadScript(src, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (pending.has(src)) return pending.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-postal-vendor="${src}"]`);
    const script = existing || document.createElement("script");
    const done = () => {
      const value = globalThis[globalName];
      if (!value) reject(new Error(`Biblioteca ${globalName} carregada sem expor o objeto esperado.`));
      else resolve(value);
    };
    if (existing) {
      if (globalThis[globalName]) done();
      else {
        existing.addEventListener("load", done, { once: true });
        existing.addEventListener("error", () => reject(new Error(`Falha ao carregar ${globalName}.`)), { once: true });
      }
      return;
    }
    script.src = src;
    script.async = true;
    script.dataset.postalVendor = src;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new Error(`Falha ao carregar ${globalName}. Verifique a conexao.`)), { once: true });
    document.head.appendChild(script);
  });
  pending.set(src, promise);
  return promise;
}

export async function loadPostalVendors() {
  const pdfjsLib = await loadScript(VENDORS.pdf, "pdfjsLib");
  pdfjsLib.GlobalWorkerOptions.workerSrc = VENDORS.pdfWorker;
  const ZXing = await loadScript(VENDORS.zxing, "ZXing");
  return { pdfjsLib, ZXing };
}
