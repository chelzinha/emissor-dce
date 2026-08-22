export const DEFAULT_MATRIX_REGION = Object.freeze({ x: 0.365, y: 0.042, w: 0.245, h: 0.140 });
export const DEFAULT_RENDER_SCALE = 8;
export const TRACKING_PATTERN = /[A-Z]{2}\d{9}[A-Z]{2}/g;
export const STRIPE_WINDOW = Object.freeze({ x0: 0.76, x1: 0.97, y0: 0.72, y1: 0.98 });
export const STRIPE_PATTERN = /^[A-Z0-9]{2,8}$/;

export function trackingCodesFromText(text) {
  return [...new Set(String(text || "").toUpperCase().match(TRACKING_PATTERN) || [])];
}

export function stripeFromTextContent(textContent, viewport, window = STRIPE_WINDOW) {
  const width = Number(viewport?.width || 0);
  const height = Number(viewport?.height || 0);
  if (!width || !height) return null;
  const candidates = [];
  for (const item of textContent?.items || []) {
    const text = String(item.str || "").trim();
    if (!STRIPE_PATTERN.test(text)) continue;
    const transform = item.transform || [];
    const x = Number(transform[4] || 0) / width;
    const y = 1 - (Number(transform[5] || 0) / height);
    if (x >= window.x0 && x <= window.x1 && y >= window.y0 && y <= window.y1) candidates.push({ text, x, y });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.x - a.x);
  return candidates[0].text;
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

export async function decodeDataMatrix(dataUrl, ZXing) {
  if (!ZXing) throw new Error("ZXing nao disponivel");
  const image = await imageFromDataUrl(dataUrl);
  if (!image) return null;
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.DATA_MATRIX]);
  const attempt = (scale) => {
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = scale < 1;
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const luminance = new Uint8ClampedArray(width * height);
    for (let index = 0; index < width * height; index += 1) luminance[index] = (rgba[index * 4] * 0.299 + rgba[index * 4 + 1] * 0.587 + rgba[index * 4 + 2] * 0.114) | 0;
    const source = new ZXing.RGBLuminanceSource(luminance, width, height);
    for (const Binarizer of [ZXing.HybridBinarizer, ZXing.GlobalHistogramBinarizer]) {
      try {
        const bitmap = new ZXing.BinaryBitmap(new Binarizer(source));
        return new ZXing.DataMatrixReader().decode(bitmap, hints).getText();
      } catch { /* proxima estrategia */ }
    }
    return null;
  };
  for (const scale of [1, 3]) {
    const decoded = attempt(scale);
    if (decoded) return decoded;
  }
  return null;
}

export async function renderMatrixCrop(page, region = DEFAULT_MATRIX_REGION, scale = DEFAULT_RENDER_SCALE) {
  const viewport = page.getViewport({ scale });
  const sx = region.x * viewport.width;
  const sy = region.y * viewport.height;
  const width = Math.max(8, Math.round(region.w * viewport.width));
  const height = Math.max(8, Math.round(region.h * viewport.height));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -Math.round(sx), -Math.round(sy)] }).promise;
  return canvas;
}

export async function auditPdfDocuments(pdfDocuments, ZXing, options = {}) {
  const region = options.region || DEFAULT_MATRIX_REGION;
  const renderScale = Number(options.renderScale || DEFAULT_RENDER_SCALE);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const totalPages = pdfDocuments.reduce((sum, item) => sum + item.doc.numPages, 0);
  const crops = new Map();
  const audit = [];
  const diagnostics = { byCode: 0, byText: 0, missing: 0, reinforced: 0, divergent: [], duplicates: [] };
  let processed = 0;
  for (const item of pdfDocuments) {
    for (let pageNumber = 1; pageNumber <= item.doc.numPages; pageNumber += 1) {
      const page = await item.doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((entry) => entry.str).join(" ").toUpperCase();
      const textCodes = trackingCodesFromText(pageText);
      const stripe = stripeFromTextContent(textContent, page.getViewport({ scale: 1 })) || "";
      let crop = await renderMatrixCrop(page, region, renderScale);
      let cropDataUrl = crop.toDataURL("image/png");
      let payload = await decodeDataMatrix(cropDataUrl, ZXing);
      if (!payload) {
        crop = await renderMatrixCrop(page, region, renderScale * 2);
        const reinforcedDataUrl = crop.toDataURL("image/png");
        const reinforcedPayload = await decodeDataMatrix(reinforcedDataUrl, ZXing);
        if (reinforcedPayload) { cropDataUrl = reinforcedDataUrl; payload = reinforcedPayload; diagnostics.reinforced += 1; }
      }
      const decodedCode = trackingCodesFromText(payload || "")[0] || null;
      let object = null; let origin = "";
      if (decodedCode) { object = decodedCode; origin = "codigo"; diagnostics.byCode += 1; }
      else if (textCodes.length === 1) { object = textCodes[0]; origin = "texto"; diagnostics.byText += 1; }
      else diagnostics.missing += 1;
      if (object) {
        if (decodedCode && textCodes.length && !textCodes.includes(decodedCode)) diagnostics.divergent.push({ fileName: item.name, page: pageNumber, decodedCode, textCodes });
        if (crops.has(object)) diagnostics.duplicates.push({ object, fileName: item.name, page: pageNumber });
        crops.set(object, cropDataUrl);
        audit.push({ fileName: item.name, page: pageNumber, object, origin, stripe, payload: payload || "", payloadStart: payload ? payload.slice(0, 80) : "" });
      }
      processed += 1;
      onProgress({ processed, totalPages, object, origin });
      if (processed % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { crops, audit, diagnostics, totalPages };
}

export async function loadPdfDocuments(files, pdfjsLib) {
  if (!pdfjsLib) throw new Error("pdf.js nao disponivel");
  const documents = [];
  for (const file of [...files]) {
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    documents.push({ name: file.name, doc });
  }
  return documents;
}

export async function verifyCrops(crops, ZXing) {
  const results = [];
  for (const [object, dataUrl] of crops.entries()) {
    const payload = await decodeDataMatrix(dataUrl, ZXing);
    results.push({ object, payload: payload || "", ok: Boolean(payload && payload.toUpperCase().includes(object)) });
  }
  return results;
}
