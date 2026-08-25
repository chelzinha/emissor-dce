import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let pending;

export function loadPostalVendors() {
  if (!pending) {
    pending = Promise.all([
      import("pdfjs-dist/build/pdf.mjs"),
      import("@zxing/library"),
    ]).then(([pdfjsLib, zxingModule]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const ZXing = zxingModule.default || zxingModule;
      if (!ZXing.BrowserMultiFormatReader) throw new Error("Leitor de Data Matrix indisponível.");
      return { pdfjsLib, ZXing };
    }).catch((error) => {
      pending = undefined;
      throw new Error(`Falha ao preparar o leitor postal: ${error.message || error}`);
    });
  }
  return pending;
}

export function postalVendorSources() {
  return { pdf: "local", pdfWorker: pdfWorkerUrl, zxing: "local" };
}
